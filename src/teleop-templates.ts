/**
 * Pure generators for TeleOp OpModes and their separate, human-editable
 * controller-bindings file.
 *
 * Design: two files, clean separation of concerns.
 *  - <Name>Controls.java — ONLY says which gamepad input maps to which action.
 *    A driver edits this to remap controls without touching robot logic or an LLM.
 *  - <Name>.java — the TeleOp: constructs subsystems, drives, and implements the
 *    described behaviors/automations. Reads inputs through the Controls file.
 */

export type BindingMode = "hold" | "press" | "toggle";

export interface ActionBinding {
  /** camelCase; becomes a Controls accessor and (for edge modes) state fields. */
  name: string;
  /** Human label for the comment, e.g. "Run intake inward". */
  label?: string;
  /** Input expression using `driver` and `operator`, e.g. "driver.right_bumper" or "operator.left_trigger > 0.5". */
  input: string;
  mode: BindingMode;
  /** Code to run when active (no trailing ';'), e.g. "intake.spinIn()". */
  onActive?: string;
  /** Code to run when inactive (hold/toggle only), e.g. "intake.stop()". */
  onInactive?: string;
  /**
   * Actions sharing an exclusiveGroup compile to one if/else-if/else chain so
   * they can't fight over a shared mechanism (e.g. intake in vs out). All
   * members must be "hold"; a single shared idle (the group's onInactive) runs
   * when none is pressed. Priority follows declaration order.
   */
  exclusiveGroup?: string;
  /**
   * Optional robot-state guard ANDed with the input, e.g. "!spindexer.isBusy()".
   * Lets a binding only fire when it's safe/efficient to (matches how real
   * teleops gate actions like `!colorScanInProgress && ...`).
   */
  guard?: string;
}

export interface Automation {
  /** camelCase; becomes a private method and its call site. */
  name: string;
  description: string;
  /** Optional gating input; if absent the automation runs every loop (e.g. sensor-driven). */
  input?: string;
  /** Optional robot-state guard ANDed with the trigger, e.g. "!outtakeInProgress". */
  guard?: string;
}

export interface SlowMode {
  input: string;
  mode: "hold" | "toggle";
  factor: number;
}

export type DriveType =
  | "mecanum"
  | "mecanum-field-centric"
  | "pedro"
  | "pedro-field-centric"
  | "none";

export interface SubsystemRef {
  className: string;
  packageName: string;
  field: string;
  /** Constructor argument expressions (e.g. ["hardwareMap", "intakeFlap"]). */
  ctorArgs: string[];
}

export interface TeleOpSpec {
  packageName: string;
  className: string;
  opModeName: string;
  group: string;
  drive: DriveType;
  subsystems: SubsystemRef[];
  actions: ActionBinding[];
  automations: Automation[];
  slowMode?: SlowMode;
}

const MECANUM_MOTORS = [
  { field: "leftFront", config: "left_front_drive", reversed: true },
  { field: "leftBack", config: "left_back_drive", reversed: true },
  { field: "rightFront", config: "right_front_drive", reversed: false },
  { field: "rightBack", config: "right_back_drive", reversed: false },
];

const isPedro = (d: DriveType) => d === "pedro" || d === "pedro-field-centric";
const isMecanum = (d: DriveType) => d === "mecanum" || d === "mecanum-field-centric";
const isFieldCentric = (d: DriveType) =>
  d === "mecanum-field-centric" || d === "pedro-field-centric";

const controlsClass = (name: string) => `${name}Controls`;

// ---------- Controls (bindings) file ----------

export function buildControls(spec: TeleOpSpec): string {
  const method = (name: string, ret: string, expr: string, comment?: string) =>
    (comment ? `    // ${comment}\n` : "") +
    `    public static ${ret} ${name}(Gamepad driver, Gamepad operator) { return ${expr}; }`;

  const sections: string[] = [];

  if (spec.drive !== "none") {
    sections.push(
      "    // ===== DRIVE =====\n" +
        [
          method("driveForward", "double", "-driver.left_stick_y", "forward is negative on the stick"),
          method("driveStrafe", "double", "driver.left_stick_x"),
          method("driveTurn", "double", "driver.right_stick_x"),
        ].join("\n")
    );
  }

  if (spec.slowMode) {
    sections.push(
      "    // ===== SLOW MODE =====\n" +
        method("slowMode", "boolean", spec.slowMode.input)
    );
  }

  if (spec.actions.length) {
    sections.push(
      "    // ===== ACTIONS =====\n" +
        spec.actions
          .map((a) => method(a.name, "boolean", a.input, a.label))
          .join("\n")
    );
  }

  const gatedAutomations = spec.automations.filter((a) => a.input);
  if (gatedAutomations.length) {
    sections.push(
      "    // ===== AUTOMATION TRIGGERS =====\n" +
        gatedAutomations
          .map((a) => method(a.name, "boolean", a.input!, a.description))
          .join("\n")
    );
  }

  return (
    `// @ftc-mcp generated: controls — scaffolded; driver edits expected\n` +
    `package ${spec.packageName};\n\n` +
    `import com.qualcomm.robotcore.hardware.Gamepad;\n\n` +
    `/**\n` +
    ` * Controller bindings for ${spec.className}. EDIT THIS FILE to remap controls —\n` +
    ` * change only which gamepad button/stick each action uses. No robot logic here.\n` +
    ` * driver = gamepad1, operator = gamepad2.\n` +
    ` */\n` +
    `public class ${controlsClass(spec.className)} {\n\n` +
    sections.join("\n\n") +
    `\n}\n`
  );
}

// ---------- TeleOp file ----------

function edgeFields(spec: TeleOpSpec): string[] {
  const fields: string[] = [];
  for (const a of spec.actions) {
    if (a.mode === "press" || a.mode === "toggle") fields.push(`    private boolean ${a.name}Prev;`);
    if (a.mode === "toggle") fields.push(`    private boolean ${a.name}State;`);
  }
  if (spec.slowMode) {
    fields.push(`    private boolean slowActive;`);
    if (spec.slowMode.mode === "toggle") fields.push(`    private boolean slowPrev;`);
  }
  return fields;
}

/** AND an optional robot-state guard onto a condition. */
function guarded(cond: string, guard?: string): string {
  return guard && guard.trim() ? `(${guard.trim()}) && (${cond})` : cond;
}

function actionWiring(a: ActionBinding, controls: string): string {
  const call = (code?: string) => (code ? `${code};` : "");
  const active = call(a.onActive);
  const inactive = call(a.onInactive);
  const input = `${controls}.${a.name}(driver, operator)`;
  const label = a.label ? `        // ${a.label}\n` : "";
  if (a.mode === "hold") {
    const cond = guarded(input, a.guard);
    if (a.onInactive) {
      return `${label}        if (${cond}) { ${active} } else { ${inactive} }`;
    }
    return `${label}        if (${cond}) { ${active} }`;
  }
  if (a.mode === "press") {
    // Track the raw edge; the guard only gates whether the action fires.
    return (
      `${label}        boolean ${a.name}Now = ${input};\n` +
      `        if (${guarded(`${a.name}Now && !${a.name}Prev`, a.guard)}) { ${active} }\n` +
      `        ${a.name}Prev = ${a.name}Now;`
    );
  }
  // toggle: flip on the raw edge; guard gates the effect only.
  const gatedState = guarded(`${a.name}State`, a.guard);
  const elseBlock = a.onInactive ? ` else { ${inactive} }` : "";
  return (
    `${label}        boolean ${a.name}Now = ${input};\n` +
    `        if (${a.name}Now && !${a.name}Prev) ${a.name}State = !${a.name}State;\n` +
    `        ${a.name}Prev = ${a.name}Now;\n` +
    `        if (${gatedState}) { ${active} }${elseBlock}`
  );
}

/** if/else-if/else chain for a set of mutually-exclusive hold actions. */
function exclusiveGroupWiring(groupName: string, members: ActionBinding[], controls: string): string {
  const branches = members.map((a, i) => {
    const kw = i === 0 ? "if" : "else if";
    const label = a.label ? `${a.label}: ` : "";
    const cond = guarded(`${controls}.${a.name}(driver, operator)`, a.guard);
    return `        ${kw} (${cond}) { ${a.onActive}; } // ${label}${a.name}`;
  });
  const idle = members.map((m) => m.onInactive).find((c) => c);
  const elseBranch = idle ? `\n        else { ${idle}; }` : "";
  return `        // group: ${groupName}\n${branches.join("\n")}${elseBranch}`;
}

/** Build the Actions section, honoring exclusiveGroup chains, in declaration order. */
function buildActionSection(spec: TeleOpSpec, controls: string): string[] {
  const groupMembers = new Map<string, ActionBinding[]>();
  const order: Array<{ kind: "single"; action: ActionBinding } | { kind: "group"; name: string }> = [];
  for (const a of spec.actions) {
    if (a.exclusiveGroup) {
      if (!groupMembers.has(a.exclusiveGroup)) {
        groupMembers.set(a.exclusiveGroup, []);
        order.push({ kind: "group", name: a.exclusiveGroup });
      }
      groupMembers.get(a.exclusiveGroup)!.push(a);
    } else {
      order.push({ kind: "single", action: a });
    }
  }
  const lines: string[] = [];
  for (const item of order) {
    if (item.kind === "group") {
      lines.push(exclusiveGroupWiring(item.name, groupMembers.get(item.name)!, controls));
    } else if (item.action.onActive || item.action.onInactive || item.action.mode === "toggle") {
      lines.push(actionWiring(item.action, controls));
    }
  }
  return lines;
}

export function buildTeleOp(spec: TeleOpSpec): string {
  const controls = controlsClass(spec.className);
  const imports = new Set<string>([
    "com.qualcomm.robotcore.eventloop.opmode.OpMode",
    "com.qualcomm.robotcore.eventloop.opmode.TeleOp",
    "com.qualcomm.robotcore.hardware.Gamepad",
  ]);
  const fields: string[] = [];
  const initBody: string[] = [];
  const startBody: string[] = [];
  const loopTop: string[] = [];
  const telemetry: string[] = [];

  // Subsystems (already ordered so dependencies construct before dependents)
  for (const s of spec.subsystems) {
    if (s.packageName !== spec.packageName) imports.add(`${s.packageName}.${s.className}`);
    fields.push(`    private ${s.className} ${s.field};`);
    initBody.push(`        ${s.field} = new ${s.className}(${s.ctorArgs.join(", ")});`);
  }

  // Drive setup
  if (isMecanum(spec.drive)) {
    imports.add("com.qualcomm.robotcore.hardware.DcMotor");
    imports.add("com.qualcomm.robotcore.hardware.DcMotorSimple");
    for (const m of MECANUM_MOTORS) {
      fields.push(`    private DcMotor ${m.field};`);
      initBody.push(`        ${m.field} = hardwareMap.get(DcMotor.class, "${m.config}");`);
      initBody.push(
        `        ${m.field}.setDirection(DcMotorSimple.Direction.${m.reversed ? "REVERSE" : "FORWARD"});`
      );
    }
  } else if (isPedro(spec.drive)) {
    imports.add("com.pedropathing.follower.Follower");
    imports.add(`${rootPackage(spec.packageName)}.pedroPathing.Constants`);
    fields.push(`    private Follower follower;`);
    initBody.push(`        follower = Constants.createFollower(hardwareMap);`);
    initBody.push(`        follower.update();`);
    startBody.push(`        follower.startTeleopDrive();`);
  }

  fields.push(...edgeFields(spec));

  // Loop: drive
  const loopDrive: string[] = [];
  if (spec.drive !== "none") {
    loopDrive.push(`        double axial = ${controls}.driveForward(driver, operator);`);
    loopDrive.push(`        double lateral = ${controls}.driveStrafe(driver, operator);`);
    loopDrive.push(`        double yaw = ${controls}.driveTurn(driver, operator);`);
    if (spec.slowMode) {
      if (spec.slowMode.mode === "hold") {
        loopDrive.push(`        slowActive = ${controls}.slowMode(driver, operator);`);
      } else {
        loopDrive.push(`        boolean slowNow = ${controls}.slowMode(driver, operator);`);
        loopDrive.push(`        if (slowNow && !slowPrev) slowActive = !slowActive;`);
        loopDrive.push(`        slowPrev = slowNow;`);
      }
      loopDrive.push(`        double speed = slowActive ? ${spec.slowMode.factor} : 1.0;`);
      loopDrive.push(`        axial *= speed; lateral *= speed; yaw *= speed;`);
    }
    if (isMecanum(spec.drive)) {
      loopDrive.push(
        "",
        `        double lf = axial + lateral + yaw;`,
        `        double rf = axial - lateral - yaw;`,
        `        double lb = axial - lateral + yaw;`,
        `        double rb = axial + lateral - yaw;`,
        `        double max = Math.max(Math.max(Math.abs(lf), Math.abs(rf)), Math.max(Math.abs(lb), Math.abs(rb)));`,
        `        if (max > 1.0) { lf /= max; rf /= max; lb /= max; rb /= max; }`,
        `        leftFront.setPower(lf);`,
        `        rightFront.setPower(rf);`,
        `        leftBack.setPower(lb);`,
        `        rightBack.setPower(rb);`
      );
      if (isFieldCentric(spec.drive)) {
        loopDrive.push(
          `        // NOTE: field-centric requested — rotate (axial, lateral) by the robot heading`,
          `        // before the mixer above using your IMU/localizer. Left robot-centric as a safe default.`
        );
      }
    } else if (isPedro(spec.drive)) {
      const robotCentric = isFieldCentric(spec.drive) ? "false" : "true";
      loopDrive.push(
        `        follower.setTeleOpDrive(axial, lateral, yaw, ${robotCentric}); // last arg: true = robot-centric`,
        `        follower.update();`
      );
      telemetry.push(`        telemetry.addData("pose", follower.getPose());`);
    }
  }

  // Loop: actions (exclusive groups become if/else-if chains)
  const loopActions = buildActionSection(spec, controls);

  // Loop: automations
  const loopAutomations: string[] = [];
  const automationMethods: string[] = [];
  for (const a of spec.automations) {
    if (a.input) {
      loopAutomations.push(
        `        if (${guarded(`${controls}.${a.name}(driver, operator)`, a.guard)}) ${a.name}();`
      );
    } else if (a.guard && a.guard.trim()) {
      loopAutomations.push(`        if (${a.guard.trim()}) ${a.name}();`);
    } else {
      loopAutomations.push(`        ${a.name}(); // runs every loop`);
    }
    automationMethods.push(
      `    /**\n     * ${a.description.replace(/\n/g, "\n     * ")}\n     * TODO: implement.\n     */\n` +
        `    private void ${a.name}() {\n        // TODO\n    }`
    );
  }

  telemetry.push(`        telemetry.update();`);

  const importLines = [...imports].sort().map((i) => `import ${i};`).join("\n");
  const startMethod = startBody.length
    ? `\n    @Override\n    public void start() {\n${startBody.join("\n")}\n    }\n`
    : "";

  const section = (title: string, lines: string[]) =>
    lines.length ? `\n        // --- ${title} ---\n${lines.join("\n")}\n` : "";

  return (
    `// @ftc-mcp generated: teleop — scaffolded; team edits expected\n` +
    `package ${spec.packageName};\n\n` +
    `${importLines}\n\n` +
    `/*\n` +
    ` * ${spec.opModeName} TeleOp. Controller bindings live in ${controls}.java\n` +
    ` * (edit that file to remap buttons). Behavior and automations live here.\n` +
    ` */\n` +
    `@TeleOp(name = "${spec.opModeName}", group = "${spec.group}")\n` +
    `public class ${spec.className} extends OpMode {\n\n` +
    (fields.length ? fields.join("\n") + "\n\n" : "") +
    `    @Override\n    public void init() {\n` +
    (initBody.length ? initBody.join("\n") + "\n" : "") +
    `        telemetry.addData("Status", "Initialized");\n        telemetry.update();\n    }\n` +
    startMethod +
    `\n    @Override\n    public void loop() {\n` +
    `        Gamepad driver = gamepad1, operator = gamepad2;\n` +
    section("Drive", loopDrive) +
    section("Actions", loopActions) +
    section("Automations", loopAutomations) +
    `\n${telemetry.join("\n")}\n` +
    `    }\n` +
    (automationMethods.length ? `\n${automationMethods.join("\n\n")}\n` : "") +
    `}\n`
  );
}

function rootPackage(pkg: string): string {
  // teleop package -> base teamcode package for the pedroPathing.Constants import
  const idx = pkg.indexOf(".teamcode");
  return idx >= 0 ? pkg.slice(0, idx + ".teamcode".length) : pkg;
}
