/**
 * Pure code/doc generators for the subsystem architecture layer.
 * Style deliberately mirrors a hand-written FTC subsystem: a plain class that
 * takes HardwareMap in its constructor, declares its hardware, exposes tunable
 * constants, and provides action methods + a safety stop().
 */

export type SensorType =
  | "color"
  | "distance"
  | "touch"
  | "analog"
  | "digital"
  | "imu";

export interface DeviceSpec {
  /** Java field name, e.g. "shooterMotor". */
  name: string;
  /** Robot-configuration name on the Driver Station, e.g. "shooter". */
  config: string;
  reversed?: boolean;
}

export interface SensorSpec {
  name: string;
  config: string;
  type: SensorType;
}

/** Another subsystem this one depends on (constructor-injected). */
export interface DependencySpec {
  /** Class name of the dependency, e.g. "ColorSensor". */
  type: string;
  /** Field/param name, e.g. "colorSensor". */
  name: string;
  /** Package of the dependency class (resolved by the IO layer) for the import. */
  packageName?: string;
}

/** A named constant. Tunable ones become live-editable dashboard fields. */
export interface ConstantSpec {
  name: string;
  /** Java literal or expression, e.g. "0.59" or "Math.toRadians(180)". */
  value: string;
  javaType?: string; // default "double"
  comment?: string;
  /** true (default): public static (dashboard-tunable). false: private static final. */
  tunable?: boolean;
}

export type Dashboard = "panels" | "ftcdashboard" | "none";

export interface SubsystemSpec {
  packageName: string;
  className: string;
  description?: string;
  motors: DeviceSpec[];
  servos: DeviceSpec[];
  crServos: DeviceSpec[];
  sensors: SensorSpec[];
  dependencies: DependencySpec[];
  constants: ConstantSpec[];
  dashboard: Dashboard;
  /** Action method names to stub, e.g. ["spinIn", "spitOut"]. */
  methods: string[];
}

const DASHBOARD_IMPORT: Record<Exclude<Dashboard, "none">, string> = {
  panels: "com.bylazar.configurables.annotations.Configurable",
  ftcdashboard: "com.acmerobotics.dashboard.config.Config",
};
const DASHBOARD_ANNOTATION: Record<Exclude<Dashboard, "none">, string> = {
  panels: "@Configurable",
  ftcdashboard: "@Config",
};

const SENSOR_JAVA_TYPE: Record<SensorType, string> = {
  color: "ColorSensor",
  distance: "DistanceSensor",
  touch: "TouchSensor",
  analog: "AnalogInput",
  digital: "DigitalChannel",
  imu: "IMU",
};

const SENSOR_IMPORT: Record<SensorType, string> = {
  color: "com.qualcomm.robotcore.hardware.ColorSensor",
  distance: "com.qualcomm.robotcore.hardware.DistanceSensor",
  touch: "com.qualcomm.robotcore.hardware.TouchSensor",
  analog: "com.qualcomm.robotcore.hardware.AnalogInput",
  digital: "com.qualcomm.robotcore.hardware.DigitalChannel",
  imu: "com.qualcomm.robotcore.hardware.IMU",
};

function toUpperSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
}

export function toSnake(name: string): string {
  return toUpperSnake(name).toLowerCase();
}

const CONST = (name: string) => `${toUpperSnake(name)}_NAME`;

/** Ensure a stop() method is always present, first-normalized to lowercase. */
export function normalizeMethods(methods: string[]): { actions: string[]; hasStop: boolean } {
  const actions: string[] = [];
  let hasStop = false;
  for (const m of methods) {
    const name = m.trim();
    if (!name) continue;
    if (name.toLowerCase() === "stop") {
      hasStop = true;
      continue;
    }
    if (!actions.includes(name)) actions.push(name);
  }
  return { actions, hasStop };
}

export function generateSubsystemClass(spec: SubsystemSpec): string {
  const imports = new Set<string>(["com.qualcomm.robotcore.hardware.HardwareMap"]);
  const fields: string[] = [];
  const constants: string[] = [];
  const ctorBody: string[] = [];
  const motorFieldNames: string[] = [];

  for (const m of spec.motors) {
    imports.add("com.qualcomm.robotcore.hardware.DcMotorEx");
    imports.add("com.qualcomm.robotcore.hardware.DcMotor");
    imports.add("com.qualcomm.robotcore.hardware.DcMotorSimple");
    fields.push(`    private DcMotorEx ${m.name};`);
    constants.push(`    public static final String ${CONST(m.name)} = "${m.config}";`);
    ctorBody.push(`        ${m.name} = hardwareMap.get(DcMotorEx.class, ${CONST(m.name)});`);
    ctorBody.push(
      `        ${m.name}.setDirection(DcMotorSimple.Direction.${m.reversed ? "REVERSE" : "FORWARD"});`
    );
    ctorBody.push(`        ${m.name}.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);`);
    motorFieldNames.push(m.name);
  }

  for (const s of spec.servos) {
    imports.add("com.qualcomm.robotcore.hardware.Servo");
    fields.push(`    private Servo ${s.name};`);
    constants.push(`    public static final String ${CONST(s.name)} = "${s.config}";`);
    ctorBody.push(`        ${s.name} = hardwareMap.get(Servo.class, ${CONST(s.name)});`);
    if (s.reversed) {
      imports.add("com.qualcomm.robotcore.hardware.Servo");
      ctorBody.push(`        ${s.name}.setDirection(Servo.Direction.REVERSE);`);
    }
  }

  for (const c of spec.crServos) {
    imports.add("com.qualcomm.robotcore.hardware.CRServo");
    imports.add("com.qualcomm.robotcore.hardware.DcMotorSimple");
    fields.push(`    private CRServo ${c.name};`);
    constants.push(`    public static final String ${CONST(c.name)} = "${c.config}";`);
    ctorBody.push(`        ${c.name} = hardwareMap.get(CRServo.class, ${CONST(c.name)});`);
    if (c.reversed) {
      ctorBody.push(`        ${c.name}.setDirection(DcMotorSimple.Direction.REVERSE);`);
    }
    motorFieldNames.push(c.name); // stop() should zero CR servos too
  }

  for (const sensor of spec.sensors) {
    const javaType = SENSOR_JAVA_TYPE[sensor.type];
    imports.add(SENSOR_IMPORT[sensor.type]);
    fields.push(`    private ${javaType} ${sensor.name};`);
    constants.push(`    public static final String ${CONST(sensor.name)} = "${sensor.config}";`);
    ctorBody.push(`        ${sensor.name} = hardwareMap.get(${javaType}.class, ${CONST(sensor.name)});`);
  }

  // Dependency subsystems (constructor-injected). Config names stay hardcoded
  // above, so the constructor only receives sibling subsystems.
  const depFields: string[] = [];
  const depParams: string[] = [];
  const depAssign: string[] = [];
  for (const d of spec.dependencies) {
    if (d.packageName && d.packageName !== spec.packageName) {
      imports.add(`${d.packageName}.${d.type}`);
    }
    depFields.push(`    private final ${d.type} ${d.name};`);
    depParams.push(`${d.type} ${d.name}`);
    depAssign.push(`        this.${d.name} = ${d.name};`);
  }

  // User-defined constants (tunable = live-editable via the dashboard).
  const tunables: string[] = [];
  let hasTunable = false;
  for (const c of spec.constants) {
    const type = c.javaType ?? "double";
    const comment = c.comment ? ` // ${c.comment}` : "";
    if (c.tunable === false) {
      tunables.push(`    private static final ${type} ${c.name} = ${c.value};${comment}`);
    } else {
      hasTunable = true;
      tunables.push(`    public static ${type} ${c.name} = ${c.value};${comment}`);
    }
  }
  if (hasTunable && spec.dashboard !== "none") {
    imports.add(DASHBOARD_IMPORT[spec.dashboard]);
  }

  const { actions, hasStop } = normalizeMethods(spec.methods);

  const methodBlocks: string[] = [];
  for (const action of actions) {
    methodBlocks.push(
      `    /** TODO: implement ${action}. */\n` +
        `    public void ${action}() {\n` +
        `        // TODO\n` +
        `    }`
    );
  }
  // stop() always present and always real: zero every powered actuator.
  const stopBody =
    motorFieldNames.length > 0
      ? motorFieldNames.map((n) => `        ${n}.setPower(0);`).join("\n")
      : "        // No powered actuators to stop.";
  methodBlocks.push(`    /** Cut power to all actuators. Safe to call any time. */\n    public void stop() {\n${stopBody}\n    }`);

  const importLines = [...imports].sort().map((i) => `import ${i};`).join("\n");
  const classDoc = spec.description
    ? `/**\n * ${spec.description.replace(/\n/g, "\n * ")}\n */\n`
    : "";
  const annotation =
    hasTunable && spec.dashboard !== "none" ? `${DASHBOARD_ANNOTATION[spec.dashboard]}\n` : "";

  const ctorParams = ["HardwareMap hardwareMap", ...depParams].join(", ");

  return (
    `// @ftc-toolchain generated: subsystem — scaffolded; team edits expected\n` +
    `package ${spec.packageName};\n\n` +
    `${importLines}\n\n` +
    classDoc +
    annotation +
    `public class ${spec.className} {\n\n` +
    (fields.length ? fields.join("\n") + "\n\n" : "") +
    (depFields.length ? depFields.join("\n") + "\n\n" : "") +
    (constants.length ? "    // Hardware configuration names (must match the Driver Station config)\n" + constants.join("\n") + "\n\n" : "") +
    (tunables.length
      ? "    // --- Tunable constants" +
        (hasTunable && spec.dashboard !== "none" ? " (live-editable via the dashboard)" : "") +
        " ---\n" +
        tunables.join("\n") +
        "\n\n"
      : "") +
    `    public ${spec.className}(${ctorParams}) {\n` +
    (ctorBody.length ? ctorBody.join("\n") + "\n" : "") +
    (depAssign.length ? (ctorBody.length ? "\n" : "") + depAssign.join("\n") + "\n" : "") +
    `    }\n\n` +
    methodBlocks.join("\n\n") +
    "\n}\n" +
    (hasStop ? "" : "") // stop already included
  );
}

const TEST_BUTTONS = [
  "a",
  "b",
  "x",
  "y",
  "rightBumper",
  "leftBumper",
  "dpadUp",
  "dpadDown",
  "dpadLeft",
  "dpadRight",
];

/** A bench-test TeleOp that binds each action method to a gamepad button. */
export function generateTestOpMode(spec: SubsystemSpec, group: string): string {
  const { actions } = normalizeMethods(spec.methods);
  const field = spec.className.charAt(0).toLowerCase() + spec.className.slice(1);

  // Construct dependencies first (best-effort; adjust if a dep needs extra args).
  const depImports = new Set<string>();
  const depConstruct: string[] = [];
  for (const d of spec.dependencies) {
    if (d.packageName && d.packageName !== spec.packageName) depImports.add(`${d.packageName}.${d.type}`);
    depConstruct.push(`        ${d.type} ${d.name} = new ${d.type}(hardwareMap);`);
  }
  const ctorArgs = ["hardwareMap", ...spec.dependencies.map((d) => d.name)].join(", ");
  const depImportLines = [...depImports].sort().map((i) => `import ${i};`).join("\n");

  const bindings: string[] = [];
  actions.slice(0, TEST_BUTTONS.length).forEach((action, i) => {
    const btn = TEST_BUTTONS[i];
    bindings.push(
      `        if (gamepad1.${btn}WasPressed()) {\n` +
        `            ${field}.${action}();\n` +
        `        }`
    );
  });
  const overflow = actions.length > TEST_BUTTONS.length
    ? `        // Not enough buttons for: ${actions.slice(TEST_BUTTONS.length).join(", ")}\n`
    : "";
  const legend = actions
    .slice(0, TEST_BUTTONS.length)
    .map((a, i) => `     *   ${TEST_BUTTONS[i]} -> ${a}()`)
    .join("\n");

  return (
    `// @ftc-toolchain generated: bench-test — scaffolded; team edits expected\n` +
    `package ${spec.packageName};\n\n` +
    `import com.qualcomm.robotcore.eventloop.opmode.OpMode;\n` +
    `import com.qualcomm.robotcore.eventloop.opmode.TeleOp;\n` +
    (depImportLines ? depImportLines + "\n" : "") +
    `\n` +
    `/*\n` +
    ` * Bench test for the ${spec.className} subsystem. Binds each action to a\n` +
    ` * gamepad1 button so you can exercise the subsystem in isolation on the robot.\n` +
    (legend ? ` *\n${legend}\n` : "") +
    ` *   back (always) -> stop()\n` +
    ` */\n` +
    `@TeleOp(name = "Test ${spec.className}", group = "${group}")\n` +
    `public class Test${spec.className} extends OpMode {\n\n` +
    `    private ${spec.className} ${field};\n\n` +
    `    @Override\n` +
    `    public void init() {\n` +
    (depConstruct.length ? depConstruct.join("\n") + "\n" : "") +
    `        ${field} = new ${spec.className}(${ctorArgs});\n` +
    `    }\n\n` +
    `    @Override\n` +
    `    public void loop() {\n` +
    (bindings.length ? bindings.join("\n") + "\n" : "") +
    overflow +
    `\n` +
    `        if (gamepad1.backWasPressed()) {\n` +
    `            ${field}.stop();\n` +
    `        }\n\n` +
    `        telemetry.addData("subsystem", "${spec.className}");\n` +
    `        telemetry.update();\n` +
    `    }\n` +
    `}\n`
  );
}

/** Stateless calculation helper (e.g. live trajectory math). */
export function generateCalculation(
  packageName: string,
  className: string,
  description?: string
): string {
  const doc = description
    ? `/**\n * ${description.replace(/\n/g, "\n * ")}\n */\n`
    : `/** Stateless ${className} helpers. */\n`;
  return (
    `// @ftc-toolchain generated: calculation — scaffolded; team edits expected\n` +
    `package ${packageName};\n\n` +
    doc +
    `public final class ${className} {\n\n` +
    `    private ${className}() {} // static-only utility\n\n` +
    `    // TODO: add pure calculation methods, e.g.\n` +
    `    // public static double example(double input) {\n` +
    `    //     return input;\n` +
    `    // }\n` +
    `}\n`
  );
}

/** Initial per-subsystem markdown doc, generated from the spec. */
export function generateSubsystemDoc(
  spec: SubsystemSpec,
  relSourcePath: string,
  relTestPath: string | null
): string {
  const hw: string[] = [];
  const row = (name: string, type: string, config: string) =>
    `| \`${name}\` | ${type} | \`${config}\` |`;
  for (const m of spec.motors) hw.push(row(m.name, `DcMotorEx${m.reversed ? " (reversed)" : ""}`, m.config));
  for (const s of spec.servos) hw.push(row(s.name, `Servo${s.reversed ? " (reversed)" : ""}`, s.config));
  for (const c of spec.crServos) hw.push(row(c.name, `CRServo${c.reversed ? " (reversed)" : ""}`, c.config));
  for (const sensor of spec.sensors) hw.push(row(sensor.name, SENSOR_JAVA_TYPE[sensor.type], sensor.config));

  const { actions, hasStop } = normalizeMethods(spec.methods);
  const fnLines = actions.map((a) => `- \`${a}()\` — TODO: describe`);
  fnLines.push("- `stop()` — cut power to all actuators");

  const depLine = spec.dependencies.length
    ? `- **Depends on:** ${spec.dependencies.map((d) => `\`${d.type}\``).join(", ")}\n`
    : "";

  const tuningSection = spec.constants.length
    ? spec.constants
        .map(
          (c) =>
            `- \`${c.name}\` = ${c.value}${c.comment ? ` — ${c.comment}` : ""}` +
            `${c.tunable === false ? " (fixed)" : " (dashboard-tunable)"}`
        )
        .join("\n") + "\n"
    : "_TODO: record PID values, RPM setpoints, servo positions, etc. as you tune._\n";

  return (
    `<!-- @ftc-toolchain generated: subsystem-doc — scaffolded; team edits expected -->\n` +
    `# ${spec.className}\n\n` +
    `${spec.description ?? "TODO: describe this subsystem."}\n\n` +
    `- **Package:** \`${spec.packageName}\`\n` +
    `- **Source:** \`${relSourcePath}\`\n` +
    depLine +
    (relTestPath ? `- **Bench test:** \`${relTestPath}\` (Driver Station: "Test ${spec.className}")\n` : "") +
    `\n## Hardware\n\n` +
    (hw.length
      ? `| Field | Type | Config name |\n| --- | --- | --- |\n${hw.join("\n")}\n`
      : "_No hardware declared._\n") +
    `\n> Config names must match the robot configuration on the Driver Station exactly.\n` +
    `\n## Functions\n\n${fnLines.join("\n")}\n` +
    `\n## Tuning\n\n${tuningSection}` +
    `\n## Notes / quirks\n\n_TODO: wiring notes, gotchas, mechanical constraints._\n`
  );
}
