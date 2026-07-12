import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./exec.js";
import { listOpModes } from "./project.js";
import { REFS_DIR, SAMPLES_DIR, PEDRO_DOCS_DIR, TEAMCODE_JAVA_SUBDIR, WORKSPACE_DIR } from "./paths.js";
import { analyzeHardwareConfiguration } from "./subsystems.js";

function countFiles(dir: string, suffix: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full, suffix);
    else if (entry.name.endsWith(suffix)) count++;
  }
  return count;
}

function candidateProject(projectPath?: string): string {
  return resolve(
    projectPath ??
      process.env.FTC_PROJECT_DIR ??
      join(WORKSPACE_DIR, "FtcRobotController")
  );
}

function sdkVersion(project: string): string {
  const file = join(project, "build.common.gradle");
  if (!existsSync(file)) return "unknown";
  const source = readFileSync(file, "utf8");
  const compile = source.match(/compileSdkVersion\s+(\d+)/)?.[1];
  const min = source.match(/minSdkVersion\s+(\d+)/)?.[1];
  return [compile && `compile ${compile}`, min && `min ${min}`].filter(Boolean).join(", ") || "unknown";
}

function androidSdk(): string | null {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "darwin" ? join(homedir(), "Library/Android/sdk") : join(homedir(), "Android/Sdk"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export async function inspectProject(projectPath?: string): Promise<string> {
  const project = candidateProject(projectPath);
  const hasProject = existsSync(join(project, "TeamCode"));
  const lines = ["# ftc-mcp project check", ""];
  const actions: string[] = [];

  lines.push(`Project: ${project}`);
  if (!hasProject) {
    lines.push("Status: NOT FOUND (missing TeamCode module)");
    actions.push("Pass projectPath, set FTC_PROJECT_DIR, or run create_project.");
  } else {
    const javaRoot = join(project, TEAMCODE_JAVA_SUBDIR);
    const opmodes = listOpModes(project);
    const teleops = opmodes.filter((o) => o.type === "TeleOp").length;
    const autos = opmodes.filter((o) => o.type === "Autonomous").length;
    const subsystemDocs = countFiles(join(project, "docs/subsystems"), ".md");
    const pedro = existsSync(join(javaRoot, "org/firstinspires/ftc/teamcode/pedroPathing/Constants.java"));
    const gradlew = join(project, process.platform === "win32" ? "gradlew.bat" : "gradlew");
    const localProperties = join(project, "local.properties");
    const apk = join(project, "TeamCode/build/outputs/apk/debug/TeamCode-debug.apk");

    lines.push("Status: READY");
    lines.push(`SDK: ${sdkVersion(project)}`);
    lines.push(`Code: ${countFiles(javaRoot, ".java")} Java files; ${opmodes.length} OpModes (${teleops} TeleOp, ${autos} Autonomous)`);
    lines.push(`Robot docs: ${subsystemDocs} documented subsystem${subsystemDocs === 1 ? "" : "s"}`);
    lines.push(`Pedro Pathing: ${pedro ? "installed (constants present)" : "not installed"}`);
    lines.push(`Gradle wrapper: ${existsSync(gradlew) ? "ready" : "MISSING"}`);
    lines.push(`local.properties: ${existsSync(localProperties) ? "present" : "missing (created automatically on build when Android SDK is found)"}`);
    if (existsSync(apk)) {
      const stat = statSync(apk);
      lines.push(`Last APK: ${(stat.size / 1_048_576).toFixed(1)} MB, ${formatAge(stat.mtimeMs)} — ${apk}`);
    } else {
      lines.push("Last APK: none");
      actions.push("Run build before deploy.");
    }
    if (!existsSync(gradlew)) actions.push("Restore the Gradle wrapper from a standard FtcRobotController checkout.");
    if (subsystemDocs === 0) actions.push("Use create_subsystem or document_subsystem to start the robot knowledge base.");

    const git = await run("git", ["status", "--short", "--branch"], { cwd: project, timeoutMs: 5_000 });
    if (git.code === 0) {
      const statusLines = git.stdout.trim().split("\n").filter(Boolean);
      lines.push(`Git: ${statusLines[0]?.replace(/^## /, "") || "repository"}; ${Math.max(0, statusLines.length - 1)} changed file(s)`);
    } else {
      lines.push("Git: not a repository");
    }

    const hardware = analyzeHardwareConfiguration(project);
    const collision = hardware.duplicates.length > 0;
    const incompatible = hardware.incompatibleTypes.length > 0;
    lines.push(`Hardware manifest: ${incompatible ? "INCOMPATIBLE TYPES" : collision ? "SHARED NAMES FOUND" : hardware.entries.length === 0 ? "no config names found" : "no cross-file collisions"}`);
    if (incompatible) actions.push("Run validate_hardware and fix incompatible device types before running an OpMode.");
    else if (collision) actions.push("Run validate_hardware and verify shared configuration names before testing hardware.");
  }

  const refsReady = existsSync(SAMPLES_DIR) && existsSync(PEDRO_DOCS_DIR);
  const sdk = androidSdk();
  lines.push("");
  lines.push(`Reference library: ${refsReady ? "ready" : `MISSING — ${REFS_DIR}`}`);
  lines.push(`Android SDK: ${sdk ?? "NOT FOUND"}`);
  lines.push(`Node: ${process.version}`);
  if (!refsReady) actions.push("Run npx ftc-mcp setup to enable FTC sample and Pedro documentation tools.");
  if (!sdk) actions.push("Install Android Studio or set ANDROID_HOME before building.");

  lines.push("", "## Next actions");
  lines.push(...(actions.length ? actions.map((a) => `- ${a}`) : ["- Project looks ready. Build, review the diff, then deploy when the robot is connected."]));
  return lines.join("\n");
}
