import assert from "node:assert/strict";
import { extractAutonomous } from "../dist/autonomous.js";

const java = `
package org.firstinspires.ftc.teamcode;
@Autonomous(name = "Decode Auto", group = "Auto")
public class DecodeAuto extends OpMode {
  public static long SETTLE_MS = 250;
  void initPaths() {
    follower.setStartingPose(new Pose(144 - 120, 120, Math.toRadians(180)));
    Score = follower.pathBuilder().addPath(
      new BezierCurve(new Pose(24, 120), new Pose(40, 100), new Pose(60, 80))
    ).setLinearHeadingInterpolation(Math.toRadians(180), Math.toRadians(90)).build();
    Return = follower.pathBuilder().addPath(
      new BezierLine(new Pose(60, 80), new Pose(24, 120))
    ).setTangentHeadingInterpolation().setReversed().build();
  }
  void autonomousUpdate() {
    switch (pathState) {
      case 0:
        follower.followPath(paths.Score);
        setState(1);
        break;
      case 1:
        if (!follower.isBusy() && settleTimer.milliseconds() > SETTLE_MS) {
          spinIntake();
          follower.followPath(paths.Return);
          setState(2);
        }
        break;
    }
  }
}`;

const imported = extractAutonomous(java, "DecodeAuto.java");
assert.equal(imported.className, "DecodeAuto");
assert.equal(imported.pathCount, 2);
assert.equal(imported.actionCount, 1);
assert.equal(imported.visualizer.lines.length, 2);
assert.equal(imported.visualizer.pathChains.length, 2);
assert.deepEqual(imported.visualizer.startPoint, { x: 24, y: 120, heading: "constant", degrees: 180 });
assert.deepEqual(imported.visualizer.lines[0].endPoint, { x: 60, y: 80, heading: "linear", startDeg: 180, endDeg: 90 });
assert.ok(imported.spec.steps.some((step) => step.type === "action" && step.action === "spinIntake"));
assert.ok(!imported.spec.steps.some((step) => step.type === "action" && step.action === "if"));
assert.ok(imported.spec.steps.some((step) => step.type === "wait" && step.durationMs === 250));
assert.ok(imported.visualizer.sequence.some((step) => step.kind === "wait" && step.durationMs === 250));

console.log("auto importer test passed");
