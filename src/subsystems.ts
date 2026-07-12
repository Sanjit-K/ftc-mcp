import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import {
  DEFAULT_PACKAGE,
  TEAMCODE_JAVA_SUBDIR,
  ToolError,
  resolveProject,
} from "./paths.js";
import {
  ConstantSpec,
  Dashboard,
  DependencySpec,
  DeviceSpec,
  SensorSpec,
  SubsystemSpec,
  generateCalculation,
  generateSubsystemClass,
  generateSubsystemDoc,
  generateTestOpMode,
  normalizeMethods,
  toSnake,
} from "./subsystem-templates.js";
import { backupFiles } from "./lifecycle.js";

const DOCS_SUBDIR = "docs/subsystems";
const ROBOT_INDEX = "docs/ROBOT.md";

function validClassName(name: string, what = "class"): void {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
    throw new ToolError(
      `Invalid Java ${what} name: ${name} (must start uppercase, alphanumeric/underscore only)`
    );
  }
}

function packageForGroup(group?: string): string {
  if (!group) return `${DEFAULT_PACKAGE}.subsystems`;
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/.test(group)) {
    throw new ToolError(
      `Invalid group "${group}": use lowercase dot-separated segments, e.g. "shooting" or "shooting.turret".`
    );
  }
  return `${DEFAULT_PACKAGE}.${group}`;
}

function javaFileFor(project: string, packageName: string, className: string): string {
  return join(project, TEAMCODE_JAVA_SUBDIR, ...packageName.split("."), `${className}.java`);
}

// ---------- create_subsystem ----------

/** Config name is optional at the tool boundary; fillConfigs derives it. */
type DeviceInput = Omit<DeviceSpec, "config"> & { config?: string };
type SensorInput = Omit<SensorSpec, "config"> & { config?: string };

export interface CreateSubsystemArgs {
  projectPath?: string;
  name: string;
  group?: string;
  description?: string;
  motors?: DeviceInput[];
  servos?: DeviceInput[];
  crServos?: DeviceInput[];
  sensors?: SensorInput[];
  dependencies?: { type: string; name?: string }[];
  constants?: ConstantSpec[];
  dashboard?: Dashboard;
  methods?: string[];
  testOpMode?: boolean;
  overwrite?: boolean;
  dryRun?: boolean;
}

function fillConfigs<T extends { name: string; config?: string }>(items: T[] | undefined): (T & { config: string })[] {
  return (items ?? []).map((it) => {
    if (!/^[a-z][A-Za-z0-9]*$/.test(it.name)) {
      throw new ToolError(`Invalid device field name "${it.name}" (use camelCase starting lowercase).`);
    }
    const config = it.config && it.config.length ? it.config : toSnake(it.name);
    if (!config.trim()) throw new ToolError(`Device "${it.name}" has an empty config name.`);
    if (/["\\\r\n\0]/.test(config)) {
      throw new ToolError(
        `Invalid config name ${JSON.stringify(config)} for "${it.name}": quotes, backslashes, and control characters are not supported.`
      );
    }
    return { ...it, config };
  });
}

export function createSubsystem(args: CreateSubsystemArgs): string {
  const project = resolveProject(args.projectPath);
  validClassName(args.name);
  const packageName = packageForGroup(args.group);

  // Resolve dependency subsystems to their packages for imports.
  const dependencies: DependencySpec[] = (args.dependencies ?? []).map((d) => {
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(d.type)) {
      throw new ToolError(`Invalid dependency type "${d.type}" (must be a class name).`);
    }
    const field = d.name ?? d.type.charAt(0).toLowerCase() + d.type.slice(1);
    if (!/^[a-z][A-Za-z0-9_]*$/.test(field)) {
      throw new ToolError(`Invalid dependency field name "${field}" (camelCase).`);
    }
    const pkg = resolveClassPackage(project, d.type);
    if (!pkg) {
      throw new ToolError(
        `Dependency "${d.type}" not found in TeamCode. Create it first with create_subsystem.`
      );
    }
    return { type: d.type, name: field, packageName: pkg };
  });

  for (const c of args.constants ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)) {
      throw new ToolError(`Invalid constant name "${c.name}".`);
    }
    if (c.value === undefined || `${c.value}`.trim() === "") {
      throw new ToolError(`Constant "${c.name}" needs a value.`);
    }
  }

  const motors = fillConfigs(args.motors);
  const servos = fillConfigs(args.servos);
  const crServos = fillConfigs(args.crServos);
  const sensors = fillConfigs(args.sensors) as SensorSpec[];
  const hardware = [
    ...motors.map((d) => ({ ...d, kind: "motor" })),
    ...servos.map((d) => ({ ...d, kind: "servo" })),
    ...crServos.map((d) => ({ ...d, kind: "continuous-rotation servo" })),
    ...sensors.map((d) => ({ ...d, kind: `${d.type} sensor` })),
  ];
  const seenFields = new Map<string, string>();
  const seenConfigs = new Map<string, string>();
  for (const device of hardware) {
    const priorField = seenFields.get(device.name);
    if (priorField) {
      throw new ToolError(`Duplicate hardware field "${device.name}" (${priorField} and ${device.kind}). Use a unique camelCase name.`);
    }
    seenFields.set(device.name, device.kind);
    const priorConfig = seenConfigs.get(device.config);
    if (priorConfig) {
      throw new ToolError(
        `Config name "${device.config}" is assigned to both ${priorConfig} and ${device.kind} in ${args.name}. ` +
          `Each hardware device should have one unique Driver Station config name.`
      );
    }
    seenConfigs.set(device.config, device.kind);
  }
  for (const dependency of dependencies) {
    const prior = seenFields.get(dependency.name);
    if (prior === "dependency") {
      throw new ToolError(`Duplicate dependency field "${dependency.name}" in ${args.name}.`);
    }
    if (prior) {
      throw new ToolError(`Dependency field "${dependency.name}" conflicts with a hardware field in ${args.name}.`);
    }
    seenFields.set(dependency.name, "dependency");
  }

  const spec: SubsystemSpec = {
    packageName,
    className: args.name,
    description: args.description,
    motors,
    servos,
    crServos,
    sensors,
    dependencies,
    constants: args.constants ?? [],
    dashboard: args.dashboard ?? "panels",
    methods: args.methods ?? [],
  };

  const classFile = javaFileFor(project, packageName, args.name);
  const wantTest = args.testOpMode ?? true;
  const testFile = wantTest ? javaFileFor(project, packageName, `Test${args.name}`) : null;
  const docFile = join(project, DOCS_SUBDIR, `${args.name}.md`);
  const classSource = generateSubsystemClass(spec);
  const testSource = testFile ? generateTestOpMode(spec, args.group ?? "Subsystems") : null;
  const classRel = relative(project, classFile);
  const testRel = testFile ? relative(project, testFile) : null;
  const docSource = generateSubsystemDoc(spec, classRel, testRel);
  const conflicts = [classFile, ...(testFile ? [testFile] : []), docFile].filter((file) => existsSync(file));
  if (conflicts.length && !args.overwrite && !args.dryRun) {
    throw new ToolError(
      `Refusing to replace existing generated target${conflicts.length === 1 ? "" : "s"}:\n` +
        conflicts.map((file) => `- ${relative(project, file)}`).join("\n") +
        `\nPass dryRun: true to preview safely, or overwrite: true to replace all listed targets.`
    );
  }
  if (args.dryRun) {
    const targets = [
      `- ${classRel}${existsSync(classFile) ? " (already exists)" : ""}`,
      ...(testFile ? [`- ${testRel}${existsSync(testFile) ? " (already exists)" : ""}`] : []),
      `- ${relative(project, docFile)}${existsSync(docFile) ? " (already exists)" : ""}`,
    ];
    return (
      `PREVIEW ONLY — no files written.\nTargets:\n${targets.join("\n")}\n\n` +
      `## ${classRel}\n\n\`\`\`java\n${classSource}\`\`\`` +
      (testSource ? `\n\n## ${testRel}\n\n\`\`\`java\n${testSource}\`\`\`` : "") +
      `\n\n## ${relative(project, docFile)}\n\n${docSource}`
    );
  }
  const backup = args.overwrite ? backupFiles(project, conflicts) : null;
  mkdirSync(join(classFile, ".."), { recursive: true });
  writeFileSync(classFile, classSource);
  const created = [relative(project, classFile)];

  let relTest: string | null = null;
  if (testFile && testSource) {
    if (!existsSync(testFile) || args.overwrite) {
      writeFileSync(testFile, testSource);
      relTest = relative(project, testFile);
      created.push(relTest);
    } else {
      relTest = relative(project, testFile);
    }
  }

  // Knowledge-base doc (repo-root docs/).
  const docRel = writeSubsystemDoc(
    project,
    args.name,
    generateSubsystemDoc(spec, relative(project, classFile), relTest)
  );
  created.push(docRel);
  regenerateIndex(project);

  const configNames = [...spec.motors, ...spec.servos, ...spec.crServos, ...spec.sensors].map(
    (d) => d.config
  );

  // Panels' @Configurable needs the fullpanels dependency (added by install_pedro).
  const usesPanels =
    spec.dashboard === "panels" && spec.constants.some((c) => c.tunable !== false);
  const pedroInstalled = existsSync(
    join(project, TEAMCODE_JAVA_SUBDIR, ...DEFAULT_PACKAGE.split("."), "pedroPathing", "Constants.java")
  );
  const dashWarning =
    usesPanels && !pedroInstalled
      ? `\n\nWARNING: tunable constants use Panels' @Configurable, which needs the fullpanels dependency. ` +
        `Run install_pedro, or pass dashboard: "ftcdashboard" / "none".`
      : "";

  return (
    `Created ${args.name} subsystem:\n` +
    created.map((c) => `  - ${c}`).join("\n") +
    (configNames.length
      ? `\n\nRobot-configuration names to add on the Driver Station: ${configNames.join(", ")}`
      : "") +
    (dependencies.length
      ? `\nConstructor injects: ${dependencies.map((d) => `${d.type} ${d.name}`).join(", ")}`
      : "") +
    (spec.constants.length ? `\nConstants: ${spec.constants.map((c) => c.name).join(", ")}` : "") +
    (backup ? `\nBackup: ${backup}` : "") +
    dashWarning +
    `\n\nNext: fill in the method bodies, then run document_subsystem to capture behavior/tuning, ` +
    `or hardware_manifest to check config names across the robot.`
  );
}

// ---------- docs knowledge base ----------

function writeSubsystemDoc(project: string, name: string, content: string): string {
  const dir = join(project, DOCS_SUBDIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.md`);
  writeFileSync(file, content.endsWith("\n") ? content : content + "\n");
  return relative(project, file);
}

export interface DocumentSubsystemArgs {
  projectPath?: string;
  name: string;
  content: string;
}

export function documentSubsystem(args: DocumentSubsystemArgs): string {
  const project = resolveProject(args.projectPath);
  validClassName(args.name);
  if (!args.content.trim()) throw new ToolError("content is empty.");
  const rel = writeSubsystemDoc(project, args.name, args.content);
  regenerateIndex(project);
  return `Wrote ${rel} and refreshed ${ROBOT_INDEX}.`;
}

function docTitleAndSummary(md: string): { title: string; summary: string } {
  const lines = md.split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) ?? "# ?").slice(2).trim();
  const summary =
    lines.find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith(">")) ??
    "";
  return { title, summary: summary.trim().slice(0, 120) };
}

function listDocFiles(project: string): string[] {
  const dir = join(project, DOCS_SUBDIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => join(dir, f));
}

function regenerateIndex(project: string): void {
  const files = listDocFiles(project);
  const rows = files.map((f) => {
    const { title, summary } = docTitleAndSummary(readFileSync(f, "utf8"));
    const rel = relative(join(project, "docs"), f); // relative to docs/ for links
    return `| [${title}](${rel}) | ${summary || "—"} |`;
  });
  const body =
    `# Robot Subsystems\n\n` +
    `Living knowledge base of this robot's subsystems, maintained by the team via ftc-mcp.\n` +
    `Read these before writing OpModes so you know each subsystem's hardware, config names, and quirks.\n\n` +
    (rows.length
      ? `| Subsystem | Summary |\n| --- | --- |\n${rows.join("\n")}\n`
      : "_No subsystems documented yet._\n");
  const indexFile = join(project, ROBOT_INDEX);
  mkdirSync(join(indexFile, ".."), { recursive: true });
  writeFileSync(indexFile, body);
}

export function listSubsystems(projectPath?: string): string {
  const project = resolveProject(projectPath);
  const files = listDocFiles(project);
  if (files.length === 0) {
    return `No documented subsystems yet (looked in ${DOCS_SUBDIR}). Use create_subsystem or document_subsystem.`;
  }
  return files
    .map((f) => {
      const { title, summary } = docTitleAndSummary(readFileSync(f, "utf8"));
      return `${title} — ${summary || "(no summary)"}  [${relative(project, f)}]`;
    })
    .join("\n");
}

export interface GetSubsystemArgs {
  projectPath?: string;
  name: string;
  includeSource?: boolean;
}

export function getSubsystem(args: GetSubsystemArgs): string {
  const project = resolveProject(args.projectPath);
  const docFile = join(project, DOCS_SUBDIR, `${args.name}.md`);
  if (!existsSync(docFile)) {
    const available = listDocFiles(project)
      .map((f) => f.replace(/\.md$/, "").split("/").pop())
      .join(", ");
    throw new ToolError(
      `No doc for "${args.name}". Documented: ${available || "(none)"}. Use list_subsystems.`
    );
  }
  let out = readFileSync(docFile, "utf8");
  if (args.includeSource) {
    const src = findJavaByClassName(project, args.name);
    if (src) {
      out += `\n\n---\n\n## Source: ${relative(project, src)}\n\n\`\`\`java\n${readFileSync(src, "utf8")}\n\`\`\`\n`;
    } else {
      out += `\n\n_(No matching ${args.name}.java found under TeamCode.)_\n`;
    }
  }
  return out;
}

// ---------- calculation helper ----------

export function createCalculation(opts: {
  projectPath?: string;
  name: string;
  group?: string;
  description?: string;
  overwrite?: boolean;
  dryRun?: boolean;
}): string {
  const project = resolveProject(opts.projectPath);
  validClassName(opts.name);
  const packageName = opts.group ? packageForGroup(opts.group) : `${DEFAULT_PACKAGE}.util`;
  const file = javaFileFor(project, packageName, opts.name);
  const source = generateCalculation(packageName, opts.name, opts.description);
  const targetExists = existsSync(file);
  if (targetExists && !opts.overwrite && !opts.dryRun) {
    throw new ToolError(`${relative(project, file)} already exists. Pass overwrite: true to replace it.`);
  }
  if (opts.dryRun) {
    return `PREVIEW ONLY — no files written.\nTarget: ${relative(project, file)}${targetExists ? " (already exists)" : ""}\n\n\`\`\`java\n${source}\`\`\``;
  }
  const backup = opts.overwrite ? backupFiles(project, [file]) : null;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, source);
  return `Created ${relative(project, file)} (stateless helper in package ${packageName}).${backup ? `\nBackup: ${backup}` : ""}`;
}

// ---------- hardware manifest ----------

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

function findJavaByClassName(project: string, className: string): string | null {
  const re = new RegExp(`\\bclass\\s+${className}\\b`);
  for (const f of walkJava(join(project, TEAMCODE_JAVA_SUBDIR))) {
    if (re.test(readFileSync(f, "utf8"))) return f;
  }
  return null;
}

/** Resolve a subsystem/class name to its package (from its `package` declaration). */
export function resolveClassPackage(project: string, className: string): string | null {
  const file = findJavaByClassName(project, className);
  if (!file) return null;
  const m = readFileSync(file, "utf8").match(/^\s*package\s+([\w.]+)\s*;/m);
  return m ? m[1] : null;
}

export interface CtorParam {
  type: string;
  name: string;
}

/** Parse a class's public constructor parameter list (best-effort, no generics). */
export function parseConstructor(project: string, className: string): CtorParam[] | null {
  const file = findJavaByClassName(project, className);
  if (!file) return null;
  const src = readFileSync(file, "utf8");
  const m = src.match(new RegExp(`public\\s+${className}\\s*\\(([^)]*)\\)`));
  if (!m) return []; // no explicit constructor -> default (no args)
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const parts = p.replace(/\bfinal\b/, "").trim().split(/\s+/);
      return { type: parts[parts.length - 2], name: parts[parts.length - 1] };
    })
    .filter((p) => p.type && p.name);
}

export interface ManifestEntry {
  config: string;
  file: string;
  detail: string;
  type: string;
}

export interface HardwareAnalysis {
  entries: ManifestEntry[];
  duplicates: string[];
  incompatibleTypes: { config: string; types: string[] }[];
  unresolved: string[];
}

/**
 * Extract robot-configuration names used in code. Two sources:
 *  1. hardwareMap.get(Type.class, "literal") or (Type.class, CONSTANT) with a
 *     resolvable String constant in the same file.
 *  2. String args to `new Subsystem(hardwareMap, "a", "b")` constructor calls
 *     (matches the pattern where config names are injected at construction).
 */
export function analyzeHardwareConfiguration(projectPath?: string): HardwareAnalysis {
  const project = resolveProject(projectPath);
  const entries: ManifestEntry[] = [];

  for (const file of walkJava(join(project, TEAMCODE_JAVA_SUBDIR))) {
    const src = readFileSync(file, "utf8");
    const rel = relative(project, file);

    // Build a map of local String constants for identifier resolution.
    const constMap = new Map<string, string>();
    for (const m of src.matchAll(/(?:final\s+)?String\s+(\w+)\s*=\s*"([^"]+)"/g)) {
      constMap.set(m[1], m[2]);
    }

    // 1. hardwareMap.get(Type.class, <arg>)
    for (const m of src.matchAll(
      /hardwareMap\s*\.\s*get\s*\(\s*(\w+)\.class\s*,\s*("([^"]+)"|(\w+))\s*\)/g
    )) {
      const type = m[1];
      const literal = m[3];
      const ident = m[4];
      const config = literal ?? (ident ? constMap.get(ident) : undefined);
      if (config) entries.push({ config, file: rel, detail: `hardwareMap.get(${type})`, type });
      else if (ident)
        entries.push({ config: `<${ident}>`, file: rel, detail: `hardwareMap.get(${type}), unresolved constant`, type });
    }

    // 2. new Xxx(hardwareMap, "a", "b", ...)
    for (const m of src.matchAll(/new\s+(\w+)\s*\(\s*hardwareMap\s*,([^;]*?)\)/g)) {
      const subsystem = m[1];
      for (const lit of m[2].matchAll(/"([^"]+)"/g)) {
        entries.push({ config: lit[1], file: rel, detail: `new ${subsystem}(...)`, type: subsystem });
      }
    }
  }

  const byConfig = new Map<string, ManifestEntry[]>();
  for (const e of entries) {
    const list = byConfig.get(e.config) ?? [];
    list.push(e);
    byConfig.set(e.config, list);
  }

  const duplicates: string[] = [];
  for (const config of [...byConfig.keys()].sort()) {
    const uses = byConfig.get(config)!;
    const files = [...new Set(uses.map((u) => u.file))];
    if (files.length > 1) duplicates.push(config);
  }

  const incompatibleTypes = [...byConfig.entries()]
    .map(([config, uses]) => ({ config, types: [...new Set(uses.map((u) => u.type))].sort() }))
    .filter(({ config, types }) => !config.startsWith("<") && types.length > 1);
  const unresolved = [...byConfig.keys()].filter((c) => c.startsWith("<"));
  return { entries, duplicates, incompatibleTypes, unresolved };
}

export function validateHardware(projectPath?: string): string {
  const analysis = analyzeHardwareConfiguration(projectPath);
  if (analysis.entries.length === 0) {
    return "WARNING: No robot-configuration names found in TeamCode. Add hardware through create_subsystem or hardwareMap.get before field testing.";
  }
  const lines = [`Hardware validation: ${analysis.incompatibleTypes.length ? "ERROR" : analysis.duplicates.length || analysis.unresolved.length ? "WARNING" : "PASS"}`];
  lines.push(`Found ${new Set(analysis.entries.map((e) => e.config)).size} config name(s) across ${new Set(analysis.entries.map((e) => e.file)).size} file(s).`);
  for (const issue of analysis.incompatibleTypes) {
    lines.push(`ERROR: "${issue.config}" is requested as incompatible types: ${issue.types.join(", ")}.`);
  }
  for (const config of analysis.duplicates.filter((d) => !analysis.incompatibleTypes.some((i) => i.config === d))) {
    lines.push(`WARNING: "${config}" is used in multiple files; verify that sharing is intentional.`);
  }
  if (analysis.unresolved.length) {
    lines.push(`WARNING: ${analysis.unresolved.length} hardware name(s) could not be resolved from constants: ${analysis.unresolved.join(", ")}.`);
  }
  lines.push(analysis.incompatibleTypes.length ? "Fix errors before running an OpMode." : "Cross-check these names against Configure Robot on the Driver Station before deployment.");
  return lines.join("\n");
}

export function hardwareManifest(projectPath?: string): string {
  const analysis = analyzeHardwareConfiguration(projectPath);
  if (analysis.entries.length === 0) {
    return "No robot-configuration names found in TeamCode (no hardwareMap.get literals or subsystem constructor strings).";
  }
  const byConfig = new Map<string, ManifestEntry[]>();
  for (const e of analysis.entries) {
    const list = byConfig.get(e.config) ?? [];
    list.push(e);
    byConfig.set(e.config, list);
  }
  const lines = [...byConfig.keys()].sort().map((config) => {
    const uses = byConfig.get(config)!;
    return `"${config}" — ${uses.map((u) => `${u.detail} @ ${u.file}`).join("; ")}`;
  });

  let out = `Robot-configuration names in TeamCode (add each to the Driver Station config):\n\n${lines.join("\n")}`;
  if (analysis.incompatibleTypes.length) {
    out += `\n\nERROR — same config name requested as incompatible types: ` +
      analysis.incompatibleTypes.map((i) => `"${i.config}" (${i.types.join(" / ")})`).join(", ");
  }
  if (analysis.duplicates.length) {
    out +=
      `\n\n⚠ Same config name used in multiple files (verify this is intentional, not a copy-paste bug): ` +
      analysis.duplicates.map((d) => `"${d}"`).join(", ");
  }
  if (analysis.unresolved.length) {
    out += `\n\nNote: ${analysis.unresolved.length} name(s) come from constants/params this scan could not resolve to a literal.`;
  }
  return out;
}
