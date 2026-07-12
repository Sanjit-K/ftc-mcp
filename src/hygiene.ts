import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { run } from "./exec.js";
import { listOpModes } from "./project.js";
import { TEAMCODE_JAVA_SUBDIR, resolveProject } from "./paths.js";
import { analyzeHardwareConfiguration } from "./subsystems.js";

type Severity = "ERROR" | "WARN" | "INFO";
interface Finding { severity: Severity; message: string }

function walk(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, suffix));
    else if (entry.name.endsWith(suffix)) files.push(full);
  }
  return files;
}

function marker(source: string): string | null {
  return source.match(/@ftc-mcp generated:\s*([a-z0-9-]+)/i)?.[1] ?? null;
}

export async function checkProjectHygiene(projectPath?: string): Promise<string> {
  const project = resolveProject(projectPath);
  const javaRoot = join(project, TEAMCODE_JAVA_SUBDIR);
  const javaFiles = walk(javaRoot, ".java");
  const docFiles = walk(join(project, "docs/subsystems"), ".md");
  const findings: Finding[] = [];

  const opmodes = listOpModes(project);
  const byDisplayName = new Map<string, string[]>();
  for (const opmode of opmodes) {
    const uses = byDisplayName.get(opmode.name) ?? [];
    uses.push(opmode.className);
    byDisplayName.set(opmode.name, uses);
    if (opmode.disabled) findings.push({ severity: "INFO", message: `${opmode.className} is @Disabled.` });
  }
  for (const [name, classes] of byDisplayName) {
    if (classes.length > 1) {
      findings.push({ severity: "ERROR", message: `Driver Station name "${name}" is shared by: ${classes.join(", ")}.` });
    }
  }

  let todoCount = 0;
  const todoFiles: { file: string; count: number }[] = [];
  for (const file of javaFiles) {
    const source = readFileSync(file, "utf8");
    const kind = marker(source);
    const count = source.match(/\bTODO\b/g)?.length ?? 0;
    if (count) {
      todoCount += count;
      todoFiles.push({ file: relative(project, file), count });
    }
    if (kind === "controls") {
      const name = basename(file, ".java").replace(/Controls$/, "");
      const pair = join(dirname(file), `${name}.java`);
      if (!existsSync(pair)) findings.push({ severity: "ERROR", message: `${relative(project, file)} has no matching ${name}.java.` });
    }
    if (kind === "teleop") {
      const name = basename(file, ".java");
      const pair = join(dirname(file), `${name}Controls.java`);
      if (!existsSync(pair)) findings.push({ severity: "ERROR", message: `${relative(project, file)} has no matching ${name}Controls.java.` });
    }
    if (kind === "bench-test") {
      const name = basename(file, ".java").replace(/^Test/, "");
      const pair = join(dirname(file), `${name}.java`);
      if (!existsSync(pair)) findings.push({ severity: "WARN", message: `${relative(project, file)} has no matching ${name}.java subsystem.` });
    }
  }
  if (todoCount) {
    const top = todoFiles.sort((a, b) => b.count - a.count).slice(0, 5).map((item) => `${item.file} (${item.count})`).join(", ");
    findings.push({ severity: "WARN", message: `${todoCount} TODO marker(s) remain. Most affected: ${top}.` });
  }

  for (const file of docFiles) {
    const source = readFileSync(file, "utf8");
    const sourcePath = source.match(/- \*\*Source:\*\*\s+`([^`]+)`/)?.[1];
    if (sourcePath && !existsSync(join(project, sourcePath))) {
      findings.push({ severity: "WARN", message: `${relative(project, file)} points to missing source ${sourcePath}.` });
    }
  }

  const hardware = analyzeHardwareConfiguration(project);
  for (const issue of hardware.incompatibleTypes) {
    findings.push({ severity: "ERROR", message: `Hardware name "${issue.config}" is requested as incompatible types: ${issue.types.join(", ")}.` });
  }

  const apk = join(project, "TeamCode/build/outputs/apk/debug/TeamCode-debug.apk");
  if (!existsSync(apk)) {
    findings.push({ severity: "WARN", message: "No debug APK exists; run build before deployment." });
  } else if (javaFiles.length) {
    const newest = javaFiles.reduce((latest, file) => statSync(file).mtimeMs > statSync(latest).mtimeMs ? file : latest);
    if (statSync(newest).mtimeMs > statSync(apk).mtimeMs) {
      findings.push({ severity: "WARN", message: `APK is stale; ${relative(project, newest)} is newer than the last build.` });
    }
  }

  const git = await run("git", ["status", "--short"], { cwd: project, timeoutMs: 5_000 });
  if (git.code === 0) {
    const changed = git.stdout.split("\n").filter(Boolean);
    if (changed.length) findings.push({ severity: "INFO", message: `${changed.length} uncommitted Git change(s); review the diff before deployment.` });
  } else {
    findings.push({ severity: "INFO", message: "Project is not a Git repository; version-control recovery is unavailable." });
  }

  const errors = findings.filter((f) => f.severity === "ERROR").length;
  const warnings = findings.filter((f) => f.severity === "WARN").length;
  const status = errors ? "ERROR" : warnings ? "WARNING" : "PASS";
  const lines = [
    `Project hygiene: ${status}`,
    `${javaFiles.length} Java files · ${opmodes.length} OpModes · ${docFiles.length} subsystem docs · ${errors} errors · ${warnings} warnings`,
  ];
  if (!findings.length) lines.push("", "No hygiene issues found.");
  else lines.push("", ...findings.map((f) => `[${f.severity}] ${f.message}`));
  lines.push("", errors ? "Fix errors before field testing. Run build_and_deploy only after reviewing the remaining warnings." : "Review warnings and Git diff before build_and_deploy.");
  return lines.join("\n");
}
