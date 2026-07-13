import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAutonomousStudio, discoverRobotActions, openAutonomousStudio } from "../dist/studio.js";

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
  console.log("local studio discovery and server test passed");
} finally {
  await closeAutonomousStudio();
  rmSync(project, { recursive: true, force: true });
}
