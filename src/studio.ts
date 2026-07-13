import { createServer, IncomingMessage, Server } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { extractAutonomous, generatePreservedJava } from "./autonomous.js";
import { REPO_ROOT, TEAMCODE_JAVA_SUBDIR, ToolError, resolveProject } from "./paths.js";

export interface StudioAction {
  id: string;
  label: string;
  javaMethod: string;
  mode: "instant" | "blocking";
  javaCall: string;
  periodicCall: string;
  completionCondition: string;
  parameters: { name: string; defaultValue: string }[];
  source: {
    category: "subsystems" | "automations";
    group: string;
    className: string;
    file: string;
  };
}

export interface OpenStudioArgs {
  projectPath?: string;
  sourceFile?: string;
  port?: number;
  openBrowser?: boolean;
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

let activeServer: Server | null = null;
let activeSession: {
  project: string;
  sourceFile?: string;
  originalSource?: string;
  draft?: Record<string, unknown>;
} | null = null;

export async function closeAutonomousStudio(): Promise<void> {
  const server = activeServer;
  activeServer = null;
  activeSession = null;
  if (!server) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function jsonBody(request: IncomingMessage, maximumBytes = 2_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new ToolError("Studio request is too large.");
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ToolError("Studio sent invalid JSON.");
  }
}

export function getAutonomousStudioDraft(): string {
  if (!activeSession) throw new ToolError("No Autonomous Studio session is running. Open one first.");
  if (!activeSession.draft) throw new ToolError("The open Autonomous Studio has not synced a draft yet.");
  return JSON.stringify({
    projectPath: activeSession.project,
    sourceFile: activeSession.sourceFile ?? null,
    originalJava: activeSession.originalSource ?? null,
    studioSpec: activeSession.draft,
    instructions: activeSession.originalSource
      ? "Preserve imports, annotations, subsystem fields, lifecycle methods, periodic loop logic, helper routines, path overload arguments, and unrelated state-machine conditions. Integrate the studioSpec geometry/timeline into this existing class instead of generating a replacement shell."
      : "Generate a complete autonomous from studioSpec and the robot actions available in the project.",
  }, null, 2);
}

function walkJava(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkJava(target));
    else if (entry.isFile() && entry.name.endsWith(".java")) files.push(target);
  }
  return files;
}

function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function lowerCamel(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function splitParameters(value: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "<" || value[index] === "(" || value[index] === "[") depth++;
    else if (value[index] === ">" || value[index] === ")" || value[index] === "]") depth--;
    else if (value[index] === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const final = value.slice(start).trim();
  if (final) result.push(final);
  return result;
}

function defaultForType(type: string): string {
  const normalized = type.replace(/\s+/g, "");
  if (normalized === "boolean" || normalized === "Boolean") return "false";
  if (normalized === "String" || normalized === "CharSequence") return '""';
  if (normalized === "char" || normalized === "Character") return "'\\0'";
  if (/^(byte|short|int|long|float|double|Byte|Short|Integer|Long|Float|Double)$/.test(normalized)) return "0";
  return "null";
}

function actionCategory(relativeFile: string, source: string): { category: "subsystems" | "automations"; group: string } | null {
  const parts = relativeFile.split(/[\\/]/);
  const categoryIndex = parts.findIndex((part) => part === "subsystems" || part === "automations");
  if (categoryIndex >= 0) {
    const category = parts[categoryIndex] as "subsystems" | "automations";
    const folders = parts.slice(categoryIndex + 1, -1);
    return { category, group: folders.length ? folders.join(" / ") : category === "subsystems" ? "Core" : "General" };
  }
  if (source.includes("@ftc-toolchain generated: subsystem")) {
    const folders = parts.slice(0, -1).filter((part) => !["org", "firstinspires", "ftc", "teamcode"].includes(part));
    return { category: "subsystems", group: folders.length ? folders.join(" / ") : "Core" };
  }
  return null;
}

/** Read public void commands from the robot's subsystem and automation folders. */
export function discoverRobotActions(projectPath?: string): StudioAction[] {
  const project = resolveProject(projectPath);
  const javaRoot = join(project, TEAMCODE_JAVA_SUBDIR);
  const actions: StudioAction[] = [];
  for (const file of walkJava(javaRoot)) {
    const source = readFileSync(file, "utf8");
    const relativeFile = relative(javaRoot, file);
    const location = actionCategory(relativeFile, source);
    if (!location) continue;
    const className = source.match(/\b(?:class|record)\s+(\w+)/)?.[1] ?? file.slice(file.lastIndexOf(sep) + 1, -5);
    const receiver = lowerCamel(className);
    const methodRegex = /\bpublic\s+(static\s+)?void\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:throws\s+[^\{]+)?\{/g;
    for (const match of source.matchAll(methodRegex)) {
      const isStatic = Boolean(match[1]);
      const method = match[2];
      const parsedParameters = splitParameters(match[3]).flatMap((parameter) => {
        const cleaned = parameter.replace(/\bfinal\s+/g, "").replace(/@[A-Za-z_$][\w$]*(?:\([^)]*\))?\s*/g, "").trim();
        const name = cleaned.match(/([A-Za-z_$][\w$]*)\s*(?:\[\])?$/)?.[1];
        if (!name) return [];
        const type = cleaned.slice(0, cleaned.lastIndexOf(name)).trim();
        return [{ name, defaultValue: defaultForType(type) }];
      });
      const placeholders = parsedParameters.map((parameter) => `{${parameter.name}}`).join(", ");
      const id = `${location.category}/${location.group}/${className}.${method}`;
      actions.push({
        id,
        label: humanize(method),
        javaMethod: method,
        mode: "instant",
        javaCall: `${isStatic ? className : receiver}.${method}(${placeholders});`,
        periodicCall: "",
        completionCondition: "",
        parameters: parsedParameters,
        source: { ...location, className, file: relative(project, file) },
      });
    }
  }
  return actions.sort((a, b) =>
    a.source.category.localeCompare(b.source.category) ||
    a.source.group.localeCompare(b.source.group) ||
    a.source.className.localeCompare(b.source.className) ||
    a.label.localeCompare(b.label)
  );
}

function projectFile(project: string, file: string): string {
  const absolute = resolve(project, file);
  if (absolute !== project && !absolute.startsWith(project + sep)) throw new ToolError(`Path must stay inside the FTC project: ${file}`);
  return absolute;
}

function localStudioPayload(project: string, sourceFile?: string): Record<string, unknown> {
  const discovered = discoverRobotActions(project);
  if (!sourceFile) return { projectPath: project, actions: discovered };
  const autoFile = projectFile(project, sourceFile);
  if (!existsSync(autoFile) || !autoFile.endsWith(".java")) throw new ToolError(`Autonomous Java file not found: ${autoFile}`);
  const extracted = extractAutonomous(readFileSync(autoFile, "utf8"), relative(project, autoFile));
  const importedActions = Array.isArray((extracted.spec as { actions?: unknown[] }).actions)
    ? (extracted.spec as { actions: Record<string, unknown>[] }).actions
    : [];
  const used = new Set<string>();
  const actions: Array<Record<string, unknown> | StudioAction> = importedActions.map((action) => {
    const method = String(action.javaMethod ?? action.id ?? "");
    const discoveredAction = discovered.find((candidate) => candidate.javaMethod === method);
    if (!discoveredAction) return action;
    used.add(discoveredAction.id);
    return { ...discoveredAction, id: String(action.id ?? method) };
  });
  actions.push(...discovered.filter((action) => !used.has(action.id)));
  return {
    projectPath: project,
    sourceFile: relative(project, autoFile),
    actions,
    spec: { ...extracted.spec, actions },
    warnings: extracted.warnings,
    sourceExport: {
      mode: "preserve",
      sourceFile: relative(project, autoFile),
      directEdits: ["path geometry", "heading interpolation", "starting pose"],
      agentEdits: ["timeline changes", "new or removed paths", "robot action logic"],
    },
  };
}

function studioRoot(): string {
  const root = join(REPO_ROOT, "studio-dist");
  if (!existsSync(join(root, "visualizer", "index.html"))) {
    throw new ToolError(
      `The local Autonomous Studio bundle is missing at ${root}.\n` +
        `From an FTC Toolchain source checkout, run: npm run studio:build\n` +
        `Published npm packages include this bundle automatically.`
    );
  }
  return root;
}

function openUrl(url: string): void {
  const command = process.platform === "darwin"
    ? { file: "open", args: [url] }
    : process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] }
      : { file: "xdg-open", args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

export async function openAutonomousStudio(args: OpenStudioArgs = {}): Promise<string> {
  const project = resolveProject(args.projectPath);
  const payload = localStudioPayload(project, args.sourceFile);
  const sourcePath = args.sourceFile ? projectFile(project, args.sourceFile) : undefined;
  const root = studioRoot();
  await closeAutonomousStudio();
  activeSession = {
    project,
    sourceFile: sourcePath ? relative(project, sourcePath) : undefined,
    originalSource: sourcePath ? readFileSync(sourcePath, "utf8") : undefined,
    draft: payload.spec && typeof payload.spec === "object" ? payload.spec as Record<string, unknown> : undefined,
  };
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/studio-data.json") {
      response.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
      response.end(JSON.stringify(payload));
      return;
    }
    if (requestUrl.pathname === "/studio-draft" && request.method === "POST") {
      void jsonBody(request).then((draft) => {
        if (activeSession) activeSession.draft = draft;
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
      }).catch((error) => {
        response.writeHead(400, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Could not save Studio draft." }));
      });
      return;
    }
    if (requestUrl.pathname === "/generate-java" && request.method === "POST") {
      void jsonBody(request).then((draft) => {
        if (!activeSession?.originalSource || !activeSession.sourceFile) {
          throw new ToolError("Source-preserving export is available only when Studio was opened with an existing Java autonomous.");
        }
        activeSession.draft = draft;
        const result = generatePreservedJava(activeSession.originalSource, draft, activeSession.sourceFile);
        response.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
        response.end(JSON.stringify(result));
      }).catch((error) => {
        response.writeHead(409, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Could not safely update Java." }));
      });
      return;
    }
    if (requestUrl.pathname === "/") {
      response.writeHead(302, { Location: "/visualizer/" });
      response.end();
      return;
    }
    const requested = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    let file = resolve(root, requested);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "Content-Type": MIME[".txt"] }).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": extname(file) === ".html" ? "no-store" : "public, max-age=3600",
    });
    response.end(readFileSync(file));
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(args.port ?? 7331, "127.0.0.1", () => resolveListen());
  });
  activeServer = server;
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : args.port ?? 7331;
  const url = `http://127.0.0.1:${port}/visualizer/`;
  if (args.openBrowser !== false) openUrl(url);
  const actionCount = (payload.actions as unknown[]).length;
  return (
    `Autonomous Studio is running locally at ${url}\n` +
    `Project: ${project}\n` +
    `Imported ${actionCount} public robot actions from subsystem and automation folders.` +
    (args.sourceFile ? `\nLoaded autonomous: ${args.sourceFile}` : "\nStarted with a new editable autonomous.") +
    "\nThe server is bound to 127.0.0.1 and stops with this FTC Toolchain process; it is not published online."
  );
}
