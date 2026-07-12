import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { run } from "./exec.js";
import {
  DEFAULT_PACKAGE,
  TEAMCODE_JAVA_SUBDIR,
  ToolError,
  WORKSPACE_DIR,
  resolveProject,
} from "./paths.js";
import {
  TemplateId,
  pedroConstants,
  renderTemplate,
} from "./templates.js";

const SDK_REPO = "https://github.com/FIRST-Tech-Challenge/FtcRobotController";

/** Fallback if the GitHub API is unreachable; overridable via the version arg. */
const PEDRO_FALLBACK_VERSION = "2.0.1";

export async function createProject(dest?: string): Promise<string> {
  const target = dest ?? join(WORKSPACE_DIR, "FtcRobotController");
  if (existsSync(join(target, "TeamCode"))) {
    return `FTC SDK project already exists at ${target}. Using it as-is.`;
  }
  if (existsSync(target)) {
    throw new ToolError(`${target} exists but is not an FTC SDK project.`);
  }
  mkdirSync(join(target, ".."), { recursive: true });
  const res = await run(
    "git",
    ["clone", "--depth", "1", SDK_REPO, target],
    { timeoutMs: 300_000 }
  );
  if (res.code !== 0) {
    throw new ToolError(`git clone failed:\n${res.stderr}`);
  }
  return (
    `Cloned FtcRobotController SDK to ${target}.\n` +
    `Use this as projectPath for other tools (or set FTC_PROJECT_DIR).`
  );
}

// ---------- OpMode scaffolding ----------

export interface CreateOpModeArgs {
  projectPath?: string;
  className: string;
  template: TemplateId;
  opModeName?: string;
  group?: string;
  packageName?: string;
  overwrite?: boolean;
}

export function createOpMode(args: CreateOpModeArgs): string {
  const project = resolveProject(args.projectPath);
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(args.className)) {
    throw new ToolError(
      `Invalid Java class name: ${args.className} (must start with an uppercase letter, alphanumeric/underscore only)`
    );
  }
  const packageName = args.packageName ?? DEFAULT_PACKAGE;
  if (!/^[a-zA-Z_][\w.]*$/.test(packageName)) {
    throw new ToolError(`Invalid Java package name: ${packageName}`);
  }

  const source = renderTemplate(args.template, {
    packageName,
    className: args.className,
    opModeName: args.opModeName ?? args.className,
    group: args.group ?? "Generated",
  });

  const dir = join(project, TEAMCODE_JAVA_SUBDIR, ...packageName.split("."));
  const file = join(dir, `${args.className}.java`);
  if (existsSync(file) && !args.overwrite) {
    throw new ToolError(`${file} already exists. Pass overwrite: true to replace it.`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, source);

  let note = "";
  if (args.template.startsWith("pedro")) {
    const constantsFile = join(
      project,
      TEAMCODE_JAVA_SUBDIR,
      ...DEFAULT_PACKAGE.split("."),
      "pedroPathing",
      "Constants.java"
    );
    if (!existsSync(constantsFile)) {
      note =
        "\nWARNING: Pedro Pathing is not installed in this project yet. " +
        "Run the install_pedro tool, then tune the generated Constants.java before running paths.";
    }
  }
  return `Created ${relative(project, file)} in ${project}${note}`;
}

// ---------- List OpModes in TeamCode ----------

export interface OpModeInfo {
  className: string;
  file: string;
  type: "TeleOp" | "Autonomous";
  name: string;
  disabled: boolean;
}

function walkJava(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJava(full));
    else if (entry.name.endsWith(".java")) out.push(full);
  }
  return out;
}

export function listOpModes(projectPath?: string): OpModeInfo[] {
  const project = resolveProject(projectPath);
  const javaRoot = join(project, TEAMCODE_JAVA_SUBDIR);
  const results: OpModeInfo[] = [];
  for (const file of walkJava(javaRoot)) {
    const source = readFileSync(file, "utf8");
    const annotation = source.match(/@(TeleOp|Autonomous)\s*(\(([^)]*)\))?/);
    if (!annotation) continue;
    const nameMatch = (annotation[3] ?? "").match(/name\s*=\s*"([^"]*)"/);
    const classMatch = source.match(/class\s+(\w+)/);
    results.push({
      className: classMatch?.[1] ?? "?",
      file: relative(project, file),
      type: annotation[1] as OpModeInfo["type"],
      name: nameMatch?.[1] ?? classMatch?.[1] ?? "?",
      disabled: /@Disabled\b/.test(source),
    });
  }
  return results;
}

// ---------- Pedro Pathing installation ----------

async function latestPedroVersion(): Promise<{ version: string; fromApi: boolean }> {
  try {
    const resp = await fetch(
      "https://api.github.com/repos/Pedro-Pathing/PedroPathing/releases/latest",
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const data = (await resp.json()) as { tag_name?: string };
      if (data.tag_name) {
        return { version: data.tag_name.replace(/^v/, ""), fromApi: true };
      }
    }
  } catch {
    // offline — fall through
  }
  return { version: PEDRO_FALLBACK_VERSION, fromApi: false };
}

export async function installPedro(
  projectPath?: string,
  version?: string
): Promise<string> {
  const project = resolveProject(projectPath);
  const notes: string[] = [];

  let pedroVersion = version;
  if (!pedroVersion) {
    const latest = await latestPedroVersion();
    pedroVersion = latest.version;
    if (!latest.fromApi) {
      notes.push(
        `Could not reach the GitHub API; used fallback Pedro version ${pedroVersion}. ` +
          `Pass an explicit version if a newer release exists.`
      );
    }
  }

  // 1. Gradle dependencies
  const depsFile = join(project, "build.dependencies.gradle");
  if (!existsSync(depsFile)) {
    throw new ToolError(`Missing ${depsFile}; is this a standard FtcRobotController project?`);
  }
  let deps = readFileSync(depsFile, "utf8");
  const mavenLine = `    maven { url = 'https://mymaven.bylazar.com/releases' }`;
  if (!deps.includes("mymaven.bylazar.com")) {
    deps = deps.replace(/repositories\s*\{/, (m) => `${m}\n${mavenLine}`);
    notes.push("Added Pedro maven repository to build.dependencies.gradle");
  }
  if (!deps.includes("com.pedropathing:ftc")) {
    const implLines =
      `    implementation 'com.pedropathing:ftc:${pedroVersion}'\n` +
      `    implementation 'com.pedropathing:telemetry:1.0.0'\n` +
      `    implementation 'com.bylazar:fullpanels:1.0.12'`;
    deps = deps.replace(/dependencies\s*\{/, (m) => `${m}\n${implLines}`);
    notes.push(`Added Pedro Pathing ${pedroVersion} dependencies`);
  } else {
    notes.push("Pedro dependencies already present; left build.dependencies.gradle unchanged");
  }
  writeFileSync(depsFile, deps);

  // 2. compileSdkVersion 30 -> 34 (required by Pedro's Panels dependency)
  const commonFile = join(project, "build.common.gradle");
  if (existsSync(commonFile)) {
    let common = readFileSync(commonFile, "utf8");
    const m = common.match(/compileSdkVersion\s+(\d+)/);
    if (m && Number(m[1]) < 34) {
      common = common.replace(/compileSdkVersion\s+\d+/, "compileSdkVersion 34");
      writeFileSync(commonFile, common);
      notes.push(`Raised compileSdkVersion ${m[1]} -> 34 in build.common.gradle`);
    }
  }

  // 3. Constants scaffold
  const pedroPkg = `${DEFAULT_PACKAGE}.pedroPathing`;
  const constantsDir = join(project, TEAMCODE_JAVA_SUBDIR, ...pedroPkg.split("."));
  const constantsFile = join(constantsDir, "Constants.java");
  if (!existsSync(constantsFile)) {
    mkdirSync(constantsDir, { recursive: true });
    writeFileSync(constantsFile, pedroConstants(pedroPkg));
    notes.push(`Created ${relative(project, constantsFile)} (all values need tuning!)`);
  } else {
    notes.push("Constants.java already exists; not overwritten");
  }

  notes.push(
    "Next steps: (1) set motor/localizer names in Constants.java to match the robot configuration, " +
      "(2) run the tuning procedure (search_docs 'tuning'), (3) build & deploy."
  );
  return notes.join("\n");
}
