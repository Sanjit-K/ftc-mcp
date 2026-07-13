#!/usr/bin/env node
// Smoke test: spins up the server over stdio and exercises each tool group.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(label, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`${mark}  ${label}${cond ? "" : `\n      ${detail}`}`);
}

async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.map((c) => c.text).join("\n") ?? "";
  return { text, isError: !!res.isError };
}

// Fake FTC project: just the files our tools touch.
const fakeProject = join(tmpdir(), `ftc-toolchain-test-${Date.now()}`);
mkdirSync(join(fakeProject, "TeamCode/src/main/java"), { recursive: true });
cpSync(
  join(ROOT, "refs/FtcRobotController/build.dependencies.gradle"),
  join(fakeProject, "build.dependencies.gradle")
);

// Deterministic fake Gradle + adb executables let robot workflows run without hardware.
const fakeGradlew = join(fakeProject, "gradlew");
const gradleArgsFile = join(fakeProject, "gradle-args.txt");
const failBuildFlag = join(fakeProject, "fail-build");
const skipApkFlag = join(fakeProject, "skip-apk");
writeFileSync(
  fakeGradlew,
  `#!/usr/bin/env node\nconst fs=require("node:fs"),p=require("node:path"),root=process.cwd();fs.writeFileSync(${JSON.stringify(gradleArgsFile)},process.argv.slice(2).join(" "));if(fs.existsSync(${JSON.stringify(failBuildFlag)})){console.error("FAILURE: Build failed with an exception.\\n/path/Bad.java:42: error: cannot find symbol\\n  symbol: variable missingMotor\\n  location: class Bad");process.exit(1);}const apk=p.join(root,"TeamCode/build/outputs/apk/debug/TeamCode-debug.apk");if(!fs.existsSync(${JSON.stringify(skipApkFlag)})){fs.mkdirSync(p.dirname(apk),{recursive:true});fs.writeFileSync(apk,"fake apk");}console.log("BUILD SUCCESSFUL");\n`
);
chmodSync(fakeGradlew, 0o755);
const fakeAdb = join(fakeProject, "fake-adb");
const fakeMcpHome = join(fakeProject, "mcp-data");
const multiDeviceFlag = join(fakeProject, "multi-device");
writeFileSync(
  fakeAdb,
  `#!/usr/bin/env node\nconst fs=require("node:fs"),a=process.argv.slice(2),has=(...x)=>x.every(v=>a.includes(v));if(a.includes("connect")){console.log("connected to 192.168.43.1:5555");}else if(a.includes("devices")){const extra=fs.existsSync(${JSON.stringify(multiDeviceFlag)})?"\\nsecond-hub\\tdevice":"";console.log("List of devices attached\\ncontrol-hub-1\\tdevice"+extra);}else if(a.includes("install")){console.log("Success");}else if(a.includes("logcat")&&a.includes("-d")){console.log("07-12 RobotCore: ready\\n07-12 CompTeleOp: test exception");}else if(has("getprop","ro.product.model")){console.log("REV Control Hub v1.0");}else if(has("getprop","ro.build.version.release")){console.log("10");}else if(has("dumpsys","battery")){console.log("AC powered: false\\nUSB powered: true\\nWireless powered: false\\nlevel: 82\\nscale: 100\\ntemperature: 315");}else if(has("dumpsys","package")){console.log("versionCode=10042 minSdk=23\\nversionName=10.2");}else if(has("df","/data")){console.log("Filesystem Size Used Avail Use% Mounted on\\n/dev/block/data 8G 3G 5G 38% /data");}else{console.log("OK");}\n`
);
chmodSync(fakeAdb, 0o755);
process.env.ADB_PATH = fakeAdb;
cpSync(
  join(ROOT, "refs/FtcRobotController/build.common.gradle"),
  join(fakeProject, "build.common.gradle")
);

const transport = new StdioClientTransport({
  command: "node",
  args: [join(ROOT, "dist/index.js")],
  env: { ...process.env, ADB_PATH: fakeAdb, FTC_TOOLCHAIN_HOME: fakeMcpHome },
});
const client = new Client({ name: "test-client", version: "0.0.1" });
await client.connect(transport);

try {
  const tools = await client.listTools();
  check(`lists 38 tools (got ${tools.tools.length})`, tools.tools.length === 38);

  let r = await call(client, "deploy_robot", { connection: "usb", projectPath: fakeProject, dryRun: true });
  check("deploy_robot previews direct USB deployment", !r.isError && r.text.includes("USB deployment preview") && r.text.includes("adb_devices"), r.text);

  r = await call(client, "deploy_robot", { connection: "wifi-switch", robotSsid: "FTC-TEST", projectPath: fakeProject, dryRun: true });
  check("deploy_robot previews automatic Wi-Fi switching", !r.isError && r.text.includes("Wi-Fi deployment preview") && r.text.includes("FTC-TEST"), r.text);

  r = await call(client, "wifi_deploy_start", { robotSsid: "FTC-TEST", projectPath: fakeProject, platform: "windows", dryRun: true });
  check("wifi_deploy_start previews Windows switch without building or disconnecting", !r.isError && r.text.includes("no build, network switch, or deployment") && r.text.includes("FTC-TEST") && r.text.includes("192.168.43.1:5555"), r.text);

  r = await call(client, "wifi_deploy_status", {});
  check("wifi_deploy_status explains when no job exists", r.isError && r.text.includes("No Wi-Fi deployment jobs found"), r.text);

  // Knowledge
  r = await call(client, "list_samples", { category: "Sensor" });
  check("list_samples(Sensor)", !r.isError && r.text.includes("SensorIMUOrthogonal"), r.text.slice(0, 200));

  r = await call(client, "get_sample", { name: "BasicOmniOpMode_Linear" });
  check("get_sample", !r.isError && r.text.includes("class BasicOmniOpMode_Linear"), r.text.slice(0, 200));

  r = await call(client, "search_docs", { query: "pinpoint localizer tuning" });
  check("search_docs", !r.isError && r.text.includes("pedro-docs"), r.text.slice(0, 300));

  r = await call(client, "search_docs", { query: "pinpont localizer tunning" });
  check("search_docs tolerates small technical-term typos", !r.isError && r.text.includes("pedro-docs"), r.text.slice(0, 300));

  r = await call(client, "reference_status", {});
  check("reference_status reports local counts and revisions", !r.isError && r.text.includes("Reference library: READY") && r.text.includes("FTC samples") && r.text.includes("Pedro docs"), r.text);

  r = await call(client, "get_doc", { id: "pathing/examples/auto" });
  check("get_doc", !r.isError && r.text.includes("pathBuilder"), r.text.slice(0, 200));

  r = await call(client, "get_doc", { id: "nonexistent/page" });
  check("get_doc missing -> isError", r.isError && r.text.includes("not found"));

  // Project tools against the fake project
  let projectCheck = await call(client, "inspect_project", { projectPath: fakeProject });
  check(
    "inspect_project reports actionable project readiness",
    !projectCheck.isError &&
      projectCheck.text.includes("Status: READY") &&
      projectCheck.text.includes("Gradle wrapper: ready") &&
      projectCheck.text.includes("Run build before deploy"),
    projectCheck.text
  );

  r = await call(client, "create_opmode", {
    projectPath: fakeProject,
    className: "PreviewAuto",
    template: "linear-auto",
    dryRun: true,
  });
  const previewAutoPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/PreviewAuto.java");
  check(
    "create_opmode dry-run returns source without writing",
    !r.isError && r.text.includes("PREVIEW ONLY") && r.text.includes("class PreviewAuto") && !existsSync(previewAutoPath),
    r.text.slice(0, 300)
  );

  r = await call(client, "create_opmode", {
    projectPath: fakeProject,
    className: "TestMecanumDrive",
    template: "mecanum-teleop",
    opModeName: "Test Drive",
  });
  const omPath = join(
    fakeProject,
    "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/TestMecanumDrive.java"
  );
  check("create_opmode writes file", !r.isError && existsSync(omPath), r.text);
  check(
    "opmode content correct",
    existsSync(omPath) &&
      readFileSync(omPath, "utf8").includes("@ftc-toolchain generated: opmode") &&
      readFileSync(omPath, "utf8").includes('@TeleOp(name = "Test Drive"') &&
      readFileSync(omPath, "utf8").includes("package org.firstinspires.ftc.teamcode;")
  );

  const existingOpMode = readFileSync(omPath, "utf8");
  r = await call(client, "create_opmode", {
    projectPath: fakeProject,
    className: "TestMecanumDrive",
    template: "linear-auto",
    dryRun: true,
  });
  check(
    "dry-run can preview an existing target without overwrite or mutation",
    !r.isError && r.text.includes("already exists") && r.text.includes("extends LinearOpMode") && readFileSync(omPath, "utf8") === existingOpMode,
    r.text.slice(0, 300)
  );

  r = await call(client, "create_opmode", {
    projectPath: fakeProject,
    className: "TestMecanumDrive",
    template: "mecanum-teleop",
  });
  check("create_opmode refuses overwrite", r.isError && r.text.includes("already exists"));

  r = await call(client, "create_opmode", {
    projectPath: fakeProject,
    className: "TestMecanumDrive",
    template: "linear-auto",
    overwrite: true,
  });
  const backupDir = r.text.match(/Backup: (.+)/)?.[1]?.trim();
  const backedUpOpMode = backupDir ? join(backupDir, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/TestMecanumDrive.java") : "";
  check(
    "explicit overwrite backs up the previous file outside the project",
    !r.isError && Boolean(backupDir) && backupDir.startsWith(fakeMcpHome) && existsSync(backedUpOpMode) &&
      readFileSync(backedUpOpMode, "utf8").includes("left_front_drive") && readFileSync(omPath, "utf8").includes("@Autonomous"),
    r.text
  );

  r = await call(client, "list_backups", { projectPath: fakeProject });
  const backupId = backupDir ? backupDir.split(/[\\/]/).pop() : "";
  check(
    "list_backups exposes the recovery snapshot and relative file",
    !r.isError && Boolean(backupId) && r.text.includes(backupId) && r.text.includes("TestMecanumDrive.java"),
    r.text
  );

  r = await call(client, "restore_backup", { projectPath: fakeProject, backupId });
  check(
    "restore_backup previews without changing the current file",
    !r.isError && r.text.includes("RESTORE PREVIEW") && readFileSync(omPath, "utf8").includes("@Autonomous"),
    r.text
  );

  r = await call(client, "restore_backup", {
    projectPath: fakeProject,
    backupId,
    files: ["../outside.java"],
    confirm: true,
  });
  check("restore_backup rejects path traversal", r.isError && r.text.includes("Unsafe backup file path"), r.text);

  r = await call(client, "restore_backup", { projectPath: fakeProject, backupId, confirm: true });
  check(
    "confirmed restore recovers prior source and backs up the replaced version",
    !r.isError && r.text.includes("Current versions were backed up first") && readFileSync(omPath, "utf8").includes("left_front_drive"),
    r.text
  );

  r = await call(client, "install_pedro", { projectPath: fakeProject, version: "2.0.1" });
  const deps = readFileSync(join(fakeProject, "build.dependencies.gradle"), "utf8");
  const common = readFileSync(join(fakeProject, "build.common.gradle"), "utf8");
  const constantsPath = join(
    fakeProject,
    "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedroPathing/Constants.java"
  );
  check(
    "install_pedro gradle edits",
    !r.isError &&
      deps.includes("mymaven.bylazar.com") &&
      deps.includes("com.pedropathing:ftc:2.0.1") &&
      common.includes("compileSdkVersion 34"),
    r.text
  );
  check("install_pedro constants scaffold", existsSync(constantsPath));

  r = await call(client, "install_pedro", { projectPath: fakeProject, version: "2.0.1" });
  check("install_pedro idempotent", !r.isError && r.text.includes("already present"), r.text);

  r = await call(client, "create_opmode", {
    projectPath: fakeProject,
    className: "TestPedroAuto",
    template: "pedro-auto",
  });
  check("create_opmode pedro-auto (no warning after install)", !r.isError && !r.text.includes("WARNING"), r.text);

  r = await call(client, "list_opmodes", { projectPath: fakeProject });
  check(
    "list_opmodes finds both",
    !r.isError && r.text.includes("TestMecanumDrive [TeleOp]") && r.text.includes("TestPedroAuto [Autonomous]"),
    r.text
  );

  r = await call(client, "create_opmode", {
    projectPath: "/nonexistent/path",
    className: "X",
    template: "linear-teleop",
  });
  check("bad projectPath -> isError with hint", r.isError && r.text.includes("create_project"));

  // Subsystem architecture layer
  r = await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "RollingIntake",
    group: "intake",
    description: "Rolling intake that grabs balls off the floor.",
    motors: [{ name: "intakeMotor", config: "intake" }],
    methods: ["spinIn", "spitOut"],
  });
  const subPath = join(
    fakeProject,
    "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/intake/RollingIntake.java"
  );
  const testPath = join(
    fakeProject,
    "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/intake/TestRollingIntake.java"
  );
  const docPath = join(fakeProject, "docs/subsystems/RollingIntake.md");
  const indexPath = join(fakeProject, "docs/ROBOT.md");
  check("create_subsystem writes class+test+doc+index", !r.isError && existsSync(subPath) && existsSync(testPath) && existsSync(docPath) && existsSync(indexPath), r.text);
  r = await call(client, "list_generated_files", { projectPath: fakeProject });
  check(
    "list_generated_files inventories marked scaffold types",
    !r.isError && r.text.includes("opmode:") && r.text.includes("subsystem:") && r.text.includes("bench-test:") && r.text.includes("subsystem-doc:"),
    r.text
  );

  r = await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "PreviewArm",
    servos: [{ name: "armServo", config: "arm" }],
    methods: ["raise", "lower"],
    dryRun: true,
  });
  const previewArmPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/subsystems/PreviewArm.java");
  check(
    "create_subsystem dry-run previews class, bench test, and docs without writing",
    !r.isError && r.text.includes("PREVIEW ONLY") && r.text.includes("class PreviewArm") && r.text.includes("TestPreviewArm") && !existsSync(previewArmPath),
    r.text.slice(0, 400)
  );
  const subSrc = existsSync(subPath) ? readFileSync(subPath, "utf8") : "";
  check(
    "subsystem class shape",
    subSrc.includes("package org.firstinspires.ftc.teamcode.intake;") &&
      subSrc.includes('public static final String INTAKE_MOTOR_NAME = "intake";') &&
      subSrc.includes("public RollingIntake(HardwareMap hardwareMap)") &&
      subSrc.includes("public void spinIn()") &&
      subSrc.includes("public void stop()") &&
      subSrc.includes("intakeMotor.setPower(0);"),
    subSrc.slice(0, 400)
  );
  const testSrc = existsSync(testPath) ? readFileSync(testPath, "utf8") : "";
  check(
    "test opmode binds methods to buttons",
    testSrc.includes("@TeleOp(name = \"Test RollingIntake\"") &&
      testSrc.includes("gamepad1.aWasPressed()") &&
      testSrc.includes("rollingIntake.spinIn()") &&
      testSrc.includes("rollingIntake.stop()"),
    testSrc.slice(0, 400)
  );
  check("index lists subsystem", readFileSync(indexPath, "utf8").includes("RollingIntake"));

  r = await call(client, "create_subsystem", { projectPath: fakeProject, name: "RollingIntake", group: "intake" });
  check("create_subsystem refuses overwrite", r.isError && r.text.includes("Refusing to replace"));

  const docOnlyPath = join(fakeProject, "docs/subsystems/DocOnly.md");
  writeFileSync(docOnlyPath, "# DocOnly\n\nMentor notes that must survive.\n");
  r = await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "DocOnly",
    motors: [{ name: "docMotor" }],
  });
  check(
    "create_subsystem never clobbers a pre-existing doc implicitly",
    r.isError && r.text.includes("docs/subsystems/DocOnly.md") && readFileSync(docOnlyPath, "utf8").includes("must survive"),
    r.text
  );

  r = await call(client, "document_subsystem", {
    projectPath: fakeProject,
    name: "RollingIntake",
    content: "# RollingIntake\n\nHand-written notes: motor stalls above 0.8 power.\n",
  });
  check("document_subsystem updates doc", !r.isError && readFileSync(docPath, "utf8").includes("stalls above 0.8"), r.text);

  r = await call(client, "list_subsystems", { projectPath: fakeProject });
  check("list_subsystems finds it", !r.isError && r.text.includes("RollingIntake"), r.text);

  r = await call(client, "get_subsystem", { projectPath: fakeProject, name: "RollingIntake", includeSource: true });
  check("get_subsystem returns doc+source", !r.isError && r.text.includes("stalls above 0.8") && r.text.includes("class RollingIntake"), r.text.slice(0, 200));

  // Subsystem with dependencies + dashboard-tunable constants
  await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "FlapServo",
    group: "intake",
    servos: [{ name: "flap", config: "flap" }],
    methods: ["on", "off"],
  });
  r = await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "Sorter",
    group: "sorting",
    motors: [{ name: "sortMotor", config: "sorter" }],
    dependencies: [{ type: "FlapServo", name: "flapServo" }],
    constants: [
      { name: "Kp", value: "0.01", comment: "gain", tunable: true },
      { name: "SLOTS", value: "3", javaType: "int", tunable: false },
    ],
    dashboard: "panels",
    methods: ["indexNext"],
  });
  const sorterPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/sorting/Sorter.java");
  const sorterSrc = existsSync(sorterPath) ? readFileSync(sorterPath, "utf8") : "";
  check(
    "subsystem: dep injection + @Configurable tunables + fixed const",
    !r.isError &&
      sorterSrc.includes("@Configurable") &&
      sorterSrc.includes("import com.bylazar.configurables.annotations.Configurable;") &&
      sorterSrc.includes("private final FlapServo flapServo;") &&
      sorterSrc.includes("public Sorter(HardwareMap hardwareMap, FlapServo flapServo)") &&
      sorterSrc.includes("this.flapServo = flapServo;") &&
      sorterSrc.includes("public static double Kp = 0.01;") &&
      sorterSrc.includes("private static final int SLOTS = 3;"),
    sorterSrc.slice(0, 600)
  );

  r = await call(client, "create_subsystem", { projectPath: fakeProject, name: "BadDep", group: "x", dependencies: [{ type: "Ghost" }] });
  check("subsystem rejects missing dependency", r.isError && r.text.includes("not found"), r.text);

  r = await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "BadHardware",
    motors: [{ name: "shared", config: "one" }],
    servos: [{ name: "shared", config: "two" }],
  });
  check("subsystem rejects duplicate hardware fields across device types", r.isError && r.text.includes("Duplicate hardware field"), r.text);

  r = await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "BadConfig",
    motors: [{ name: "leftMotor", config: "bad\"name" }],
  });
  check("subsystem rejects config names that would break generated Java", r.isError && r.text.includes("Invalid config name"), r.text);

  r = await call(client, "create_calculation", { projectPath: fakeProject, name: "TrajectorySolver" });
  const calcPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/util/TrajectorySolver.java");
  check("create_calculation writes helper", !r.isError && existsSync(calcPath) && readFileSync(calcPath, "utf8").includes("private TrajectorySolver()"), r.text);

  r = await call(client, "create_calculation", { projectPath: fakeProject, name: "PreviewMath", dryRun: true });
  const previewMathPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/util/PreviewMath.java");
  check("create_calculation dry-run is side-effect free", !r.isError && r.text.includes("class PreviewMath") && !existsSync(previewMathPath), r.text);

  // Add a second subsystem re-using the same config name, to test collision detection.
  await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "Transfer",
    group: "intake",
    motors: [{ name: "transferMotor", config: "intake" }],
    methods: ["transferOn"],
  });
  r = await call(client, "hardware_manifest", { projectPath: fakeProject });
  check(
    "hardware_manifest lists names + flags duplicate",
    !r.isError && r.text.includes('"intake"') && r.text.includes("multiple files"),
    r.text
  );

  await call(client, "create_subsystem", {
    projectPath: fakeProject,
    name: "ConfigConflict",
    group: "test",
    servos: [{ name: "conflictingServo", config: "intake" }],
    testOpMode: false,
  });
  r = await call(client, "validate_hardware", { projectPath: fakeProject });
  check(
    "validate_hardware flags one config name requested as incompatible types",
    !r.isError && r.text.includes("Hardware validation: ERROR") && r.text.includes('"intake"') && r.text.includes("DcMotorEx") && r.text.includes("Servo"),
    r.text
  );

  // create_teleop: TeleOp + separate bindings file
  r = await call(client, "create_teleop", {
    projectPath: fakeProject,
    className: "PreviewTeleOp",
    drive: "none",
    subsystems: ["RollingIntake"],
    actions: [{ name: "intake", input: "driver.a", mode: "hold", onActive: "rollingIntake.spinIn()", onInactive: "rollingIntake.stop()" }],
    dryRun: true,
  });
  const previewTeleOpPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/PreviewTeleOp.java");
  check(
    "create_teleop dry-run previews behavior and bindings without writing",
    !r.isError && r.text.includes("class PreviewTeleOp") && r.text.includes("class PreviewTeleOpControls") && !existsSync(previewTeleOpPath),
    r.text.slice(0, 400)
  );

  r = await call(client, "create_teleop", {
    projectPath: fakeProject,
    className: "CompTeleOp",
    drive: "mecanum",
    subsystems: ["RollingIntake"],
    slowMode: { input: "driver.left_trigger > 0.5", mode: "toggle", factor: 0.4 },
    actions: [
      { name: "intakeIn", label: "Intake in", input: "driver.right_bumper", mode: "hold", onActive: "rollingIntake.spinIn()", onInactive: "rollingIntake.stop()", exclusiveGroup: "intake" },
      { name: "intakeOut", label: "Intake out", input: "driver.left_bumper", mode: "hold", onActive: "rollingIntake.spitOut()", exclusiveGroup: "intake" },
    ],
    automations: [
      { name: "autoSort", description: "Sort balls by color automatically." },
    ],
  });
  const teleopPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/CompTeleOp.java");
  const ctrlPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/CompTeleOpControls.java");
  check("create_teleop writes teleop + controls", !r.isError && existsSync(teleopPath) && existsSync(ctrlPath), r.text);
  const ctrlSrc = existsSync(ctrlPath) ? readFileSync(ctrlPath, "utf8") : "";
  check(
    "controls file is a clean bindings map",
    ctrlSrc.includes("public static double driveForward(Gamepad driver, Gamepad operator)") &&
      ctrlSrc.includes("public static boolean intakeIn(Gamepad driver, Gamepad operator) { return driver.right_bumper; }") &&
      !ctrlSrc.includes("rollingIntake"), // no robot logic leaks into bindings
    ctrlSrc
  );
  const teleopSrc = existsSync(teleopPath) ? readFileSync(teleopPath, "utf8") : "";
  check(
    "teleop wires drive, exclusive group, automation stub",
    teleopSrc.includes("new RollingIntake(hardwareMap)") &&
      teleopSrc.includes("else if (CompTeleOpControls.intakeOut(driver, operator))") &&
      teleopSrc.includes("else { rollingIntake.stop(); }") &&
      teleopSrc.includes("private void autoSort()") &&
      teleopSrc.includes("CompTeleOpControls.driveForward"),
    teleopSrc.slice(0, 300)
  );

  // create_teleop must construct a subsystem's dependencies first, and honor guards
  r = await call(client, "create_teleop", {
    projectPath: fakeProject,
    className: "SortTeleOp",
    drive: "none",
    subsystems: ["Sorter"],
    actions: [
      { name: "index", label: "Index", input: "operator.a", mode: "press", onActive: "sorter.indexNext()", guard: "!sorter.isBusy()" },
    ],
  });
  const sortTeleopPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/SortTeleOp.java");
  const sortTeleopSrc = existsSync(sortTeleopPath) ? readFileSync(sortTeleopPath, "utf8") : "";
  check(
    "teleop constructs dependency (FlapServo) before dependent (Sorter)",
    !r.isError &&
      sortTeleopSrc.includes("flapServo = new FlapServo(hardwareMap);") &&
      sortTeleopSrc.includes("sorter = new Sorter(hardwareMap, flapServo);") &&
      sortTeleopSrc.indexOf("new FlapServo") < sortTeleopSrc.indexOf("new Sorter(hardwareMap"),
    sortTeleopSrc.slice(0, 500)
  );
  check(
    "teleop action guard is ANDed with the (edge) trigger",
    sortTeleopSrc.includes("boolean indexNow = SortTeleOpControls.index(driver, operator);") &&
      sortTeleopSrc.includes("if ((!sorter.isBusy()) && (indexNow && !indexPrev))"),
    sortTeleopSrc
  );
  check("teleop reports auto-constructed dependency", r.text.includes("FlapServo"), r.text);

  r = await call(client, "create_teleop", { projectPath: fakeProject, className: "NoSub", subsystems: ["DoesNotExist"] });
  check("create_teleop rejects unknown subsystem", r.isError && r.text.includes("not found"), r.text);

  r = await call(client, "create_teleop", {
    projectPath: fakeProject,
    className: "BadGroup",
    subsystems: ["RollingIntake"],
    actions: [{ name: "x", input: "driver.a", mode: "press", onActive: "rollingIntake.spinIn()", exclusiveGroup: "g" }],
  });
  check("create_teleop rejects non-hold grouped action", r.isError && r.text.includes("must be"), r.text);

  // Robot workflow tools against deterministic fake Gradle + adb.
  r = await call(client, "adb_devices", {});
  check("adb_devices runs", !r.isError && r.text.includes("control-hub-1"), r.text.slice(0, 200));

  r = await call(client, "robot_status", {});
  check(
    "robot_status summarizes device, RC version, battery, and storage",
    !r.isError && r.text.includes("REV Control Hub v1.0") && r.text.includes("Robot Controller: 10.2") &&
      r.text.includes("82%") && r.text.includes("31.5°C") && r.text.includes("38% /data"),
    r.text
  );

  r = await call(client, "restart_robot_controller", {});
  check("restart_robot_controller restarts selected device without deploy", !r.isError && r.text.includes("control-hub-1"), r.text);

  r = await call(client, "clear_robot_logs", {});
  check("clear_robot_logs clears selected device", !r.isError && r.text.includes("control-hub-1"), r.text);

  r = await call(client, "robot_logs", { filter: "CompTeleOp" });
  check("robot_logs filters clean capture", !r.isError && r.text.includes("test exception") && !r.text.includes("RobotCore"), r.text);

  writeFileSync(failBuildFlag, "1");
  r = await call(client, "build", { projectPath: fakeProject });
  check(
    "build returns compiler error with nearby symbol context",
    r.isError && r.text.includes("Bad.java:42") && r.text.includes("missingMotor") && r.text.includes("stacktrace: true"),
    r.text
  );
  rmSync(failBuildFlag, { force: true });

  const apkPath = join(fakeProject, "TeamCode/build/outputs/apk/debug/TeamCode-debug.apk");
  rmSync(apkPath, { force: true });
  writeFileSync(skipApkFlag, "1");
  r = await call(client, "build", { projectPath: fakeProject });
  check("build rejects false success when APK is missing", r.isError && r.text.includes("no APK was produced"), r.text);
  rmSync(skipApkFlag, { force: true });

  r = await call(client, "build", { projectPath: fakeProject, clean: true, timeoutSeconds: 60 });
  check(
    "build supports clean mode and reports verified artifact metadata",
    !r.isError && r.text.includes("clean build") && r.text.includes("Size:") && readFileSync(gradleArgsFile, "utf8").includes(":TeamCode:clean"),
    r.text
  );

  r = await call(client, "build_and_deploy", { projectPath: fakeProject });
  check(
    "build_and_deploy creates fresh APK and installs to selected device",
    !r.isError && existsSync(join(fakeProject, "TeamCode/build/outputs/apk/debug/TeamCode-debug.apk")) &&
      r.text.includes("BUILD SUCCESSFUL") && r.text.includes("control-hub-1"),
    r.text
  );

  r = await call(client, "deploy_robot", { connection: "usb", projectPath: fakeProject });
  check(
    "deploy_robot USB mode builds and installs on the attached adb device",
    !r.isError && r.text.includes("BUILD SUCCESSFUL") && r.text.includes("control-hub-1"),
    r.text
  );

  await call(client, "create_opmode", {
    projectPath: fakeProject,
    className: "DuplicateDisplayName",
    template: "linear-auto",
    opModeName: "TestPedroAuto",
  });
  const orphanControls = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/OrphanControls.java");
  writeFileSync(orphanControls, "// @ftc-toolchain generated: controls — scaffolded; driver edits expected\nclass OrphanControls {}\n");
  const brokenDoc = join(fakeProject, "docs/subsystems/Broken.md");
  writeFileSync(brokenDoc, "<!-- @ftc-toolchain generated: subsystem-doc -->\n# Broken\n\n- **Source:** `TeamCode/src/main/java/missing/Broken.java`\n");
  const future = new Date(Date.now() + 10_000);
  utimesSync(orphanControls, future, future);
  r = await call(client, "check_project_hygiene", { projectPath: fakeProject });
  check(
    "check_project_hygiene finds duplicate names, orphan pairs, broken docs, hardware errors, and stale APK",
    !r.isError && r.text.includes("Project hygiene: ERROR") && r.text.includes('Driver Station name "TestPedroAuto"') &&
      r.text.includes("OrphanControls.java has no matching Orphan.java") && r.text.includes("points to missing source") &&
      r.text.includes("incompatible types") && r.text.includes("APK is stale"),
    r.text
  );

  writeFileSync(multiDeviceFlag, "1");
  r = await call(client, "clear_robot_logs", {});
  check(
    "robot tools require serial when multiple devices are attached",
    r.isError && r.text.includes("Multiple devices") && r.text.includes("control-hub-1") && r.text.includes("second-hub"),
    r.text
  );
  r = await call(client, "clear_robot_logs", { serial: "second-hub" });
  check("explicit serial selects one of multiple devices", !r.isError && r.text.includes("second-hub"), r.text);
  rmSync(multiDeviceFlag, { force: true });

  // Exercise the detached worker logic with fake Wi-Fi and adb commands.
  const fakeNetworksetup = join(fakeProject, "networksetup");
  writeFileSync(fakeNetworksetup, "#!/bin/sh\nexit 0\n");
  chmodSync(fakeNetworksetup, 0o755);
  const wifiJobId = "wifi-worker-test";
  const wifiJobsDir = join(fakeMcpHome, "wifi-deploy-jobs");
  mkdirSync(wifiJobsDir, { recursive: true });
  const wifiJobPath = join(wifiJobsDir, `${wifiJobId}.json`);
  const wifiNow = new Date().toISOString();
  writeFileSync(wifiJobPath, JSON.stringify({
    id: wifiJobId, createdAt: wifiNow, updatedAt: wifiNow, stage: "queued", platform: "macos",
    robotSsid: "FTC-TEST", homeSsid: "HOME-TEST", robotHost: "192.168.43.1", robotPort: 5555,
    apkPath: join(fakeProject, "TeamCode/build/outputs/apk/debug/TeamCode-debug.apk"), wifiDevice: "en0",
    delaySeconds: 0, messages: ["queued for test"],
  }));
  execFileSync(process.execPath, [join(ROOT, "dist/index.js"), "__wifi-deploy-worker", wifiJobId], {
    env: { ...process.env, PATH: `${fakeProject}:${process.env.PATH}`, ADB_PATH: fakeAdb, FTC_TOOLCHAIN_HOME: fakeMcpHome },
  });
  const wifiResult = JSON.parse(readFileSync(wifiJobPath, "utf8"));
  check(
    "Wi-Fi deploy worker installs locally and restores the original network",
    wifiResult.stage === "succeeded" && wifiResult.messages.some((message) => message.includes("Returning Wi-Fi to HOME-TEST")),
    JSON.stringify(wifiResult, null, 2)
  );
} finally {
  await client.close();
  rmSync(fakeProject, { recursive: true, force: true });
}

// Reference updates must refuse dirty checkouts before attempting any network operation.
const fakeRefs = join(tmpdir(), `ftc-toolchain-refs-test-${Date.now()}`);
for (const name of ["FtcRobotController", "PedroDocs"]) {
  const repo = join(fakeRefs, name);
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "team-notes.txt"), "do not overwrite\n");
}
const oldRefs = process.env.FTC_TOOLCHAIN_REFS;
process.env.FTC_TOOLCHAIN_REFS = fakeRefs;
try {
  const { updateReferences } = await import(`${pathToFileURL(join(ROOT, "dist/setup.js")).href}?dirty-test=${Date.now()}`);
  let message = "";
  try {
    await updateReferences();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  check("update_references refuses dirty local checkouts", message.includes("local changes"), message);
} finally {
  if (oldRefs === undefined) delete process.env.FTC_TOOLCHAIN_REFS;
  else process.env.FTC_TOOLCHAIN_REFS = oldRefs;
  rmSync(fakeRefs, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
