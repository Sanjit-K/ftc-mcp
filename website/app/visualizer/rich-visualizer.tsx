"use client";
/* Imported user JSON is normalized field-by-field before it enters application state. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from "next/link";
import { ChangeEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./visualizer.module.css";
import layout from "./visualizer-layout.module.css";

type XY = { x: number; y: number };
type Heading =
  | { heading: "constant"; degrees: number }
  | { heading: "linear"; startDeg: number; endDeg: number }
  | { heading: "tangential"; reverse: boolean };
type Point = XY & Heading;
type Line = { id: string; name: string; endPoint: Point; controlPoints: XY[]; color: string };
type Path = { id: string; name: string; color: string; lineIds: string[]; startPoint: XY };
type ActionParameter = { name: string; defaultValue: string };
type ActionDefinition = {
  id: string;
  label: string;
  mode: "instant" | "blocking";
  javaCall: string;
  periodicCall: string;
  completionCondition: string;
  parameters: ActionParameter[];
  javaMethod?: string;
  source?: {
    category: "subsystems" | "automations" | "manual";
    group: string;
    className: string;
    file?: string;
  };
};
type Camera = { zoom: number; focusX: number; focusY: number };
type FieldView = { x: number; y: number; width: number; height: number; baseX: number; baseY: number; baseWidth: number; baseHeight: number };
type Step =
  | { id: string; type: "path"; pathId: string }
  | { id: string; type: "wait"; durationMs: number; label: string }
  | { id: string; type: "action"; actionId: string; args: Record<string, string> };
type JavaSettings = { packageName: string; className: string; opModeName: string; group: string };
type AutoModel = {
  schemaVersion: 1;
  kind: "ftc-toolchain/autonomous";
  name: string;
  startPose: { x: number; y: number; headingDegrees: number };
  java: JavaSettings;
  lines: Line[];
  paths: Path[];
  actions: ActionDefinition[];
  steps: Step[];
};

const palette = ["#f97316", "#22c55e", "#38bdf8", "#a78bfa", "#f43f5e", "#facc15"];
let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
const clamp = (value: number) => Math.max(0, Math.min(144, Math.round(value * 100) / 100));
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const javaName = (value: string, fallback: string) => {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^[^A-Za-z_$]+/, "");
  return cleaned || fallback;
};

const samePoint = (a: XY, b: XY) => Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;

function fieldView(camera: Camera, viewport: { width: number; height: number }): FieldView {
  const aspect = Math.max(0.1, viewport.width / Math.max(1, viewport.height));
  const baseWidth = aspect >= 1 ? 144 * aspect : 144;
  const baseHeight = aspect >= 1 ? 144 : 144 / aspect;
  const baseX = (144 - baseWidth) / 2;
  const baseY = (144 - baseHeight) / 2;
  const width = baseWidth / camera.zoom;
  const height = baseHeight / camera.zoom;
  return {
    x: baseX + (baseWidth - width) * camera.focusX,
    y: baseY + (baseHeight - height) * camera.focusY,
    width,
    height,
    baseX,
    baseY,
    baseWidth,
    baseHeight,
  };
}

function pathEnd(path: Path, lines: Line[]): XY {
  const lineMap = new Map(lines.map((line) => [line.id, line]));
  for (let index = path.lineIds.length - 1; index >= 0; index--) {
    const line = lineMap.get(path.lineIds[index]);
    if (line) return { x: line.endPoint.x, y: line.endPoint.y };
  }
  return { ...path.startPoint };
}

/**
 * Make timeline geometry physically followable. Each path starts at the prior
 * path's endpoint (actions and waits do not move the robot). If one path is
 * reused from a different pose, clone that chain so both occurrences remain
 * valid Pedro PathChains instead of sharing contradictory start poses.
 */
function ensureTimelineContinuity(input: AutoModel): AutoModel {
  const paths = input.paths.map((path) => ({ ...path, startPoint: { ...path.startPoint }, lineIds: [...path.lineIds] }));
  const lines = input.lines.map((line) => ({ ...line, endPoint: { ...line.endPoint }, controlPoints: line.controlPoints.map((point) => ({ ...point })) }));
  const steps = input.steps.map((step) => step.type === "action" ? { ...step, args: { ...step.args } } : { ...step });
  const pathMap = new Map(paths.map((path) => [path.id, path]));
  const seen = new Map<string, number>();
  let cursor: XY = { x: input.startPose.x, y: input.startPose.y };

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step.type !== "path") continue;
    let path = pathMap.get(step.pathId);
    if (!path) continue;
    const occurrence = seen.get(path.id) ?? 0;
    if (!samePoint(path.startPoint, cursor)) {
      if (occurrence === 0) {
        path.startPoint = { ...cursor };
      } else {
        const suffix = occurrence + 1;
        const cloneId = `${path.id}_${suffix}`;
        const clonedLineIds = path.lineIds.map((lineId, lineIndex) => {
          const source = lines.find((line) => line.id === lineId);
          const clonedId = `${lineId}-use-${suffix}-${lineIndex + 1}`;
          if (source) lines.push({ ...source, id: clonedId, name: `${source.name} (${suffix})`, controlPoints: source.controlPoints.map((point) => ({ ...point })), endPoint: { ...source.endPoint } });
          return clonedId;
        });
        path = { ...path, id: cloneId, name: `${path.name} (${suffix})`, startPoint: { ...cursor }, lineIds: clonedLineIds };
        paths.push(path);
        pathMap.set(path.id, path);
        steps[index] = { ...step, pathId: path.id };
      }
    }
    seen.set(step.pathId, occurrence + 1);
    cursor = pathEnd(path, lines);
  }
  return { ...input, paths, lines, steps };
}

function replaceLine(model: AutoModel, lineId: string, nextLine: Line): AutoModel {
  const previous = model.lines.find((line) => line.id === lineId);
  if (!previous) return model;
  const endpointMoved = !samePoint(previous.endPoint, nextLine.endPoint);
  return {
    ...model,
    lines: model.lines.map((line) => line.id === lineId ? nextLine : line),
    paths: endpointMoved
      ? model.paths.map((path) => samePoint(path.startPoint, previous.endPoint) ? { ...path, startPoint: { x: nextLine.endPoint.x, y: nextLine.endPoint.y } } : path)
      : model.paths,
  };
}

const starter: AutoModel = {
  schemaVersion: 1,
  kind: "ftc-toolchain/autonomous",
  name: "Decode Auto",
  startPose: { x: 22, y: 120, headingDegrees: 180 },
  java: { packageName: "org.firstinspires.ftc.teamcode", className: "DecodeAuto", opModeName: "Decode Auto", group: "Autonomous" },
  lines: [
    { id: "score-segment-1", name: "Score", color: "#f97316", controlPoints: [{ x: 37, y: 111 }], endPoint: { x: 58, y: 76, heading: "linear", startDeg: 180, endDeg: 180 } },
    { id: "pickup-segment-1", name: "Pickup", color: "#38bdf8", controlPoints: [{ x: 42, y: 60 }, { x: 25, y: 56 }], endPoint: { x: 14, y: 59, heading: "tangential", reverse: false } },
  ],
  paths: [
    { id: "Score", name: "Score", color: "#f97316", lineIds: ["score-segment-1"], startPoint: { x: 22, y: 120 } },
    { id: "Pickup", name: "Pickup", color: "#38bdf8", lineIds: ["pickup-segment-1"], startPoint: { x: 58, y: 76 } },
  ],
  actions: [
    { id: "spinIntake", label: "Spin intake", mode: "instant", javaCall: "barIntake.spinIntake();", periodicCall: "", completionCondition: "", parameters: [], source: { category: "subsystems", group: "Intake", className: "BarIntake" } },
    { id: "startOuttakeRoutine", label: "Shoot stored pieces", mode: "blocking", javaCall: "startOuttakeRoutine();", periodicCall: "handleOuttakeRoutine();", completionCondition: "!outtakeInProgress", parameters: [], source: { category: "automations", group: "Scoring", className: "OuttakeRoutine" } },
  ],
  steps: [
    { id: "step-score", type: "path", pathId: "Score" },
    { id: "step-shoot", type: "action", actionId: "startOuttakeRoutine", args: {} },
    { id: "step-pickup", type: "path", pathId: "Pickup" },
    { id: "step-intake", type: "action", actionId: "spinIntake", args: {} },
    { id: "step-wait", type: "wait", durationMs: 900, label: "Collect" },
  ],
};

function endpointHeading(raw: any): Heading {
  if (raw?.heading === "linear") return { heading: "linear", startDeg: number(raw.startDeg), endDeg: number(raw.endDeg) };
  if (raw?.heading === "tangential") return { heading: "tangential", reverse: Boolean(raw.reverse) };
  return { heading: "constant", degrees: number(raw?.degrees) };
}

function normalizeLines(raw: any[]): Line[] {
  return (raw ?? []).map((line, index) => ({
    id: String(line.id ?? `segment-${index + 1}`),
    name: String(line.name ?? `Segment ${index + 1}`),
    color: String(line.color ?? palette[index % palette.length]),
    controlPoints: Array.isArray(line.controlPoints) ? line.controlPoints.map((p: any) => ({ x: number(p.x), y: number(p.y) })) : [],
    endPoint: { x: number(line.endPoint?.x), y: number(line.endPoint?.y), ...endpointHeading(line.endPoint) },
  }));
}

function pathsFromPP(pp: any, lines: Line[]): Path[] {
  const chains = Array.isArray(pp.pathChains) && pp.pathChains.length
    ? pp.pathChains
    : lines.map((line, index) => ({ id: `Path${index + 1}`, name: line.name, color: line.color, lineIds: [line.id] }));
  const lineMap = new Map(lines.map((line) => [line.id, line]));
  let previous: XY = { x: number(pp.startPoint?.x), y: number(pp.startPoint?.y) };
  return chains.map((chain: any, index: number) => {
    const startPoint = chain.startPoint
      ? { x: number(chain.startPoint.x), y: number(chain.startPoint.y) }
      : { ...previous };
    for (const id of chain.lineIds ?? []) {
      const line = lineMap.get(String(id));
      if (line) previous = { x: line.endPoint.x, y: line.endPoint.y };
    }
    return {
      id: String(chain.id ?? `Path${index + 1}`),
      name: String(chain.name ?? chain.id ?? `Path ${index + 1}`),
      color: String(chain.color ?? palette[index % palette.length]),
      lineIds: (chain.lineIds ?? []).map(String),
      startPoint,
    };
  });
}

function stepsFromPP(pp: any, paths: Path[]): Step[] {
  const lineToPath = new Map<string, string>();
  paths.forEach((path) => path.lineIds.forEach((lineId) => lineToPath.set(lineId, path.id)));
  const sequence = Array.isArray(pp.sequence) ? pp.sequence : [];
  const steps: Step[] = [];
  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];
    if (item.kind === "wait") {
      steps.push({ id: nextId("step"), type: "wait", durationMs: number(item.durationMs), label: String(item.name ?? "Wait") });
      continue;
    }
    if (item.kind === "path") {
      const pathId = lineToPath.get(String(item.lineId));
      if (!pathId) continue;
      const path = paths.find((candidate) => candidate.id === pathId)!;
      steps.push({ id: nextId("step"), type: "path", pathId });
      i += Math.max(0, path.lineIds.length - 1);
    }
  }
  return steps.length ? steps : paths.map((path) => ({ id: nextId("step"), type: "path" as const, pathId: path.id }));
}

function normalizeAction(raw: any, index: number): ActionDefinition {
  const id = String(raw.id ?? raw.action ?? raw.javaMethod ?? `action${index + 1}`);
  return {
    id,
    label: String(raw.label ?? id.replace(/([a-z])([A-Z])/g, "$1 $2")),
    mode: raw.mode === "blocking" || raw.kind === "blockingRoutine" ? "blocking" : "instant",
    javaCall: String(raw.javaCall ?? raw.invocation ?? `${raw.javaMethod ?? id}();`),
    periodicCall: String(raw.periodicCall ?? ""),
    completionCondition: String(raw.completionCondition ?? ""),
    javaMethod: raw.javaMethod ? String(raw.javaMethod) : undefined,
    source: raw.source ? {
      category: ["subsystems", "automations", "manual"].includes(raw.source.category) ? raw.source.category : "manual",
      group: String(raw.source.group ?? "General"),
      className: String(raw.source.className ?? "Local"),
      file: raw.source.file ? String(raw.source.file) : undefined,
    } : { category: "manual", group: "Manual", className: "Local" },
    parameters: Array.isArray(raw.parameters)
      ? raw.parameters.map((p: any) => ({ name: String(p.name), defaultValue: String(p.defaultValue ?? p.default ?? "") }))
      : [],
  };
}

function modelFromFiles(spec: any | null, pp: any | null): AutoModel {
  const visualizer = spec?.visualizer ?? pp;
  if (!visualizer?.lines) throw new Error("This rich spec has no embedded path geometry. Select its matching .pp file at the same time.");
  const lines = normalizeLines(visualizer.lines);
  const ppPaths = pathsFromPP(visualizer, lines);
  const paths = Array.isArray(spec?.paths)
    ? spec.paths.map((path: any, index: number) => ({
        id: String(path.id ?? `Path${index + 1}`),
        name: String(path.name ?? path.id ?? `Path ${index + 1}`),
        color: String(path.color ?? ppPaths.find((candidate) => candidate.id === path.id)?.color ?? palette[index % palette.length]),
        lineIds: (path.lineIds ?? []).map(String),
        startPoint: {
          x: number(path.startPoint?.x, ppPaths[index]?.startPoint.x),
          y: number(path.startPoint?.y, ppPaths[index]?.startPoint.y),
        },
      }))
    : ppPaths;
  const actions = (spec?.actions ?? []).map(normalizeAction);
  const actionIds = new Set(actions.map((action: ActionDefinition) => action.id));
  const steps: Step[] = Array.isArray(spec?.steps)
    ? spec.steps.flatMap((step: any): Step[] => {
        if (step.type === "path") return [{ id: String(step.id ?? nextId("step")), type: "path", pathId: String(step.pathId) }];
        if (step.type === "wait") return [{ id: String(step.id ?? nextId("step")), type: "wait", durationMs: number(step.durationMs), label: String(step.label ?? step.expression ?? "Wait") }];
        if (step.type === "action") {
          const actionId = String(step.actionId ?? step.action);
          if (!actionIds.has(actionId)) {
            actions.push(normalizeAction({ id: actionId, invocation: step.invocation }, actions.length));
            actionIds.add(actionId);
          }
          return [{ id: String(step.id ?? nextId("step")), type: "action", actionId, args: step.args ?? {} }];
        }
        return [];
      })
    : stepsFromPP(visualizer, paths);
  const start = spec?.startPose ?? visualizer.startPoint ?? {};
  return ensureTimelineContinuity({
    schemaVersion: 1,
    kind: "ftc-toolchain/autonomous",
    name: String(spec?.name ?? "Imported Auto"),
    startPose: { x: number(start.x), y: number(start.y), headingDegrees: number(start.headingDegrees ?? start.degrees) },
    java: {
      packageName: String(spec?.java?.packageName ?? "org.firstinspires.ftc.teamcode"),
      className: String(spec?.java?.className ?? "GeneratedAuto"),
      opModeName: String(spec?.java?.opModeName ?? spec?.name ?? "Generated Auto"),
      group: String(spec?.java?.group ?? "Autonomous"),
    },
    lines,
    paths,
    actions,
    steps,
  });
}

function pointJava(point: XY) {
  return `new Pose(${point.x}, ${point.y})`;
}

function headingJava(point: Point) {
  if (point.heading === "linear") return `.setLinearHeadingInterpolation(Math.toRadians(${point.startDeg}), Math.toRadians(${point.endDeg}))`;
  if (point.heading === "tangential") return `.setTangentHeadingInterpolation()${point.reverse ? ".setReversed()" : ""}`;
  return `.setConstantHeadingInterpolation(Math.toRadians(${point.degrees}))`;
}

function applyTemplate(template: string, args: Record<string, string>) {
  return template.replace(/\{([A-Za-z_$][\w$]*)\}/g, (_, key) => args[key] ?? `{${key}}`);
}

function generateJava(model: AutoModel): string {
  const lineMap = new Map(model.lines.map((line) => [line.id, line]));
  const actionMap = new Map(model.actions.map((action) => [action.id, action]));
  const pathFields = model.paths.map((path) => `    private PathChain ${javaName(path.id, "path")};`).join("\n");
  const builders = model.paths.map((path) => {
    let cursor: XY = path.startPoint;
    const pieces = [`        ${javaName(path.id, "path")} = follower.pathBuilder()`];
    for (const lineId of path.lineIds) {
      const line = lineMap.get(lineId);
      if (!line) continue;
      const points = [cursor, ...line.controlPoints, line.endPoint].map(pointJava).join(", ");
      pieces.push(`            .addPath(new ${line.controlPoints.length ? "BezierCurve" : "BezierLine"}(${points}))`);
      pieces.push(`            ${headingJava(line.endPoint)}`);
      cursor = line.endPoint;
    }
    pieces.push("            .build();");
    return pieces.join("\n");
  }).join("\n\n");
  const cases = model.steps.map((step, index) => {
    const next = index + 1;
    if (step.type === "path") {
      return `            case ${index}:\n                if (!stateStarted) {\n                    follower.followPath(${javaName(step.pathId, "path")});\n                    stateStarted = true;\n                }\n                if (!follower.isBusy()) setState(${next});\n                break;`;
    }
    if (step.type === "wait") {
      return `            case ${index}:\n                if (stateTimer.milliseconds() >= ${step.durationMs}) setState(${next});\n                break;`;
    }
    const action = actionMap.get(step.actionId);
    if (!action) return `            case ${index}: // Missing action: ${step.actionId}\n                setState(${next});\n                break;`;
    const call = applyTemplate(action.javaCall, step.args);
    if (action.mode === "instant") {
      return `            case ${index}:\n                ${call}\n                setState(${next});\n                break;`;
    }
    return `            case ${index}:\n                if (!stateStarted) {\n                    ${call}\n                    stateStarted = true;\n                }${action.periodicCall ? `\n                ${applyTemplate(action.periodicCall, step.args)}` : ""}\n                if (${applyTemplate(action.completionCondition || "false", step.args)}) setState(${next});\n                break;`;
  }).join("\n\n");
  return `package ${model.java.packageName};

import com.pedropathing.follower.Follower;
import com.pedropathing.geometry.BezierCurve;
import com.pedropathing.geometry.BezierLine;
import com.pedropathing.geometry.Pose;
import com.pedropathing.paths.PathChain;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.teamcode.pedroPathing.Constants;

@Autonomous(name = "${model.java.opModeName}", group = "${model.java.group}")
public class ${javaName(model.java.className, "GeneratedAuto")} extends OpMode {
    private Follower follower;
${pathFields}
    private int pathState = 0;
    private boolean stateStarted = false;
    private final ElapsedTime stateTimer = new ElapsedTime();

    @Override
    public void init() {
        follower = Constants.createFollower(hardwareMap);
        follower.setStartingPose(new Pose(${model.startPose.x}, ${model.startPose.y}, Math.toRadians(${model.startPose.headingDegrees})));
        buildPaths();
        // Initialize the robot subsystems referenced by your action calls here.
    }

    private void buildPaths() {
${builders}
    }

    @Override
    public void start() {
        setState(0);
    }

    @Override
    public void loop() {
        follower.update();
        autonomousUpdate();
    }

    private void setState(int nextState) {
        pathState = nextState;
        stateStarted = false;
        stateTimer.reset();
    }

    private void autonomousUpdate() {
        switch (pathState) {
${cases}

            case ${model.steps.length}:
                // Autonomous complete.
                break;
        }
    }

    // Robot-specific action calls are preserved exactly from the action library.
    // Keep or move your existing action methods and subsystem fields into this class.
}
`;
}

function validate(model: AutoModel): string[] {
  const issues: string[] = [];
  const lineIds = new Set(model.lines.map((line) => line.id));
  const pathIds = new Set(model.paths.map((path) => path.id));
  const actionIds = new Set(model.actions.map((action) => action.id));
  if (!model.paths.length) issues.push("Add at least one path.");
  if (!model.steps.length) issues.push("The timeline is empty.");
  for (const path of model.paths) {
    if (!path.lineIds.length) issues.push(`${path.name} has no segments.`);
    path.lineIds.forEach((id) => { if (!lineIds.has(id)) issues.push(`${path.name} references missing segment ${id}.`); });
  }
  for (const line of model.lines) {
    [line.endPoint, ...line.controlPoints].forEach((point) => {
      if (point.x < 0 || point.x > 144 || point.y < 0 || point.y > 144) issues.push(`${line.name} leaves the 144-inch field.`);
    });
  }
  for (const action of model.actions) {
    if (!action.javaCall.trim()) issues.push(`${action.label} has no Java call.`);
    if (action.mode === "blocking" && !action.completionCondition.trim()) issues.push(`${action.label} needs a completion condition.`);
  }
  for (const step of model.steps) {
    if (step.type === "path" && !pathIds.has(step.pathId)) issues.push(`Timeline references missing path ${step.pathId}.`);
    if (step.type === "action" && !actionIds.has(step.actionId)) issues.push(`Timeline references missing action ${step.actionId}.`);
    if (step.type === "wait" && step.durationMs < 0) issues.push("Wait durations cannot be negative.");
  }
  let cursor: XY = { x: model.startPose.x, y: model.startPose.y };
  for (const step of model.steps) {
    if (step.type !== "path") continue;
    const path = model.paths.find((candidate) => candidate.id === step.pathId);
    if (!path) continue;
    if (!samePoint(path.startPoint, cursor)) issues.push(`${path.name} does not start at the previous path endpoint.`);
    cursor = pathEnd(path, model.lines);
  }
  return [...new Set(issues)];
}

function toVisualizer(model: AutoModel) {
  const sequence: any[] = [];
  const orderedLineIds: string[] = [];
  const rememberLine = (lineId: string) => {
    if (!orderedLineIds.includes(lineId)) orderedLineIds.push(lineId);
  };
  for (const step of model.steps) {
    if (step.type === "path") {
      const path = model.paths.find((candidate) => candidate.id === step.pathId);
      path?.lineIds.forEach((lineId) => {
        rememberLine(lineId);
        sequence.push({ kind: "path", lineId });
      });
    } else if (step.type === "wait") {
      sequence.push({ kind: "wait", id: step.id, name: step.label, durationMs: step.durationMs });
    }
  }
  model.paths.forEach((path) => path.lineIds.forEach(rememberLine));
  model.lines.forEach((line) => rememberLine(line.id));
  return {
    startPoint: { x: model.startPose.x, y: model.startPose.y, heading: "constant", degrees: model.startPose.headingDegrees },
    // Pedro's .pp format infers every segment start from the prior segment end,
    // so timeline order is also geometry order.
    lines: orderedLineIds.flatMap((id) => {
      const line = model.lines.find((candidate) => candidate.id === id);
      return line ? [line] : [];
    }),
    shapes: [],
    sequence,
    pathChains: model.paths.map((path) => ({ id: path.id, name: path.name, color: path.color, lineIds: path.lineIds })),
    version: "1.2.1",
    timestamp: new Date().toISOString(),
  };
}

function richSpec(model: AutoModel) {
  return {
    schemaVersion: 1,
    kind: model.kind,
    name: model.name,
    java: model.java,
    startPose: model.startPose,
    paths: model.paths,
    actions: model.actions,
    steps: model.steps,
    visualizer: toVisualizer(model),
  };
}

function download(name: string, value: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pathD(start: XY, line: Line) {
  const points = line.controlPoints;
  if (!points.length) return `M ${start.x} ${start.y} L ${line.endPoint.x} ${line.endPoint.y}`;
  if (points.length === 1) return `M ${start.x} ${start.y} Q ${points[0].x} ${points[0].y} ${line.endPoint.x} ${line.endPoint.y}`;
  if (points.length === 2) return `M ${start.x} ${start.y} C ${points[0].x} ${points[0].y} ${points[1].x} ${points[1].y} ${line.endPoint.x} ${line.endPoint.y}`;
  return `M ${start.x} ${start.y} ${points.map((point) => `L ${point.x} ${point.y}`).join(" ")} L ${line.endPoint.x} ${line.endPoint.y}`;
}

export function RichVisualizer() {
  const [model, setModel] = useState<AutoModel>(starter);
  const [selectedPathId, setSelectedPathId] = useState(starter.paths[0].id);
  const [selectedLineId, setSelectedLineId] = useState(starter.lines[0].id);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState(0);
  const [notice, setNotice] = useState("Example auto loaded");
  const [showCode, setShowCode] = useState(false);
  const [addPathId, setAddPathId] = useState(starter.paths[0].id);
  const [addActionId, setAddActionId] = useState(starter.actions[0].id);
  const [drag, setDrag] = useState<{ kind: "end" | "control"; pathId: string; lineId: string; index?: number } | null>(null);
  const [camera, setCamera] = useState<Camera>({ zoom: 1, focusX: 0.5, focusY: 0.5 });
  const [pan, setPan] = useState<{ clientX: number; clientY: number; camera: Camera } | null>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 500 });
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [pathsCollapsed, setPathsCollapsed] = useState(false);
  const [actionsCollapsed, setActionsCollapsed] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [collapsedActionGroups, setCollapsedActionGroups] = useState<string[]>([]);
  const [draggedStep, setDraggedStep] = useState<number | null>(null);
  const [dragTargetStep, setDragTargetStep] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fieldShellRef = useRef<HTMLDivElement>(null);
  const dragTargetRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const issues = useMemo(() => validate(model), [model]);
  const java = useMemo(() => generateJava(model), [model]);
  const selectedPath = model.paths.find((path) => path.id === selectedPathId) ?? model.paths[0];
  const selectedLine = model.lines.find((line) => line.id === selectedLineId) ?? model.lines.find((line) => selectedPath?.lineIds.includes(line.id));
  const selectedAction = model.actions.find((action) => action.id === selectedActionId);
  const selectedTimelineStep = model.steps[selectedStep];
  const actionGroups = useMemo(() => {
    const groups = new Map<string, { key: string; category: string; group: string; className: string; actions: ActionDefinition[] }>();
    for (const action of model.actions) {
      const source = action.source ?? { category: "manual", group: "Manual", className: "Local" };
      const key = `${source.category}/${source.group}/${source.className}`;
      const existing = groups.get(key) ?? { key, category: source.category, group: source.group, className: source.className, actions: [] };
      existing.actions.push(action);
      groups.set(key, existing);
    }
    return [...groups.values()];
  }, [model.actions]);
  const view = useMemo(() => fieldView(camera, viewport), [camera, viewport]);

  useEffect(() => {
    const saved = localStorage.getItem("ftc-toolchain-rich-auto");
    if (!saved) return;
    const timer = window.setTimeout(() => {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.kind === "ftc-toolchain/autonomous" && parsed?.visualizer) {
          setModel(modelFromFiles(parsed, null));
          setNotice("Recovered local draft");
        }
      } catch { /* Ignore a corrupt local draft. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem("ftc-toolchain-rich-auto", JSON.stringify(richSpec(model))), 250);
    return () => window.clearTimeout(timer);
  }, [model]);

  useEffect(() => {
    let cancelled = false;
    fetch("/studio-data.json", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return null;
      return response.json();
    }).then((local) => {
      if (cancelled || !local) return;
      const discovered = Array.isArray(local.actions) ? local.actions.map(normalizeAction) : [];
      if (local.spec) {
        const imported = modelFromFiles({ ...local.spec, actions: discovered }, null);
        setModel(imported);
        setSelectedPathId(imported.paths[0]?.id ?? "");
        setSelectedLineId(imported.paths[0]?.lineIds[0] ?? "");
        setAddPathId(imported.paths[0]?.id ?? "");
      } else {
        const actionIds = new Set(discovered.map((action: ActionDefinition) => action.id));
        setModel((current) => ({
          ...current,
          actions: discovered,
          steps: current.steps.filter((step) => step.type !== "action" || actionIds.has(step.actionId)),
        }));
      }
      setAddActionId(discovered[0]?.id ?? "");
      setNotice(`${discovered.length} robot actions imported from local code`);
    }).catch(() => { /* The public/static page has no local project bridge. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const element = fieldShellRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setViewport({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [libraryCollapsed, inspectorCollapsed, timelineCollapsed]);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = {
        x: clamp(view.x + ((event.clientX - rect.left) / rect.width) * view.width),
        y: clamp(144 - (view.y + ((event.clientY - rect.top) / rect.height) * view.height)),
      };
      setModel((current) => {
        const previous = current.lines.find((line) => line.id === drag.lineId);
        if (!previous) return current;
        const nextLine = drag.kind === "end"
          ? { ...previous, endPoint: { ...previous.endPoint, ...point } }
          : { ...previous, controlPoints: previous.controlPoints.map((control, index) => index === drag.index ? point : control) };
        return replaceLine(current, drag.lineId, nextLine);
      });
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag, view]);

  useEffect(() => {
    if (!pan) return;
    const move = (event: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const startView = fieldView(pan.camera, { width: rect.width, height: rect.height });
      const desiredX = startView.x - ((event.clientX - pan.clientX) / rect.width) * startView.width;
      const desiredY = startView.y - ((event.clientY - pan.clientY) / rect.height) * startView.height;
      const rangeX = Math.max(0.0001, startView.baseWidth - startView.width);
      const rangeY = Math.max(0.0001, startView.baseHeight - startView.height);
      setCamera({
        zoom: pan.camera.zoom,
        focusX: Math.max(0, Math.min(1, (desiredX - startView.baseX) / rangeX)),
        focusY: Math.max(0, Math.min(1, (desiredY - startView.baseY) / rangeY)),
      });
    };
    const up = () => setPan(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [pan]);

  useEffect(() => {
    if (draggedStep === null) return;
    const move = (event: PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-step-index]");
      if (target?.dataset.stepIndex) {
        const index = Number(target.dataset.stepIndex);
        dragTargetRef.current = index;
        setDragTargetStep(index);
      }
    };
    const up = () => {
      const target = dragTargetRef.current;
      if (target !== null && target !== draggedStep) {
        setModel((current) => {
          const steps = [...current.steps];
          const [moved] = steps.splice(draggedStep, 1);
          steps.splice(target, 0, moved);
          return ensureTimelineContinuity({ ...current, steps });
        });
        setSelectedStep(target);
      }
      setDraggedStep(null);
      setDragTargetStep(null);
      dragTargetRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [draggedStep]);

  function zoomTo(nextZoom: number, focusX = 0.5, focusY = 0.5) {
    setCamera((current) => {
      const zoom = Math.max(1, Math.min(4, nextZoom));
      const currentView = fieldView(current, viewport);
      const focusFieldX = currentView.x + focusX * currentView.width;
      const focusFieldY = currentView.y + focusY * currentView.height;
      const nextWidth = currentView.baseWidth / zoom;
      const nextHeight = currentView.baseHeight / zoom;
      const desiredX = focusFieldX - focusX * nextWidth;
      const desiredY = focusFieldY - focusY * nextHeight;
      const rangeX = Math.max(0.0001, currentView.baseWidth - nextWidth);
      const rangeY = Math.max(0.0001, currentView.baseHeight - nextHeight);
      return {
        zoom,
        focusX: zoom === 1 ? 0.5 : Math.max(0, Math.min(1, (desiredX - currentView.baseX) / rangeX)),
        focusY: zoom === 1 ? 0.5 : Math.max(0, Math.min(1, (desiredY - currentView.baseY) / rangeY)),
      };
    });
  }

  function wheelField(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const focusX = (event.clientX - rect.left) / rect.width;
    const focusY = (event.clientY - rect.top) / rect.height;
    zoomTo(camera.zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), focusX, focusY);
  }

  function startPan(event: ReactPointerEvent<SVGRectElement>) {
    event.preventDefault();
    setPan({ clientX: event.clientX, clientY: event.clientY, camera });
  }

  const updatePath = (patch: Partial<Path>) => setModel((current) => ({ ...current, paths: current.paths.map((path) => path.id === selectedPath?.id ? { ...path, ...patch } : path) }));
  const updateLine = (patch: Partial<Line>) => setModel((current) => {
    const previous = current.lines.find((line) => line.id === selectedLine?.id);
    return previous ? replaceLine(current, previous.id, { ...previous, ...patch }) : current;
  });
  const updateAction = (patch: Partial<ActionDefinition>) => setModel((current) => ({ ...current, actions: current.actions.map((action) => action.id === selectedAction?.id ? { ...action, ...patch } : action) }));
  const updateStep = (patch: Partial<Step>) => setModel((current) => ensureTimelineContinuity({ ...current, steps: current.steps.map((step, index) => index === selectedStep ? { ...step, ...patch } as Step : step) }));

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    try {
      let spec: any = null;
      let pp: any = null;
      for (const file of files) {
        const parsed = JSON.parse(await file.text());
        if (file.name.endsWith(".pp") || parsed?.startPoint && parsed?.lines) pp = parsed;
        else spec = parsed;
      }
      const imported = modelFromFiles(spec, pp);
      setModel(imported);
      setSelectedPathId(imported.paths[0]?.id ?? "");
      setSelectedLineId(imported.paths[0]?.lineIds[0] ?? "");
      setSelectedActionId(null);
      setSelectedStep(0);
      setAddPathId(imported.paths[0]?.id ?? "");
      setAddActionId(imported.actions[0]?.id ?? "");
      setNotice(`Imported ${files.map((file) => file.name).join(" + ")}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not import that file");
    } finally {
      event.target.value = "";
    }
  }

  function addPath() {
    const index = model.paths.length + 1;
    const id = `Path${index}`;
    const lineId = nextId("segment");
    const color = palette[(index - 1) % palette.length];
    const startPoint = model.paths.at(-1)
      ? (() => { const last = model.lines.find((line) => line.id === model.paths.at(-1)!.lineIds.at(-1)); return last ? { x: last.endPoint.x, y: last.endPoint.y } : { x: 24, y: 24 }; })()
      : { x: model.startPose.x, y: model.startPose.y };
    const line: Line = { id: lineId, name: `${id} segment`, color, controlPoints: [], endPoint: { x: clamp(startPoint.x + 18), y: clamp(startPoint.y), heading: "constant", degrees: model.startPose.headingDegrees } };
    setModel((current) => ({ ...current, lines: [...current.lines, line], paths: [...current.paths, { id, name: id, color, lineIds: [lineId], startPoint }] }));
    setSelectedPathId(id); setSelectedLineId(lineId); setSelectedActionId(null); setSelectedStep(-1); setAddPathId(id);
  }

  function addSegment() {
    if (!selectedPath) return;
    const last = model.lines.find((line) => line.id === selectedPath.lineIds.at(-1));
    const start = last ? last.endPoint : selectedPath.startPoint;
    const id = nextId("segment");
    const line: Line = { id, name: `${selectedPath.name} ${selectedPath.lineIds.length + 1}`, color: selectedPath.color, controlPoints: [], endPoint: { x: clamp(start.x + 14), y: start.y, heading: "constant", degrees: 0 } };
    setModel((current) => ({ ...current, lines: [...current.lines, line], paths: current.paths.map((path) => path.id === selectedPath.id ? { ...path, lineIds: [...path.lineIds, id] } : path) }));
    setSelectedLineId(id);
  }

  function addAction() {
    const id = `action${model.actions.length + 1}`;
    const action: ActionDefinition = { id, label: "New robot action", mode: "instant", javaCall: `${id}();`, periodicCall: "", completionCondition: "", parameters: [], source: { category: "manual", group: "Manual", className: "Local" } };
    setModel((current) => ({ ...current, actions: [...current.actions, action] }));
    setSelectedActionId(id); setAddActionId(id);
  }

  function removeSelectedPath() {
    if (!selectedPath) return;
    const remaining = model.paths.filter((path) => path.id !== selectedPath.id);
    const removedLines = new Set(selectedPath.lineIds);
    setModel((current) => ensureTimelineContinuity({
      ...current,
      paths: current.paths.filter((path) => path.id !== selectedPath.id),
      lines: current.lines.filter((line) => !removedLines.has(line.id)),
      steps: current.steps.filter((step) => step.type !== "path" || step.pathId !== selectedPath.id),
    }));
    setSelectedPathId(remaining[0]?.id ?? "");
    setSelectedLineId(remaining[0]?.lineIds[0] ?? "");
    setAddPathId(remaining[0]?.id ?? "");
  }

  function removeSelectedAction() {
    if (!selectedAction) return;
    const remaining = model.actions.filter((action) => action.id !== selectedAction.id);
    setModel((current) => ({
      ...current,
      actions: current.actions.filter((action) => action.id !== selectedAction.id),
      steps: current.steps.filter((step) => step.type !== "action" || step.actionId !== selectedAction.id),
    }));
    setSelectedActionId(null);
    setAddActionId(remaining[0]?.id ?? "");
  }

  function appendStep(step: Step) {
    setModel((current) => ensureTimelineContinuity({ ...current, steps: [...current.steps, step] }));
    setSelectedStep(model.steps.length); setSelectedActionId(null);
  }

  function moveStep(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= model.steps.length) return;
    setModel((current) => {
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return ensureTimelineContinuity({ ...current, steps });
    });
    setSelectedStep(target);
  }

  function updateStartPose(patch: Partial<AutoModel["startPose"]>) {
    setModel((current) => ensureTimelineContinuity({ ...current, startPose: { ...current.startPose, ...patch } }));
  }

  const renderPaths = model.paths.flatMap((path) => {
    let start = path.startPoint;
    return path.lineIds.flatMap((lineId) => {
      const line = model.lines.find((candidate) => candidate.id === lineId);
      if (!line) return [];
      const item = { path, line, start };
      start = line.endPoint;
      return [item];
    });
  });

  return <main className={`${styles.studio} ${layout.studio} ${timelineCollapsed ? layout.timelineCollapsedStudio : ""}`}>
    <header className={styles.topbar}>
      <div className={styles.identity}><Link href="/" aria-label="FTC Toolchain home">FT</Link><div><b>Autonomous Studio</b><span>FTC Toolchain × Pedro Pathing</span></div></div>
      <label className={styles.projectName}><span>PROJECT</span><input value={model.name} onChange={(e) => setModel({ ...model, name: e.target.value, java: { ...model.java, opModeName: e.target.value } })} /></label>
      <div className={styles.fileActions}>
        <input ref={fileRef} className={styles.hidden} type="file" multiple accept=".pp,.json,.ftcauto.json" onChange={importFiles} />
        <button onClick={() => fileRef.current?.click()}>Import</button>
        <button onClick={() => download(`${javaName(model.java.className, "Auto")}.ftcauto.json`, JSON.stringify(richSpec(model), null, 2))}>Export spec</button>
        <button onClick={() => download(`${javaName(model.java.className, "Auto")}.pp`, JSON.stringify(toVisualizer(model), null, 2))}>Export .pp</button>
        <button className={styles.codeButton} onClick={() => setShowCode(true)}>Generate Java</button>
      </div>
    </header>

    <div className={styles.statusbar}><span className={issues.length ? styles.warnDot : styles.goodDot} />{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to review` : "Valid autonomous"}<i /> <span>{notice}</span><strong>Saved locally</strong></div>

    <div className={`${styles.workspace} ${layout.workspace} ${libraryCollapsed ? layout.libraryCollapsedWorkspace : ""} ${inspectorCollapsed ? layout.inspectorCollapsedWorkspace : ""}`}>
      <aside className={`${styles.library} ${layout.library} ${libraryCollapsed ? layout.sideCollapsed : ""}`}>
        <div className={layout.sideTitle}><span>{libraryCollapsed ? "LIB" : "LIBRARY"}</span><button onClick={() => setLibraryCollapsed((value) => !value)} aria-label={libraryCollapsed ? "Expand library" : "Collapse library"}>{libraryCollapsed ? "›" : "‹"}</button></div>
        {!libraryCollapsed && <>
        <section><div className={styles.panelTitle}><button className={layout.sectionToggle} onClick={() => setPathsCollapsed((value) => !value)}><span>{pathsCollapsed ? "▸" : "▾"} PATHS</span></button><button onClick={addPath}>+</button></div>
          {!pathsCollapsed && <div className={styles.libraryList}>{model.paths.map((path) => <button key={path.id} className={selectedPathId === path.id && !selectedActionId && selectedStep < 0 ? styles.activeItem : ""} onClick={() => { setSelectedPathId(path.id); setSelectedLineId(path.lineIds[0]); setSelectedActionId(null); setSelectedStep(-1); }}><i style={{ background: path.color }} /><span><b>{path.name}</b><small>{path.lineIds.length} segment{path.lineIds.length === 1 ? "" : "s"}</small></span><em>›</em></button>)}</div>}
        </section>
        <section><div className={styles.panelTitle}><button className={layout.sectionToggle} onClick={() => setActionsCollapsed((value) => !value)}><span>{actionsCollapsed ? "▸" : "▾"} ROBOT ACTIONS</span></button><button onClick={addAction} aria-label="Add manual action">+</button></div>
          {!actionsCollapsed && <><p className={styles.libraryHint}>Imported from local <code>subsystems/</code> and <code>automations/</code> code.</p>
          <div className={layout.actionTree}>{actionGroups.map((group) => {
            const collapsed = collapsedActionGroups.includes(group.key);
            return <div key={group.key} className={layout.actionGroup}><button className={layout.folderRow} onClick={() => setCollapsedActionGroups((current) => current.includes(group.key) ? current.filter((key) => key !== group.key) : [...current, group.key])}><span>{collapsed ? "▸" : "▾"} {group.category === "subsystems" ? "SUBSYSTEM" : group.category === "automations" ? "AUTOMATION" : "MANUAL"}</span><b>{group.group} / {group.className}</b><small>{group.actions.length}</small></button>
              {!collapsed && <div className={styles.libraryList}>{group.actions.map((action) => <button key={action.id} className={selectedActionId === action.id ? styles.activeItem : ""} onClick={() => { setSelectedActionId(action.id); setSelectedStep(-1); }}><i className={action.mode === "blocking" ? styles.blockingIcon : styles.actionIcon}>{action.mode === "blocking" ? "↻" : "⚡"}</i><span><b>{action.label}</b><small>{action.mode}</small></span><em>›</em></button>)}</div>}
            </div>;
          })}</div></>}
        </section>
        </>}
      </aside>

      <section className={`${styles.fieldArea} ${layout.fieldArea}`}>
        <div className={styles.fieldHeader}><div><span>FIELD VIEW</span><b>144 × 144 in field · rectangular viewport</b></div><p>Wheel to zoom · drag anywhere empty to pan · starts stay connected</p></div>
        <div ref={fieldShellRef} className={`${styles.fieldShell} ${layout.fieldShell}`}>
          <div className={styles.fieldLabels}><span>BLUE</span><span>AUDIENCE</span><span>RED</span></div>
          <div className={layout.cameraControls}><button onClick={() => zoomTo(camera.zoom / 1.25)} aria-label="Zoom out">−</button><span>{Math.round(camera.zoom * 100)}%</span><button onClick={() => zoomTo(camera.zoom * 1.25)} aria-label="Zoom in">+</button><button onClick={() => setCamera({ zoom: 1, focusX: 0.5, focusY: 0.5 })}>Fit</button></div>
          <svg ref={svgRef} className={`${styles.field} ${layout.field} ${pan ? layout.panning : ""}`} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onWheel={wheelField} role="img" aria-label="Interactive FTC autonomous field path editor">
            <defs><pattern id="minor-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M 12 0 L 0 0 0 12" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth=".35" /></pattern><pattern id="major-grid" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="url(#minor-grid)" /><path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth=".45" /></pattern></defs>
            <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="#0a0e10" onPointerDown={startPan} className={layout.panSurface} /><rect width="144" height="144" fill="#12181d" pointerEvents="none" /><rect width="144" height="144" fill="url(#major-grid)" pointerEvents="none" /><rect x="1" y="1" width="142" height="142" fill="none" stroke="rgba(255,255,255,.24)" strokeWidth=".7" pointerEvents="none" />
            <g transform="translate(0 144) scale(1 -1)">
              <path d="M 0 72 H 144 M 72 0 V 144" stroke="rgba(255,255,255,.13)" strokeWidth=".5" strokeDasharray="2 2" />
              {renderPaths.map(({ path, line, start }) => <g key={line.id} onPointerDown={() => { setSelectedPathId(path.id); setSelectedLineId(line.id); setSelectedActionId(null); setSelectedStep(-1); }}>
                <path d={pathD(start, line)} fill="none" stroke="rgba(0,0,0,.5)" strokeWidth="4" />
                <path d={pathD(start, line)} fill="none" stroke={path.color} strokeWidth={selectedLineId === line.id ? 2.1 : 1.35} opacity={selectedPathId === path.id ? 1 : .48} />
                {selectedLineId === line.id && <>
                  <path d={`M ${start.x} ${start.y} ${line.controlPoints.map((point) => `L ${point.x} ${point.y}`).join(" ")} L ${line.endPoint.x} ${line.endPoint.y}`} fill="none" stroke="rgba(255,255,255,.32)" strokeWidth=".45" strokeDasharray="1.5 1.5" />
                  <circle cx={start.x} cy={start.y} r="2.4" fill="#fff" stroke={path.color} strokeWidth="1.2" className={layout.lockedStart} />
                  {line.controlPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="2" fill="#111" stroke="#fff" strokeWidth=".8" className={styles.handle} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setDrag({ kind: "control", pathId: path.id, lineId: line.id, index }); }} />)}
                  <circle cx={line.endPoint.x} cy={line.endPoint.y} r="2.6" fill={path.color} stroke="#fff" strokeWidth=".9" className={styles.handle} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setDrag({ kind: "end", pathId: path.id, lineId: line.id }); }} />
                </>}
              </g>)}
              <g transform={`translate(${model.startPose.x} ${model.startPose.y}) rotate(${model.startPose.headingDegrees})`}><rect x="-7" y="-7" width="14" height="14" rx="2" fill="rgba(249,115,22,.12)" stroke="#f97316" strokeWidth=".8" /><path d="M 0 0 L 9 0" stroke="#f97316" strokeWidth="1.2" /><path d="M 9 0 L 6 -2 M 9 0 L 6 2" stroke="#f97316" strokeWidth="1" /></g>
            </g>
          </svg>
          <div className={styles.fieldLegend}><span><i className={styles.startLegend} />Auto-connected start</span><span><i className={styles.pointLegend} />Endpoint</span><span><i className={styles.controlLegend} />Control point</span></div>
        </div>
      </section>

      <aside className={`${styles.inspector} ${layout.inspector} ${inspectorCollapsed ? layout.sideCollapsed : ""}`}>
        <div className={`${styles.inspectorTitle} ${layout.inspectorTitle}`}><span>{inspectorCollapsed ? "EDIT" : "INSPECTOR"}</span>{!inspectorCollapsed && <small>{selectedAction ? "ACTION" : selectedTimelineStep ? "TIMELINE STEP" : "PATH"}</small>}<button onClick={() => setInspectorCollapsed((value) => !value)} aria-label={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}>{inspectorCollapsed ? "‹" : "›"}</button></div>
        {!inspectorCollapsed && <>
        {selectedAction ? <ActionEditor action={selectedAction} update={updateAction} remove={removeSelectedAction} /> : selectedTimelineStep ? <StepEditor step={selectedTimelineStep} paths={model.paths} actions={model.actions} update={updateStep} /> : selectedPath && selectedLine ? <PathEditor path={selectedPath} line={selectedLine} updatePath={updatePath} updateLine={updateLine} addSegment={addSegment} removePath={removeSelectedPath} selectLine={setSelectedLineId} /> : <p className={styles.empty}>Select a path, action, or timeline step.</p>}
        <div className={styles.javaSettings}><span>ROBOT START POSE</span><div className={styles.twoFields}><label>X<input type="number" value={model.startPose.x} onChange={(e) => updateStartPose({ x: number(e.target.value) })} /></label><label>Y<input type="number" value={model.startPose.y} onChange={(e) => updateStartPose({ y: number(e.target.value) })} /></label></div><label>Heading degrees<input type="number" value={model.startPose.headingDegrees} onChange={(e) => updateStartPose({ headingDegrees: number(e.target.value) })} /></label></div>
        <div className={styles.javaSettings}><span>JAVA TARGET</span><label>Package<input value={model.java.packageName} onChange={(e) => setModel({ ...model, java: { ...model.java, packageName: e.target.value } })} /></label><div className={styles.twoFields}><label>Class<input value={model.java.className} onChange={(e) => setModel({ ...model, java: { ...model.java, className: e.target.value } })} /></label><label>Group<input value={model.java.group} onChange={(e) => setModel({ ...model, java: { ...model.java, group: e.target.value } })} /></label></div></div>
        {issues.length > 0 && <div className={styles.issues}><span>REVIEW BEFORE EXPORT</span>{issues.map((issue) => <p key={issue}>! {issue}</p>)}</div>}
        </>}
      </aside>
    </div>

    <section className={`${styles.timeline} ${layout.timeline} ${timelineCollapsed ? layout.timelineCollapsed : ""}`}>
      <div className={styles.timelineTop}><div><button className={layout.timelineToggle} onClick={() => setTimelineCollapsed((value) => !value)} aria-label={timelineCollapsed ? "Expand timeline" : "Collapse timeline"}>{timelineCollapsed ? "▴" : "▾"}</button><span>AUTONOMOUS TIMELINE</span><b>{model.steps.length} steps · drag cards to reorder</b></div>{!timelineCollapsed && <div className={styles.adders}>
        <select value={addPathId} onChange={(e) => setAddPathId(e.target.value)}>{model.paths.map((path) => <option key={path.id} value={path.id}>{path.name}</option>)}</select><button disabled={!addPathId} onClick={() => appendStep({ id: nextId("step"), type: "path", pathId: addPathId })}>+ Path</button>
        <select value={addActionId} onChange={(e) => setAddActionId(e.target.value)}>{model.actions.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}</select><button disabled={!addActionId} onClick={() => { const action = model.actions.find((candidate) => candidate.id === addActionId); appendStep({ id: nextId("step"), type: "action", actionId: addActionId, args: Object.fromEntries((action?.parameters ?? []).map((p) => [p.name, p.defaultValue])) }); }}>+ Action</button>
        <button onClick={() => appendStep({ id: nextId("step"), type: "wait", durationMs: 500, label: "Wait" })}>+ Wait</button>
      </div>}</div>
      {!timelineCollapsed && <div className={styles.timelineRail}>{model.steps.map((step, index) => {
        const path = step.type === "path" ? model.paths.find((candidate) => candidate.id === step.pathId) : null;
        const action = step.type === "action" ? model.actions.find((candidate) => candidate.id === step.actionId) : null;
        return <div key={step.id} data-step-index={index} role="button" tabIndex={0} aria-label={`Edit step ${index + 1}`} className={`${styles.stepCard} ${layout.draggableStep} ${draggedStep === index ? layout.draggingStep : ""} ${dragTargetStep === index && draggedStep !== index ? layout.dragTarget : ""} ${selectedStep === index && !selectedActionId ? styles.selectedStep : ""}`} onClick={() => { setSelectedStep(index); setSelectedActionId(null); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedStep(index); setSelectedActionId(null); } }}>
          <button className={layout.dragHandle} aria-label={`Drag step ${index + 1}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); dragTargetRef.current = index; setDraggedStep(index); setDragTargetStep(index); }}>⋮⋮</button><div className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</div><i className={step.type === "path" ? styles.pathStep : step.type === "action" ? styles.actionStep : styles.waitStep}>{step.type === "path" ? "↗" : step.type === "action" ? "⚡" : "◷"}</i>
          <span><small>{step.type}</small><b>{path?.name ?? action?.label ?? (step.type === "wait" ? `${step.durationMs} ms` : "Missing")}</b></span>
          <div className={styles.stepTools}><button aria-label="Move step left" onClick={(e) => { e.stopPropagation(); moveStep(index, -1); }}>←</button><button aria-label="Move step right" onClick={(e) => { e.stopPropagation(); moveStep(index, 1); }}>→</button><button aria-label="Delete step" onClick={(e) => { e.stopPropagation(); setModel((current) => ensureTimelineContinuity({ ...current, steps: current.steps.filter((_, i) => i !== index) })); }}>×</button></div>
        </div>;
      })}<div className={styles.finishCard}><i>✓</i><span><small>finish</small><b>Auto complete</b></span></div></div>}
    </section>

    <footer className={styles.footer}><span>Localhost only · works offline · autosaves in this browser · no LLM required</span><a href="https://github.com/Pedro-Pathing/Visualizer" target="_blank" rel="noreferrer">Compatible with Pedro Visualizer .pp ↗</a></footer>

    {showCode && <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Generated Java state machine"><div className={styles.codeModal}><header><div><span>GENERATED JAVA</span><b>{model.java.className}.java</b></div><button onClick={() => setShowCode(false)}>×</button></header><div className={styles.codeNotice}><span>✓</span><p>Paths and state transitions are complete. Robot-specific action calls are preserved exactly; keep the matching subsystem fields and action methods when integrating this class.</p></div><textarea readOnly value={java} spellCheck={false} /><div className={styles.modalActions}><button onClick={async () => { await navigator.clipboard.writeText(java); setNotice("Java copied to clipboard"); }}>Copy Java</button><button className={styles.codeButton} onClick={() => download(`${javaName(model.java.className, "GeneratedAuto")}.java`, java, "text/x-java-source")}>Download .java</button></div></div></div>}
  </main>;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return <label>{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function PathEditor({ path, line, updatePath, updateLine, addSegment, removePath, selectLine }: { path: Path; line: Line; updatePath: (patch: Partial<Path>) => void; updateLine: (patch: Partial<Line>) => void; addSegment: () => void; removePath: () => void; selectLine: (id: string) => void }) {
  const heading = line.endPoint;
  const setHeading = (kind: string) => updateLine({ endPoint: { x: heading.x, y: heading.y, ...(kind === "linear" ? { heading: "linear", startDeg: 0, endDeg: 0 } : kind === "tangential" ? { heading: "tangential", reverse: false } : { heading: "constant", degrees: 0 }) } as Point });
  return <div className={styles.formStack}>
    <Field label="Path name" value={path.name} onChange={(value) => updatePath({ name: value })} />
    <div className={`${styles.behavior} ${layout.connectionNotice}`}><span>AUTO-CONNECTED START</span><p>({path.startPoint.x}, {path.startPoint.y}) — derived from the robot start or the previous timeline path endpoint. Move that endpoint and this start moves with it.</p></div>
    <label>Path color<input type="color" value={path.color} onChange={(e) => updatePath({ color: e.target.value })} /></label>
    <div className={styles.segmentTabs}>{path.lineIds.map((id, index) => <button key={id} className={id === line.id ? styles.segmentActive : ""} onClick={() => selectLine(id)}>{index + 1}</button>)}<button onClick={addSegment}>+</button></div>
    <div className={styles.twoFields}><Field label="End X" type="number" value={line.endPoint.x} onChange={(value) => updateLine({ endPoint: { ...line.endPoint, x: number(value) } })} /><Field label="End Y" type="number" value={line.endPoint.y} onChange={(value) => updateLine({ endPoint: { ...line.endPoint, y: number(value) } })} /></div>
    <label>Curve type<select value={line.controlPoints.length ? "curve" : "line"} onChange={(e) => updateLine({ controlPoints: e.target.value === "curve" ? [{ x: (path.startPoint.x + line.endPoint.x) / 2, y: (path.startPoint.y + line.endPoint.y) / 2 }] : [] })}><option value="line">Bezier line</option><option value="curve">Bezier curve</option></select></label>
    {line.controlPoints.map((point, index) => <div className={styles.controlRow} key={index}><Field label={`Control ${index + 1} X`} type="number" value={point.x} onChange={(value) => updateLine({ controlPoints: line.controlPoints.map((p, i) => i === index ? { ...p, x: number(value) } : p) })} /><Field label="Y" type="number" value={point.y} onChange={(value) => updateLine({ controlPoints: line.controlPoints.map((p, i) => i === index ? { ...p, y: number(value) } : p) })} /><button onClick={() => updateLine({ controlPoints: line.controlPoints.filter((_, i) => i !== index) })}>×</button></div>)}
    {line.controlPoints.length > 0 && line.controlPoints.length < 2 && <button className={styles.secondaryAction} onClick={() => updateLine({ controlPoints: [...line.controlPoints, { x: line.endPoint.x - 6, y: line.endPoint.y + 6 }] })}>+ Control point</button>}
    <label>Heading<select value={heading.heading} onChange={(e) => setHeading(e.target.value)}><option value="constant">Constant</option><option value="linear">Linear</option><option value="tangential">Tangential</option></select></label>
    {heading.heading === "constant" && <Field label="Heading degrees" type="number" value={heading.degrees} onChange={(value) => updateLine({ endPoint: { ...heading, degrees: number(value) } })} />}
    {heading.heading === "linear" && <div className={styles.twoFields}><Field label="Start heading" type="number" value={heading.startDeg} onChange={(value) => updateLine({ endPoint: { ...heading, startDeg: number(value) } })} /><Field label="End heading" type="number" value={heading.endDeg} onChange={(value) => updateLine({ endPoint: { ...heading, endDeg: number(value) } })} /></div>}
    {heading.heading === "tangential" && <label className={styles.check}><input type="checkbox" checked={heading.reverse} onChange={(e) => updateLine({ endPoint: { ...heading, reverse: e.target.checked } })} /> Reverse tangent</label>}
    <button className={styles.secondaryAction} onClick={removePath}>Delete path and timeline uses</button>
  </div>;
}

function ActionEditor({ action, update, remove }: { action: ActionDefinition; update: (patch: Partial<ActionDefinition>) => void; remove: () => void }) {
  return <div className={styles.formStack}>
    <Field label="Action label" value={action.label} onChange={(label) => update({ label })} />
    <div className={styles.readonlyId}><span>ACTION ID</span><code>{action.id}</code></div>
    {action.source && <div className={styles.behavior}><span>{action.source.category.toUpperCase()} / {action.source.group}</span><p>{action.source.className}{action.source.file ? ` · ${action.source.file}` : ""}</p></div>}
    <label>Execution<select value={action.mode} onChange={(e) => update({ mode: e.target.value as ActionDefinition["mode"] })}><option value="instant">Instant — advance immediately</option><option value="blocking">Blocking — wait until complete</option></select></label>
    <label>Java call<textarea value={action.javaCall} onChange={(e) => update({ javaCall: e.target.value })} placeholder="barIntake.spinIntake();" /></label>
    {action.mode === "blocking" && <><label>Periodic call <small>optional, runs every loop</small><textarea value={action.periodicCall} onChange={(e) => update({ periodicCall: e.target.value })} placeholder="handleOuttakeRoutine();" /></label><label>Completion condition<textarea value={action.completionCondition} onChange={(e) => update({ completionCondition: e.target.value })} placeholder="!outtakeInProgress" /></label></>}
    <div className={styles.parameterTitle}><span>PARAMETERS</span><button onClick={() => update({ parameters: [...action.parameters, { name: `value${action.parameters.length + 1}`, defaultValue: "0" }] })}>+</button></div>
    {!action.parameters.length && <p className={styles.emptySmall}>No parameters. Add one to use placeholders such as <code>{"{power}"}</code> in the Java call.</p>}
    {action.parameters.map((parameter, index) => <div className={styles.parameterRow} key={index}><input value={parameter.name} onChange={(e) => update({ parameters: action.parameters.map((p, i) => i === index ? { ...p, name: e.target.value } : p) })} /><input value={parameter.defaultValue} onChange={(e) => update({ parameters: action.parameters.map((p, i) => i === index ? { ...p, defaultValue: e.target.value } : p) })} /><button onClick={() => update({ parameters: action.parameters.filter((_, i) => i !== index) })}>×</button></div>)}
    <button className={styles.secondaryAction} onClick={remove}>Delete action and timeline uses</button>
  </div>;
}

function StepEditor({ step, paths, actions, update }: { step: Step; paths: Path[]; actions: ActionDefinition[]; update: (patch: Partial<Step>) => void }) {
  if (step.type === "path") return <div className={styles.formStack}><label>Path<select value={step.pathId} onChange={(e) => update({ pathId: e.target.value } as Partial<Step>)}>{paths.map((path) => <option key={path.id} value={path.id}>{path.name}</option>)}</select></label><div className={styles.behavior}><span>FOLLOW BEHAVIOR</span><p>The generated state starts this path once, calls <code>follower.update()</code> every loop, and advances only after <code>follower.isBusy()</code> becomes false.</p></div></div>;
  if (step.type === "wait") return <div className={styles.formStack}><Field label="Label" value={step.label} onChange={(label) => update({ label } as Partial<Step>)} /><Field label="Duration (ms)" type="number" value={step.durationMs} onChange={(value) => update({ durationMs: number(value) } as Partial<Step>)} /></div>;
  const action = actions.find((candidate) => candidate.id === step.actionId);
  return <div className={styles.formStack}><label>Action<select value={step.actionId} onChange={(e) => update({ actionId: e.target.value, args: {} } as Partial<Step>)}>{actions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>{action?.parameters.map((parameter) => <Field key={parameter.name} label={parameter.name} value={step.args[parameter.name] ?? parameter.defaultValue} onChange={(value) => update({ args: { ...step.args, [parameter.name]: value } } as Partial<Step>)} />)}<div className={styles.behavior}><span>{action?.mode === "blocking" ? "BLOCKING ACTION" : "INSTANT ACTION"}</span><p>{action?.mode === "blocking" ? "The state calls this action once, runs its periodic call, and waits for the completion condition." : "The state calls this action once and advances immediately."}</p></div></div>;
}
