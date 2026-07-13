import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { backupFiles } from "./lifecycle.js";
import { ToolError, resolveProject } from "./paths.js";

export interface RefactorAutoArgs {
  projectPath?: string;
  sourceFile: string;
  outputDir?: string;
  overwrite?: boolean;
  dryRun?: boolean;
}

type XY = { x: number; y: number };
type Pose = XY & { headingDegrees?: number };
type VisualizerPoint = XY &
  (
    | { heading: "constant"; degrees: number }
    | { heading: "linear"; startDeg: number; endDeg: number }
    | { heading: "tangential"; reverse: boolean }
  );
type VisualizerLine = {
  id: string;
  endPoint: VisualizerPoint;
  controlPoints: XY[];
  color: string;
  name: string;
};

type AutoStep =
  | { type: "path"; pathId: string; state: string; waitForFollowerIdle: boolean }
  | { type: "wait"; durationMs: number | null; expression: string; state: string }
  | { type: "action"; action: string; invocation: string; state: string; reviewRequired: boolean };

export interface ExtractedAutonomous {
  spec: Record<string, unknown>;
  visualizer: Record<string, unknown>;
  className: string;
  warnings: string[];
  pathCount: number;
  stepCount: number;
  actionCount: number;
}

const COLORS = ["#22c55e", "#3b82f6", "#f97316", "#a855f7", "#ef4444", "#06b6d4", "#eab308"];

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function safeNumber(expression: string, symbols: Map<string, number>): number | null {
  let value = expression.trim().replace(/(?<=\d)[fFdDlL]\b/g, "");
  for (let pass = 0; pass < 8; pass++) {
    const next = value.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
      if (name === "Math" || name === "PI") return name;
      const known = symbols.get(name);
      return known === undefined ? name : `(${known})`;
    });
    if (next === value) break;
    value = next;
  }
  value = value.replace(/Math\.PI/g, String(Math.PI));
  if (!/^[\d+\-*/().\s]+$/.test(value)) return null;
  try {
    // The allowlist above limits evaluation to arithmetic punctuation and numbers.
    const result = Function(`"use strict"; return (${value});`)() as unknown;
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function headingDegrees(expression: string, symbols: Map<string, number>): number | null {
  const radiansCall = expression.trim().match(/^Math\.toRadians\s*\(([\s\S]*)\)$/);
  if (radiansCall) return safeNumber(radiansCall[1], symbols);
  const radians = safeNumber(expression, symbols);
  return radians === null ? null : (radians * 180) / Math.PI;
}

function splitTopLevel(value: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && depth === 0) {
      result.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

function matchingParen(value: string, open: number): number {
  let depth = 0;
  for (let i = open; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function parseNumericSymbols(source: string): Map<string, number> {
  const symbols = new Map<string, number>();
  const declarations = [...source.matchAll(/\b(?:double|float|long|int)\s+(\w+)\s*=\s*([^;]+);/g)];
  for (let pass = 0; pass < declarations.length + 1; pass++) {
    let changed = false;
    for (const match of declarations) {
      if (symbols.has(match[1])) continue;
      const radiansCall = match[2].trim().match(/^Math\.toRadians\s*\(([\s\S]*)\)$/);
      const number = radiansCall
        ? (() => {
            const degrees = safeNumber(radiansCall[1], symbols);
            return degrees === null ? null : (degrees * Math.PI) / 180;
          })()
        : safeNumber(match[2], symbols);
      if (number !== null) {
        symbols.set(match[1], number);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return symbols;
}

function parsePose(value: string, poses: Map<string, Pose>, symbols: Map<string, number>): Pose | null {
  const trimmed = value.trim();
  const known = poses.get(trimmed);
  if (known) return { ...known };
  const poseAt = trimmed.indexOf("new Pose");
  if (poseAt < 0) return null;
  const open = trimmed.indexOf("(", poseAt);
  const close = matchingParen(trimmed, open);
  if (open < 0 || close < 0) return null;
  const args = splitTopLevel(trimmed.slice(open + 1, close));
  if (args.length < 2) return null;
  const x = safeNumber(args[0], symbols);
  const y = safeNumber(args[1], symbols);
  const heading = args[2] === undefined ? null : headingDegrees(args[2], symbols);
  if (x === null || y === null) return null;
  return { x: round(x), y: round(y), ...(heading === null ? {} : { headingDegrees: round(heading) }) };
}

function parsePoseSymbols(source: string, symbols: Map<string, number>): Map<string, Pose> {
  const poses = new Map<string, Pose>();
  for (const match of source.matchAll(/\bPose\s+(\w+)\s*=\s*(new\s+Pose\s*\([\s\S]*?\))\s*;/g)) {
    const pose = parsePose(match[2], poses, symbols);
    if (pose) poses.set(match[1], pose);
  }
  return poses;
}

function methodArgs(chain: string, method: string): string[] | null {
  const methodAt = chain.indexOf(`.${method}`);
  if (methodAt < 0) return null;
  const open = chain.indexOf("(", methodAt + method.length + 1);
  const close = matchingParen(chain, open);
  return open < 0 || close < 0 ? null : splitTopLevel(chain.slice(open + 1, close));
}

function interpolation(chain: string, symbols: Map<string, number>, fallback: Pose): VisualizerPoint {
  const linear = methodArgs(chain, "setLinearHeadingInterpolation");
  if (linear?.length === 2) {
    const startDeg = headingDegrees(linear[0], symbols);
    const endDeg = headingDegrees(linear[1], symbols);
    if (startDeg !== null && endDeg !== null) {
      return { x: fallback.x, y: fallback.y, heading: "linear", startDeg: round(startDeg), endDeg: round(endDeg) };
    }
  }
  if (/\.setTangentHeadingInterpolation\s*\(\s*\)/.test(chain)) {
    return { x: fallback.x, y: fallback.y, heading: "tangential", reverse: /\.setReversed\s*\(\s*\)/.test(chain) };
  }
  const constant = methodArgs(chain, "setConstantHeadingInterpolation");
  const degrees = constant?.length === 1 ? headingDegrees(constant[0], symbols) : fallback.headingDegrees ?? 0;
  return { x: fallback.x, y: fallback.y, heading: "constant", degrees: round(degrees ?? 0) };
}

function pathBuilderAssignments(source: string): { name: string; body: string }[] {
  const results: { name: string; body: string }[] = [];
  const regex = /\b(\w+)\s*=\s*follower\.pathBuilder\s*\(\s*\)/g;
  for (const match of source.matchAll(regex)) {
    const start = match.index! + match[0].length;
    const build = source.indexOf(".build()", start);
    if (build >= 0) results.push({ name: match[1], body: source.slice(start, build) });
  }
  return results;
}

function parsePath(
  name: string,
  body: string,
  color: string,
  poses: Map<string, Pose>,
  symbols: Map<string, number>,
  warnings: string[]
): { lines: VisualizerLine[]; starts: Pose[] } {
  const lines: VisualizerLine[] = [];
  const starts: Pose[] = [];
  let cursor = 0;
  while (true) {
    const add = body.indexOf(".addPath", cursor);
    if (add < 0) break;
    const open = body.indexOf("(", add);
    const close = matchingParen(body, open);
    if (open < 0 || close < 0) break;
    const argument = body.slice(open + 1, close).trim();
    const kind = argument.match(/^new\s+(BezierLine|BezierCurve)\s*\(/);
    if (!kind) {
      warnings.push(`${name}: could not parse addPath expression: ${argument.slice(0, 80)}`);
      cursor = close + 1;
      continue;
    }
    const geometryOpen = argument.indexOf("(", kind[0].indexOf("("));
    const geometryClose = matchingParen(argument, geometryOpen);
    const poseArgs = geometryClose < 0 ? [] : splitTopLevel(argument.slice(geometryOpen + 1, geometryClose));
    const points = poseArgs.map((arg) => parsePose(arg, poses, symbols));
    if (points.length < 2 || points.some((point) => point === null)) {
      warnings.push(`${name}: skipped a ${kind[1]} because one or more Pose expressions could not be resolved.`);
      cursor = close + 1;
      continue;
    }
    const parsed = points as Pose[];
    const nextAdd = body.indexOf(".addPath", close + 1);
    const chain = body.slice(close + 1, nextAdd < 0 ? body.length : nextAdd);
    starts.push(parsed[0]);
    lines.push({
      id: `${name}-segment-${lines.length + 1}`,
      endPoint: interpolation(chain, symbols, parsed.at(-1)!),
      controlPoints: parsed.slice(1, -1).map(({ x, y }) => ({ x, y })),
      color,
      name: lines.length ? `${name} ${lines.length + 1}` : name,
    });
    cursor = close + 1;
  }
  if (!lines.length) warnings.push(`${name}: no visualizer-compatible BezierLine or BezierCurve was extracted.`);
  return { lines, starts };
}

function extractCases(source: string): { state: string; body: string }[] {
  const switchAt = source.search(/switch\s*\(\s*pathState\s*\)/);
  if (switchAt < 0) return [];
  const open = source.indexOf("{", switchAt);
  const close = matchingBrace(source, open);
  if (open < 0 || close < 0) return [];
  const body = source.slice(open + 1, close);
  const starts = [...body.matchAll(/\bcase\s+([^:]+):/g)];
  return starts.map((match, index) => ({
    state: match[1].trim(),
    body: body.slice(match.index! + match[0].length, starts[index + 1]?.index ?? body.length),
  }));
}

function matchingBrace(value: string, open: number): number {
  let depth = 0;
  for (let i = open; i < value.length; i++) {
    if (value[i] === "{") depth++;
    else if (value[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function extractSteps(source: string, symbols: Map<string, number>): AutoStep[] {
  const steps: AutoStep[] = [];
  const ignoredMethods = new Set(["setState", "reset", "milliseconds", "isBusy", "followPath", "if", "for", "while", "switch"]);
  for (const { state, body } of extractCases(source)) {
    const events: { index: number; step: AutoStep }[] = [];
    for (const match of body.matchAll(/follower\.followPath\s*\(\s*paths\.(\w+)[^;]*;/g)) {
      events.push({
        index: match.index!,
        step: { type: "path", pathId: match[1], state, waitForFollowerIdle: /!\s*follower\.isBusy\s*\(\s*\)/.test(body) },
      });
    }
    for (const match of body.matchAll(/\w+\.milliseconds\s*\(\s*\)\s*>\s*([A-Za-z_$][\w$]*|[0-9][0-9.+\-*/ ]*)/g)) {
      const expression = match[1].trim();
      const duration = safeNumber(expression, symbols);
      events.push({ index: match.index!, step: { type: "wait", durationMs: duration === null ? null : round(duration), expression, state } });
    }
    for (const match of body.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\s*\(([^(){};]*)\)\s*;/g)) {
      const method = match[1];
      if (ignoredMethods.has(method) || method.startsWith("set")) continue;
      events.push({
        index: match.index!,
        step: { type: "action", action: method, invocation: `${method}(${match[2].trim()});`, state, reviewRequired: true },
      });
    }
    events.sort((a, b) => a.index - b.index);
    steps.push(...events.map(({ step }) => step));
  }
  return steps;
}

export function extractAutonomous(source: string, sourceName = "Auto.java"): ExtractedAutonomous {
  const warnings: string[] = [];
  const symbols = parseNumericSymbols(source);
  const poses = parsePoseSymbols(source, symbols);
  const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? null;
  const className = source.match(/\bclass\s+(\w+)/)?.[1] ?? sourceName.replace(/\.java$/i, "");
  const annotation = source.match(/@Autonomous\s*\(([^)]*)\)/)?.[1] ?? "";
  const opModeName = annotation.match(/\bname\s*=\s*"([^"]+)"/)?.[1] ?? className;
  const group = annotation.match(/\bgroup\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const startingCall = source.search(/follower\.setStartingPose\s*\(/);
  let startPose: Pose | null = null;
  if (startingCall >= 0) {
    const open = source.indexOf("(", startingCall);
    const close = matchingParen(source, open);
    if (close >= 0) startPose = parsePose(source.slice(open + 1, close), poses, symbols);
  }

  const assignments = pathBuilderAssignments(source);
  if (!assignments.length) warnings.push("No follower.pathBuilder() assignments were found.");
  const paths = assignments.map(({ name, body }, index) => {
    const parsed = parsePath(name, body, COLORS[index % COLORS.length], poses, symbols, warnings);
    return { id: name, name, color: COLORS[index % COLORS.length], ...parsed };
  });
  const allLines = paths.flatMap((path) => path.lines);
  if (!startPose) {
    startPose = paths[0]?.starts[0] ?? null;
    warnings.push("No follower.setStartingPose(...) was found; the first extracted path point was used.");
  }
  if (!startPose) startPose = { x: 0, y: 0, headingDegrees: 0 };

  let previous: Pose = startPose;
  for (const path of paths) {
    for (let i = 0; i < path.lines.length; i++) {
      const actual = path.starts[i];
      if (Math.hypot(actual.x - previous.x, actual.y - previous.y) > 0.1) {
        warnings.push(
          `${path.name}: its visualizer start (${actual.x}, ${actual.y}) differs from the preceding endpoint (${previous.x}, ${previous.y}). ` +
            "The current .pp format has no per-chain start point; review this transition in the visualizer."
        );
      }
      const end = path.lines[i].endPoint;
      previous = { x: end.x, y: end.y };
    }
  }

  const steps = extractSteps(source, symbols);
  if (!steps.length) warnings.push("No switch(pathState) path/action timeline was extracted.");
  const pathById = new Map(paths.map((path) => [path.id, path]));
  const sequence: Record<string, unknown>[] = [];
  let waitIndex = 0;
  for (const step of steps) {
    if (step.type === "path") {
      const path = pathById.get(step.pathId);
      if (path) sequence.push(...path.lines.map((line) => ({ kind: "path", lineId: line.id })));
    } else if (step.type === "wait" && step.durationMs !== null) {
      sequence.push({ kind: "wait", id: `imported-wait-${++waitIndex}`, name: step.expression, durationMs: step.durationMs });
    }
  }
  if (!sequence.length) sequence.push(...allLines.map((line) => ({ kind: "path", lineId: line.id })));

  const visualizer = {
    startPoint: { x: startPose.x, y: startPose.y, heading: "constant", degrees: startPose.headingDegrees ?? 0 },
    lines: allLines,
    shapes: [],
    sequence,
    pathChains: paths.map((path) => ({ id: path.id, name: path.name, color: path.color, lineIds: path.lines.map((line) => line.id) })),
    version: "1.2.1",
    timestamp: new Date().toISOString(),
  };
  const actions = [...new Map(steps.filter((step): step is Extract<AutoStep, { type: "action" }> => step.type === "action").map((step) => [step.action, {
    id: step.action,
    javaMethod: step.action,
    invocation: step.invocation,
    kind: "imported",
    reviewRequired: true,
  }])).values()];
  const spec = {
    schemaVersion: 1,
    kind: "ftc-toolchain/autonomous",
    name: opModeName,
    java: { packageName, className, group },
    source: { file: sourceName, importer: "ftc-toolchain", extraction: "conservative" },
    startPose,
    paths: paths.map((path) => ({ id: path.id, name: path.name, lineIds: path.lines.map((line) => line.id) })),
    actions,
    steps,
    extractionWarnings: warnings,
  };
  return { spec, visualizer, className, warnings, pathCount: paths.length, stepCount: steps.length, actionCount: actions.length };
}

function projectFile(project: string, file: string): string {
  const absolute = isAbsolute(file) ? resolve(file) : resolve(project, file);
  if (absolute !== project && !absolute.startsWith(project + sep)) {
    throw new ToolError(`Path must stay inside the FTC project: ${file}`);
  }
  return absolute;
}

export function refactorAutoForVisualizer(args: RefactorAutoArgs): string {
  const project = resolveProject(args.projectPath);
  const sourceFile = projectFile(project, args.sourceFile);
  if (!existsSync(sourceFile)) throw new ToolError(`Autonomous Java file not found: ${sourceFile}`);
  if (!sourceFile.endsWith(".java")) throw new ToolError("sourceFile must be a .java file inside the FTC project.");
  const extracted = extractAutonomous(readFileSync(sourceFile, "utf8"), relative(project, sourceFile));
  const outputDir = projectFile(project, args.outputDir ?? "autos");
  const specFile = resolve(outputDir, `${extracted.className}.ftcauto.json`);
  const visualizerFile = resolve(outputDir, `${extracted.className}.pp`);
  const targets = [specFile, visualizerFile];
  const existing = targets.filter(existsSync);
  if (existing.length && !args.overwrite) {
    throw new ToolError(
      `Refusing to overwrite existing autonomous files:\n${existing.map((file) => `- ${relative(project, file)}`).join("\n")}\n` +
        "Review them, then pass overwrite: true. Existing versions will be backed up first."
    );
  }
  const specJson = JSON.stringify({ ...extracted.spec, visualizerFile: relative(project, visualizerFile) }, null, 2) + "\n";
  const visualizerJson = JSON.stringify(extracted.visualizer, null, 2) + "\n";
  const summary =
    `${args.dryRun ? "REFACTOR PREVIEW — no files written" : "Refactored autonomous for visual editing"}\n` +
    `Source: ${relative(project, sourceFile)}\n` +
    `Autonomous spec: ${relative(project, specFile)}\n` +
    `Pedro Visualizer file: ${relative(project, visualizerFile)}\n` +
    `Extracted: ${extracted.pathCount} path chains, ${extracted.stepCount} timeline steps, ${extracted.actionCount} robot actions.\n` +
    (extracted.warnings.length
      ? `\nReview required:\n${extracted.warnings.map((warning) => `- ${warning}`).join("\n")}`
      : "\nNo extraction warnings.");
  if (args.dryRun) return summary + `\n\n.ftcauto.json preview:\n${specJson}\n.pp preview:\n${visualizerJson}`;
  const backup = args.overwrite ? backupFiles(project, targets) : null;
  mkdirSync(dirname(specFile), { recursive: true });
  writeFileSync(specFile, specJson);
  writeFileSync(visualizerFile, visualizerJson);
  return summary + (backup ? `\n\nPrevious files backed up to: ${backup}` : "") +
    "\n\nOpen the .pp file in Pedro Visualizer to review geometry. Keep the .ftcauto.json file as the editable source for paths, waits, and robot actions.";
}
