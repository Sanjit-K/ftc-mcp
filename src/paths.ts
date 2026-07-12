import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Root of the ftc-mcp repo (parent of dist/). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where reference clones live (FtcRobotController + Pedro docs). */
export const REFS_DIR = process.env.FTC_MCP_REFS ?? join(REPO_ROOT, "refs");

export const SAMPLES_DIR = join(
  REFS_DIR,
  "FtcRobotController/FtcRobotController/src/main/java/org/firstinspires/ftc/robotcontroller/external/samples"
);

export const PEDRO_DOCS_DIR = join(REFS_DIR, "PedroDocs/content/docs");

/** Default workspace for projects created by create_project. */
export const WORKSPACE_DIR = join(REPO_ROOT, "workspace");

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
 * FTC_PROJECT_DIR env var, then the default workspace clone.
 */
export function resolveProject(projectPath?: string): string {
  const candidate =
    projectPath ??
    process.env.FTC_PROJECT_DIR ??
    join(WORKSPACE_DIR, "FtcRobotController");
  const dir = resolve(candidate);
  if (!existsSync(join(dir, "TeamCode"))) {
    throw new ToolError(
      `No FTC SDK project at ${dir} (missing TeamCode module).\n` +
        `Pass projectPath, set FTC_PROJECT_DIR, or run the create_project tool to clone a fresh FtcRobotController.`
    );
  }
  return dir;
}
