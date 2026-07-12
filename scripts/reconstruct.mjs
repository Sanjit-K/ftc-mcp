#!/usr/bin/env node
// Drives the ftc-toolchain server (dist/index.js) to reconstruct the Voyager robot
// from robot-prompt.md into a fresh project folder. This is the "agent" turning
// the prompt into MCP tool calls; method bodies are filled in afterward.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = process.argv[2] || "/Users/sanjitk./StudioProjects/voyager-x-reconstructed/FtcRobotController";

const transport = new StdioClientTransport({ command: "node", args: [join(ROOT, "dist/index.js")] });
const client = new Client({ name: "reconstruct", version: "0.0.1" });
await client.connect(transport);

let failed = false;
async function call(name, args, { allowError = false } = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text).join("\n");
  const tag = res.isError ? "ERROR" : "ok";
  console.log(`\n### ${name}(${args.className || args.name || args.dest || ""}) [${tag}]`);
  console.log(text.split("\n").slice(0, 6).join("\n"));
  if (res.isError && !allowError) failed = true;
  return text;
}

const P = { projectPath: PROJECT };

// 1. Fresh SDK project + Pedro
await call("create_project", { dest: PROJECT }, { allowError: true });
await call("install_pedro", { ...P });

// 2. Subsystems (declaration order respects dependencies: leaf subsystems first)
await call("create_subsystem", {
  ...P, name: "BarIntake", group: "intake",
  description: "Rolling bar intake that grabs artifacts off the floor.",
  motors: [{ name: "motor", config: "barIntake", reversed: false }],
  constants: [{ name: "power", value: "1.0", tunable: true, comment: "intake power" }],
  methods: ["spinIntake", "spinOuttake", "getStatus", "getPower", "setPower"],
});

await call("create_subsystem", {
  ...P, name: "IntakeFlap", group: "intake",
  description: "Servo flap that gates artifacts entering the spindexer.",
  servos: [{ name: "servo", config: "intakeFlapServo" }],
  constants: [
    { name: "ON_POSITION", value: "0.2", tunable: false },
    { name: "OFF_POSITION", value: "0.4", tunable: false },
  ],
  methods: ["on", "off", "isOn"],
});

await call("create_subsystem", {
  ...P, name: "IntakeServo", group: "intake",
  description: "Servo that flips the intake between intake and outtake positions.",
  servos: [{ name: "servo", config: "intakeServo" }],
  constants: [
    { name: "INTAKE_POSITION", value: "0.59", tunable: false },
    { name: "OUTTAKE_POSITION", value: "0.57", tunable: false },
  ],
  methods: ["intake", "outtake", "setPosition"],
});

await call("create_subsystem", {
  ...P, name: "ColorSensor", group: "sorting",
  description: "Hue-based color classifier for green/purple artifacts.",
  sensors: [{ name: "sensor", config: "colorSensor", type: "color" }],
  constants: [
    { name: "GREEN_HUE", value: "160f", javaType: "float", tunable: true },
    { name: "PURPLE_HUE", value: "240f", javaType: "float", tunable: true },
    { name: "TOLERANCE", value: "30f", javaType: "float", tunable: true },
  ],
  methods: ["detection", "getHueDegrees"],
});

await call("create_subsystem", {
  ...P, name: "Lights", group: "sorting",
  description: "Three indicator light servos.",
  servos: [
    { name: "lightLeft", config: "lightLeft" },
    { name: "lightRight", config: "lightRight" },
    { name: "lightBack", config: "lightBack" },
  ],
  methods: ["turnAllOn", "turnAllOff"],
});

await call("create_subsystem", {
  ...P, name: "KickerServo", group: "shooting",
  description: "Kicker servo that pushes an artifact into the flywheel.",
  servos: [{ name: "servo", config: "kickerServo" }],
  constants: [
    { name: "NORMAL_POSITION", value: "0.52", tunable: false },
    { name: "KICK_POSITION", value: "0.40", tunable: false },
  ],
  methods: ["kick", "normal", "setPosition"],
});

// Spindexer depends on ColorSensor + IntakeFlap; tunable PID.
await call("create_subsystem", {
  ...P, name: "Spindexer", group: "sorting",
  description: "Rotating 3-slot spindexer that sorts artifacts by color with a custom PID.",
  motors: [{ name: "spindexerMotor", config: "spindexerMotor" }],
  sensors: [
    { name: "analogEncoder", config: "spindexerAnalog", type: "analog" },
    { name: "distanceSensor", config: "distanceSensor", type: "digital" },
  ],
  dependencies: [
    { type: "ColorSensor", name: "colorSensor" },
    { type: "IntakeFlap", name: "intakeFlap" },
  ],
  constants: [
    { name: "Kp", value: "0.009", tunable: true, comment: "position PID" },
    { name: "Ki", value: "0.0", tunable: true },
    { name: "Kd", value: "0.0006", tunable: true },
    { name: "kStatic", value: "0.0325", tunable: true, comment: "min power to overcome friction" },
    { name: "SLOT_COUNT", value: "3", javaType: "int", tunable: false },
  ],
  methods: [
    "getAngleFromAnalog", "getCalibratedAngle", "calibrateSetCurrentAsZero",
    "startMoveToAngle", "startSpinDegrees", "startSpin720", "isSpinInProgress", "update",
    "goToOuttakePosition", "startAccurateColorScan", "isAccurateColorScanInProgress", "cancelAccurateColorScan",
    "setIntakeIndex", "advanceIntake", "retreatIntake", "setShootIndex", "advanceShoot", "retreatShoot",
    "setColorAtPos", "isFull", "isEmpty", "getBalls", "clearTracking", "getIntakeIndex", "getShootIndex", "isAtTarget",
  ],
});

// Turret: shooter flywheel + transfer motor + turret/hood servos + analog encoder; tunable PIDs.
await call("create_subsystem", {
  ...P, name: "Turret", group: "shooting",
  description: "Shooter turret: velocity-PID flywheel, transfer feed, aiming servo, hood, turret encoder.",
  motors: [
    { name: "shooterMotor", config: "shooter", reversed: true },
    { name: "transferMotor", config: "transferMotor", reversed: false },
  ],
  servos: [
    { name: "turretServo", config: "turret" },
    { name: "hoodServo", config: "hoodServo" },
  ],
  sensors: [{ name: "turretEncoder", config: "turretEncoder", type: "analog" }],
  constants: [
    { name: "Kp", value: "0.02", tunable: true, comment: "turret aim PID" },
    { name: "Ki", value: "0.0", tunable: true },
    { name: "Kd", value: "0.001", tunable: true },
    { name: "kStatic", value: "0.1", tunable: true },
    { name: "SHOOTER_KP", value: "0.01", tunable: true },
    { name: "SHOOTER_KI", value: "0.0", tunable: true },
    { name: "SHOOTER_KD", value: "0.0", tunable: true },
    { name: "SHOOTER_KS", value: "0.03", tunable: true },
    { name: "SHOOTER_KV", value: "(1.0 - SHOOTER_KS) / 4500.0", tunable: true },
    { name: "shooterRPM", value: "2500.0", tunable: true, comment: "near preset" },
    { name: "farRPM", value: "3000.0", tunable: true, comment: "far preset" },
  ],
  methods: [
    "on", "onFar", "off", "transferOn", "transferOff", "transferPower",
    "setShooterRPM", "getShooterRPM", "getSetShooterRPM",
    "setHoodPosition", "getHoodPosition", "trackTarget", "goToPosition",
    "getEncoderAngle", "getTurretVoltage", "getAngle", "getCurrentDraw",
  ],
});

// 3. Calculation helper for the LockMode behavior lives in a teleop-functions package.
await call("create_calculation", {
  ...P, name: "LockMode", group: "drive.opmode.teleop.functions",
  description: "Holds robot position with a tiny oscillating Pedro path (translational + heading PIDs engaged).",
});

// 4. TeleOp (Blue) with the real control scheme, guards, and automations.
const teleopArgs = (color, colorLower) => ({
  ...P,
  className: `${color}TeleOp`,
  opModeName: `!! ${color} TeleOp`,
  group: "TeleOp",
  drive: "pedro-field-centric",
  subsystems: ["BarIntake", "IntakeFlap", "IntakeServo", "ColorSensor", "Lights", "Spindexer", "Turret"],
  actions: [
    { name: "resetField", label: "Reset field pose", input: "driver.shareWasPressed()", mode: "press", onActive: "follower.setPose(new com.pedropathing.geometry.Pose(0,0,0))" },
    { name: "manualOuttake", label: "Manual spit", input: "driver.yWasPressed()", mode: "press", onActive: "startSingleOuttake()", guard: "!colorScanInProgress && !outtakeInProgress && !singleOuttakeInProgress" },
    { name: "advanceSpindex", label: "Advance spindexer", input: "driver.rightBumperWasPressed()", mode: "press", onActive: "spindexer.advanceShoot()", guard: "!colorScanInProgress" },
    { name: "retreatSpindex", label: "Retreat spindexer", input: "driver.leftBumperWasPressed()", mode: "press", onActive: "spindexer.retreatShoot()", guard: "!colorScanInProgress" },
    { name: "colorScan", label: "Color scan", input: "driver.xWasPressed()", mode: "press", onActive: "spindexer.startAccurateColorScan()", guard: "!colorScanInProgress" },
    { name: "outtakeRoutine", label: "Outtake routine", input: "driver.left_trigger > 0.5", mode: "press", onActive: "startOuttakeRoutine()", guard: "!colorScanInProgress && !outtakeInProgress" },
    { name: "lock", label: "Lock mode on", input: "driver.leftStickButtonWasPressed()", mode: "press", onActive: "isLocked = true" },
    { name: "unlock", label: "Lock mode off", input: "driver.rightStickButtonWasPressed()", mode: "press", onActive: "isLocked = false" },
  ],
  automations: [
    { name: "manageIntakeAndFlap", description: "Auto-manage intake + flap from spindexer state: eject while color-scanning, intake when not full, lights on + flap off when full." },
    { name: "autoTrackTurret", description: "Aim the turret at the goal every loop with velocity-compensated RPM.", guard: "!colorScanInProgress" },
    { name: "autoshoot", description: "Shoot when full, in the shooting zone, turret aimed, and RPM ready.", input: "driver.right_trigger > 0.5", guard: "!colorScanInProgress && !outtakeInProgress && !singleOuttakeInProgress" },
    { name: "handleOuttakeRoutine", description: "Advance the outtake scoring state machine while it is running.", guard: "outtakeInProgress" },
    { name: "handleSingleOuttake", description: "Advance the single-ball outtake state machine while it is running.", guard: "singleOuttakeInProgress" },
  ],
});
await call("create_teleop", teleopArgs("Blue", "blue"));
await call("create_teleop", teleopArgs("Red", "red"));

// 5. Representative autos (far, Blue + Red) via the Pedro FSM template.
await call("create_opmode", { ...P, className: "BlueFarAuto", template: "pedro-auto", opModeName: "Blue Far Auto (18 ball)", group: "Autonomous", packageName: "org.firstinspires.ftc.teamcode.drive.opmode.auto.far" });
await call("create_opmode", { ...P, className: "RedFarAuto", template: "pedro-auto", opModeName: "Red Far Auto (18 ball)", group: "Autonomous", packageName: "org.firstinspires.ftc.teamcode.drive.opmode.auto.far" });

await call("list_subsystems", { ...P });
await call("hardware_manifest", { ...P });

await client.close();
console.log(failed ? "\n=== RECONSTRUCTION HAD ERRORS ===" : "\n=== RECONSTRUCTION SCAFFOLD COMPLETE ===");
process.exit(failed ? 1 : 0);
