import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DEFAULT_PACKAGE,
  TEAMCODE_JAVA_SUBDIR,
  ToolError,
  resolveProject,
} from "./paths.js";
import { parseConstructor, resolveClassPackage } from "./subsystems.js";
import {
  ActionBinding,
  Automation,
  DriveType,
  SlowMode,
  SubsystemRef,
  TeleOpSpec,
  buildControls,
  buildTeleOp,
} from "./teleop-templates.js";

const DRIVE_TYPES: DriveType[] = [
  "mecanum",
  "mecanum-field-centric",
  "pedro",
  "pedro-field-centric",
  "none",
];

export interface CreateTeleOpArgs {
  projectPath?: string;
  className: string;
  opModeName?: string;
  group?: string;
  packageName?: string;
  drive?: DriveType;
  subsystems?: string[];
  actions?: ActionBinding[];
  automations?: Automation[];
  slowMode?: SlowMode;
  overwrite?: boolean;
}

function validName(name: string, what: string): void {
  if (!/^[a-zA-Z_][A-Za-z0-9_]*$/.test(name)) {
    throw new ToolError(`Invalid ${what}: ${name}`);
  }
}

function camelField(className: string): string {
  return className.charAt(0).toLowerCase() + className.slice(1);
}

export function createTeleOp(args: CreateTeleOpArgs): string {
  const project = resolveProject(args.projectPath);
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(args.className)) {
    throw new ToolError(`Invalid class name: ${args.className} (must start uppercase).`);
  }
  const drive = args.drive ?? "mecanum";
  if (!DRIVE_TYPES.includes(drive)) throw new ToolError(`Unknown drive: ${drive}`);

  // `group` is the Driver Station display group only (like create_opmode);
  // it does not affect the Java package. Use packageName to place the files.
  const packageName = args.packageName ?? DEFAULT_PACKAGE;
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/.test(packageName)) {
    throw new ToolError(`Invalid package name: ${packageName} (lowercase dot-separated segments).`);
  }

  // Resolve subsystems + their transitive dependencies into a construction plan
  // (dependencies constructed before the subsystems that need them).
  const plan: SubsystemRef[] = [];
  const byType = new Map<string, SubsystemRef>();
  const inProgress = new Set<string>();
  const manualArgs: string[] = [];

  const ensure = (name: string): string => {
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) throw new ToolError(`Invalid subsystem name: ${name}`);
    const existing = byType.get(name);
    if (existing) return existing.field;
    if (inProgress.has(name)) {
      throw new ToolError(`Circular subsystem dependency involving ${name}.`);
    }
    const pkg = resolveClassPackage(project, name);
    if (!pkg) {
      throw new ToolError(
        `Subsystem "${name}" not found in TeamCode. Create it first with create_subsystem, or check the name (list_subsystems).`
      );
    }
    inProgress.add(name);
    const params = parseConstructor(project, name) ?? [];
    const ctorArgs: string[] = [];
    for (const p of params) {
      if (p.type === "HardwareMap") {
        ctorArgs.push("hardwareMap");
      } else if (resolveClassPackage(project, p.type)) {
        ctorArgs.push(ensure(p.type)); // subsystem dependency
      } else {
        // Non-subsystem constructor arg (String/primitive) we can't infer.
        ctorArgs.push(`/* TODO: ${p.type} ${p.name} */ null`);
        manualArgs.push(`${name}: ${p.type} ${p.name}`);
      }
    }
    const ref: SubsystemRef = { className: name, packageName: pkg, field: camelField(name), ctorArgs };
    inProgress.delete(name);
    byType.set(name, ref);
    plan.push(ref); // pushed after its deps -> correct construction order
    return ref.field;
  };

  for (const name of args.subsystems ?? []) ensure(name);
  const subsystems = plan;

  const actions = args.actions ?? [];
  for (const a of actions) {
    validName(a.name, "action name");
    if (!a.input?.trim()) throw new ToolError(`Action "${a.name}" needs an input expression.`);
    if (!["hold", "press", "toggle"].includes(a.mode)) {
      throw new ToolError(`Action "${a.name}" has invalid mode "${a.mode}" (hold|press|toggle).`);
    }
    if (a.exclusiveGroup) {
      if (a.mode !== "hold") {
        throw new ToolError(
          `Action "${a.name}" is in exclusiveGroup "${a.exclusiveGroup}" but mode is "${a.mode}"; grouped actions must be "hold".`
        );
      }
      if (!a.onActive?.trim()) {
        throw new ToolError(`Grouped action "${a.name}" needs onActive.`);
      }
    }
  }
  const automations = args.automations ?? [];
  for (const a of automations) {
    validName(a.name, "automation name");
    if (!a.description?.trim()) throw new ToolError(`Automation "${a.name}" needs a description.`);
  }
  if (args.slowMode && drive === "none") {
    throw new ToolError("slowMode requires a drive (it scales the drive vector).");
  }

  const spec: TeleOpSpec = {
    packageName,
    className: args.className,
    opModeName: args.opModeName ?? args.className,
    group: args.group ?? "Competition",
    drive,
    subsystems,
    actions,
    automations,
    slowMode: args.slowMode,
  };

  const dir = join(project, TEAMCODE_JAVA_SUBDIR, ...packageName.split("."));
  const teleopFile = join(dir, `${args.className}.java`);
  const controlsFile = join(dir, `${args.className}Controls.java`);
  for (const f of [teleopFile, controlsFile]) {
    if (existsSync(f) && !args.overwrite) {
      throw new ToolError(`${relative(project, f)} already exists. Pass overwrite: true to replace it.`);
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(controlsFile, buildControls(spec));
  writeFileSync(teleopFile, buildTeleOp(spec));

  // Build a driver-facing summary of the bindings.
  const map: string[] = [];
  if (drive !== "none") map.push("  left stick = drive, right stick X = turn");
  if (args.slowMode) map.push(`  slow mode (${args.slowMode.mode}) [${args.slowMode.input}] -> x${args.slowMode.factor}`);
  for (const a of actions) map.push(`  ${a.label ?? a.name} (${a.mode}) [${a.input}]`);
  for (const a of automations)
    map.push(`  ${a.name}${a.input ? ` [${a.input}]` : " [auto]"} — ${a.description}`);

  const todos = automations.length
    ? `\n\nAutomation stubs to implement in ${args.className}.java: ${automations.map((a) => `${a.name}()`).join(", ")}`
    : "";

  return (
    `Created TeleOp + bindings:\n` +
    `  - ${relative(project, teleopFile)} (behavior & automations)\n` +
    `  - ${relative(project, controlsFile)} (controller bindings — edit here to remap)\n` +
    (map.length ? `\nControl map:\n${map.join("\n")}` : "") +
    (plan.length > (args.subsystems?.length ?? 0)
      ? `\n\nAlso constructed dependencies: ${plan
          .filter((p) => !(args.subsystems ?? []).includes(p.className))
          .map((p) => p.className)
          .join(", ")}`
      : "") +
    (manualArgs.length
      ? `\n\nWARNING: these constructors take non-subsystem args this tool can't infer — fill in the ` +
        `\`/* TODO */ null\` placeholders in ${args.className}.java: ${manualArgs.join("; ")}`
      : "") +
    (isPedroDrive(drive)
      ? `\n\nNOTE: drive "${drive}" uses Pedro's follower — run install_pedro and tune Constants.java first.`
      : "") +
    todos
  );
}

function isPedroDrive(d: DriveType): boolean {
  return d === "pedro" || d === "pedro-field-centric";
}
