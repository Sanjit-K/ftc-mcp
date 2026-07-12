import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Root of the ftc-toolchain package (parent of dist/). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Per-user data dir for reference clones / workspace when installed via npm. */
export const DATA_DIR = process.env.FTC_TOOLCHAIN_HOME ?? join(homedir(), ".ftc-toolchain");

/** True when running from a source checkout that has its own refs/ (dev mode). */
const devRefs = join(REPO_ROOT, "refs");
const isDev = existsSync(join(devRefs, "FtcRobotController"));

/**
 * Where reference clones live. Priority: FTC_TOOLCHAIN_REFS env, then the source
 * checkout's refs/ (dev), then the per-user data dir (installed — populated by
 * `ftc-toolchain setup`).
 */
export const REFS_DIR =
  process.env.FTC_TOOLCHAIN_REFS ?? (isDev ? devRefs : join(DATA_DIR, "refs"));

export const SAMPLES_DIR = join(
  REFS_DIR,
  "FtcRobotController/FtcRobotController/src/main/java/org/firstinspires/ftc/robotcontroller/external/samples"
);

export const PEDRO_DOCS_DIR = join(REFS_DIR, "PedroDocs/content/docs");

/** True when the reference clones are present. */
export function refsPresent(): boolean {
  return existsSync(SAMPLES_DIR) && existsSync(PEDRO_DOCS_DIR);
}

/** Default workspace for projects created by create_project. */
export const WORKSPACE_DIR =
  process.env.FTC_TOOLCHAIN_WORKSPACE ?? (isDev ? join(REPO_ROOT, "workspace") : join(DATA_DIR, "workspace"));

export const TEAMCODE_JAVA_SUBDIR = "TeamCode/src/main/java";
export const DEFAULT_PACKAGE = "org.firstinspires.ftc.teamcode";

export class ToolError extends Error {}

export function requireDir(dir: string, hint: string): string {
  if (!existsSync(dir)) {
    throw new ToolError(`Directory not found: ${dir}\n${hint}`);
  }
  return dir;
}

/**
 * Resolve the FTC SDK project to operate on: explicit arg, then
 * FTC_TOOLCHAIN_PROJECT_DIR env var, then the default workspace clone.
 */
export function resolveProject(projectPath?: string): string {
  const candidate =
    projectPath ??
    process.env.FTC_TOOLCHAIN_PROJECT_DIR ??
    join(WORKSPACE_DIR, "FtcRobotController");
  const dir = resolve(candidate);
  if (!existsSync(join(dir, "TeamCode"))) {
    throw new ToolError(
      `No FTC SDK project at ${dir} (missing TeamCode module).\n` +
        `Pass projectPath, set FTC_TOOLCHAIN_PROJECT_DIR, or run the create_project tool to clone a fresh FtcRobotController.`
    );
  }
  return dir;
}
