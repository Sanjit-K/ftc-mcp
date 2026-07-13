import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAutonomousStudio, discoverRobotActions, getAutonomousStudioDraft, openAutonomousStudio } from "../dist/studio.js";

const project = mkdtempSync(join(tmpdir(), "ftc-toolchain-studio-"));
const javaRoot = join(project, "TeamCode/src/main/java/org/firstinspires/ftc/teamcode");
mkdirSync(join(javaRoot, "subsystems/shooting"), { recursive: true });
mkdirSync(join(javaRoot, "automations"), { recursive: true });

writeFileSync(join(javaRoot, "subsystems/shooting/Intake.java"), `
package org.firstinspires.ftc.teamcode.subsystems.shooting;
public class Intake {
  public Intake(Object hardwareMap) {}
  public void spin(double power, boolean reverse) {}
  public void stop() {}
  public boolean isBusy() { return false; }
  private void hidden() {}
}
`);
writeFileSync(join(javaRoot, "automations/ScoreRoutine.java"), `
package org.firstinspires.ftc.teamcode.automations;
public class ScoreRoutine {
  public static void score(String target) {}
}
`);
writeFileSync(join(javaRoot, "RobotTeleOp.java"), `
package org.firstinspires.ftc.teamcode;
public class RobotTeleOp { public void loop() {} }
`);
writeFileSync(join(javaRoot, "PreservedAuto.java"), `
package org.firstinspires.ftc.teamcode;
@Autonomous(name = "Preserved Auto", group = "Auto")
public class PreservedAuto extends OpMode {
  private final Object subsystem = new Object();
  void initPaths() {
    follower.setStartingPose(new Pose(10, 20, Math.toRadians(90)));
    Score = follower.pathBuilder()
      .addPath(new BezierLine(new Pose(10, 20), new Pose(30, 40)))
      .setConstantHeadingInterpolation(Math.toRadians(90)).build();
  }
  void autonomousUpdate() {
    switch (pathState) {
      case 0:
        follower.followPath(paths.Score, 0.8, true);
        setState(1);
        break;
    }
  }
  void importantRoutine() { subsystem.toString(); }
}
`);

try {
  const actions = discoverRobotActions(project);
  assert.equal(actions.length, 3);
  assert.deepEqual(actions.map((action) => action.source.category), ["automations", "subsystems", "subsystems"]);
  const spin = actions.find((action) => action.javaMethod === "spin");
  assert.ok(spin);
  assert.equal(spin.source.group, "shooting");
  assert.equal(spin.javaCall, "intake.spin({power}, {reverse});");
  assert.deepEqual(spin.parameters, [
    { name: "power", defaultValue: "0" },
    { name: "reverse", defaultValue: "false" },
  ]);
  assert.ok(!actions.some((action) => action.javaMethod === "hidden" || action.javaMethod === "loop" || action.javaMethod === "isBusy"));

  const result = await openAutonomousStudio({ projectPath: project, port: 0, openBrowser: false });
  const url = result.match(/http:\/\/127\.0\.0\.1:\d+\/visualizer\//)?.[0];
  assert.ok(url);
  const payload = await fetch(new URL("/studio-data.json", url)).then((response) => response.json());
  assert.equal(payload.projectPath, project);
  assert.equal(payload.actions.length, 3);
  assert.match(result, /not published online/);

  await closeAutonomousStudio();
  const sourceFile = "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/PreservedAuto.java";
  const sourceResult = await openAutonomousStudio({ projectPath: project, sourceFile, port: 0, openBrowser: false });
  const sourceUrl = sourceResult.match(/http:\/\/127\.0\.0\.1:\d+\/visualizer\//)?.[0];
  assert.ok(sourceUrl);
  const sourcePayload = await fetch(new URL("/studio-data.json", sourceUrl)).then((response) => response.json());
  assert.equal(sourcePayload.sourceExport.mode, "preserve");
  sourcePayload.spec.startPose = { x: 11, y: 21, headingDegrees: 91 };
  sourcePayload.spec.paths[0].startPoint = { x: 11, y: 21 };
  const generationResponse = await fetch(new URL("/generate-java", sourceUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sourcePayload.spec),
  });
  assert.equal(generationResponse.status, 200);
  const generated = await generationResponse.json();
  assert.match(generated.java, /private final Object subsystem = new Object\(\);/);
  assert.match(generated.java, /follower\.followPath\(paths\.Score, 0\.8, true\);/);
  assert.match(generated.java, /void importantRoutine\(\) \{ subsystem\.toString\(\); \}/);
  assert.match(generated.java, /setStartingPose\(new Pose\(11, 21, Math\.toRadians\(91\)\)\)/);
  const draft = JSON.parse(getAutonomousStudioDraft());
  assert.equal(draft.sourceFile, sourceFile);
  assert.equal(draft.studioSpec.startPose.x, 11);
  assert.match(draft.originalJava, /importantRoutine/);
  console.log("local studio discovery and server test passed");
} finally {
  await closeAutonomousStudio();
  rmSync(project, { recursive: true, force: true });
}
