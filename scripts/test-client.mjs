#!/usr/bin/env node
// Smoke test: spins up the server over stdio and exercises each tool group.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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
const fakeProject = join(tmpdir(), `ftc-mcp-test-${Date.now()}`);
mkdirSync(join(fakeProject, "TeamCode/src/main/java"), { recursive: true });
cpSync(
  join(ROOT, "refs/FtcRobotController/build.dependencies.gradle"),
  join(fakeProject, "build.dependencies.gradle")
);
cpSync(
  join(ROOT, "refs/FtcRobotController/build.common.gradle"),
  join(fakeProject, "build.common.gradle")
);

const transport = new StdioClientTransport({
  command: "node",
  args: [join(ROOT, "dist/index.js")],
});
const client = new Client({ name: "test-client", version: "0.0.1" });
await client.connect(transport);

try {
  const tools = await client.listTools();
  check(`lists 19 tools (got ${tools.tools.length})`, tools.tools.length === 19);

  // Knowledge
  let r = await call(client, "list_samples", { category: "Sensor" });
  check("list_samples(Sensor)", !r.isError && r.text.includes("SensorIMUOrthogonal"), r.text.slice(0, 200));

  r = await call(client, "get_sample", { name: "BasicOmniOpMode_Linear" });
  check("get_sample", !r.isError && r.text.includes("class BasicOmniOpMode_Linear"), r.text.slice(0, 200));

  r = await call(client, "search_docs", { query: "pinpoint localizer tuning" });
  check("search_docs", !r.isError && r.text.includes("pedro-docs"), r.text.slice(0, 300));

  r = await call(client, "get_doc", { id: "pathing/examples/auto" });
  check("get_doc", !r.isError && r.text.includes("pathBuilder"), r.text.slice(0, 200));

  r = await call(client, "get_doc", { id: "nonexistent/page" });
  check("get_doc missing -> isError", r.isError && r.text.includes("not found"));

  // Project tools against the fake project
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
      readFileSync(omPath, "utf8").includes('@TeleOp(name = "Test Drive"') &&
      readFileSync(omPath, "utf8").includes("package org.firstinspires.ftc.teamcode;")
  );

  r = await call(client, "create_opmode", {
    projectPath: fakeProject,
    className: "TestMecanumDrive",
    template: "mecanum-teleop",
  });
  check("create_opmode refuses overwrite", r.isError && r.text.includes("already exists"));

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
  check("create_subsystem refuses overwrite", r.isError && r.text.includes("already exists"));

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

  r = await call(client, "create_calculation", { projectPath: fakeProject, name: "TrajectorySolver" });
  const calcPath = join(fakeProject, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/util/TrajectorySolver.java");
  check("create_calculation writes helper", !r.isError && existsSync(calcPath) && readFileSync(calcPath, "utf8").includes("private TrajectorySolver()"), r.text);

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

  // Robot tools (no robot attached — just verify graceful behavior)
  r = await call(client, "adb_devices", {});
  check("adb_devices runs", !r.isError && r.text.includes("devices"), r.text.slice(0, 200));

  r = await call(client, "robot_logs", {});
  console.log(`INFO  robot_logs without device -> ${r.isError ? "error (ok)" : "output"}: ${r.text.slice(0, 120).replace(/\n/g, " ")}`);

  r = await call(client, "deploy", { projectPath: fakeProject });
  check("deploy without APK -> isError with hint", r.isError && r.text.includes("Run the build tool first"));
} finally {
  await client.close();
  rmSync(fakeProject, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
