#!/usr/bin/env node
// Integration test: scaffold a realistic set of subsystems (mirroring last year's
// intake/spindexer/transfer/turret robot) + a calculation helper, then compile
// everything in a real Gradle build.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = process.argv[2] ?? join(ROOT, "refs/FtcRobotController");

const transport = new StdioClientTransport({ command: "node", args: [join(ROOT, "dist/index.js")] });
const client = new Client({ name: "subsystem-build-test", version: "0.0.1" });
await client.connect(transport);

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text).join("\n");
  console.log(`--- ${name}(${args.name ?? ""}) ${res.isError ? "(ERROR)" : ""}\n${text.slice(0, 400)}`);
  if (res.isError) {
    await client.close();
    process.exit(1);
  }
  return text;
}

// Panels (@Configurable) is needed for dashboard-tunable subsystem constants.
await call("install_pedro", { projectPath: project });

await call("create_subsystem", {
  projectPath: project,
  name: "RollingIntake",
  group: "intake",
  description: "Rolling intake that grabs balls off the floor.",
  motors: [{ name: "intakeMotor", config: "intake", reversed: true }],
  methods: ["spinIn", "spitOut"],
  overwrite: true,
});

// Dependencies for the Spindexer, created first so they can be injected.
await call("create_subsystem", {
  projectPath: project,
  name: "IntakeFlap",
  group: "intake",
  servos: [{ name: "flapServo", config: "intakeFlapServo" }],
  methods: ["on", "off"],
  overwrite: true,
});

await call("create_subsystem", {
  projectPath: project,
  name: "Spindexer",
  group: "sorting",
  description: "Rotating spindexer that sorts balls by color, with custom motor PID.",
  motors: [{ name: "spindexerMotor", config: "spindexer" }],
  sensors: [
    { name: "colorSensor", config: "spindexer_color", type: "color" },
    { name: "distanceSensor", config: "spindexer_distance", type: "distance" },
  ],
  dependencies: [{ type: "IntakeFlap", name: "intakeFlap" }],
  constants: [
    { name: "Kp", value: "0.009", comment: "proportional gain" },
    { name: "Ki", value: "0.0" },
    { name: "Kd", value: "0.0006" },
    { name: "kStatic", value: "0.0325", comment: "min power to overcome friction" },
    { name: "SLOT_COUNT", value: "3", javaType: "int", tunable: false },
  ],
  methods: ["indexNext", "readColor", "alignToSlot", "isBusy"],
  overwrite: true,
});

await call("create_subsystem", {
  projectPath: project,
  name: "Turret",
  group: "shooting",
  description: "Shooter turret: 1 motor + aiming servo + analog turret encoder.",
  motors: [{ name: "shooterMotor", config: "shooter" }],
  servos: [{ name: "turretServo", config: "turret" }],
  sensors: [{ name: "turretEncoder", config: "turret_encoder", type: "analog" }],
  methods: ["on", "off", "aim"],
  overwrite: true,
});

await call("create_calculation", {
  projectPath: project,
  name: "TrajectorySolver",
  group: "shooting",
  description: "Live trajectory math for the shooter (pure functions).",
  overwrite: true,
});

await call("create_teleop", {
  projectPath: project,
  className: "CompTeleOp",
  drive: "mecanum",
  subsystems: ["RollingIntake", "Spindexer", "Turret"],
  slowMode: { input: "driver.left_trigger > 0.5", mode: "toggle", factor: 0.4 },
  actions: [
    { name: "intakeIn", label: "Intake in", input: "driver.right_bumper", mode: "hold", onActive: "rollingIntake.spinIn()", onInactive: "rollingIntake.stop()", exclusiveGroup: "intake" },
    { name: "intakeOut", label: "Intake out", input: "driver.left_bumper", mode: "hold", onActive: "rollingIntake.spitOut()", exclusiveGroup: "intake" },
    { name: "shooter", label: "Toggle shooter", input: "operator.y", mode: "toggle", onActive: "turret.on()", onInactive: "turret.off()" },
    { name: "index", label: "Index next", input: "operator.b", mode: "press", onActive: "spindexer.indexNext()" },
  ],
  automations: [
    { name: "autoSortByColor", description: "Read the color sensor and index balls into the correct slot automatically." },
    { name: "autoAim", description: "While held, rotate the turret to aim at the goal.", input: "operator.right_trigger > 0.5" },
  ],
  overwrite: true,
});

await call("list_subsystems", { projectPath: project });
await call("hardware_manifest", { projectPath: project });
await call("build", { projectPath: project });

await client.close();
console.log("SUBSYSTEM INTEGRATION TEST PASSED");
