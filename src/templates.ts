/**
 * Java OpMode templates. Kept in sync with:
 *  - FtcRobotController external samples (mecanum drive layout)
 *  - Pedro Pathing v2 docs (pathing/examples/{auto,teleop,constants})
 */

export interface TemplateArgs {
  packageName: string;
  className: string;
  opModeName: string;
  group: string;
}

export const TEMPLATE_IDS = [
  "linear-teleop",
  "mecanum-teleop",
  "linear-auto",
  "pedro-auto",
  "pedro-teleop",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TEMPLATE_DESCRIPTIONS: Record<TemplateId, string> = {
  "linear-teleop": "Minimal LinearOpMode TeleOp skeleton (hardware mapping left to you)",
  "mecanum-teleop":
    "Complete 4-motor mecanum/omni TeleOp with POV drive (based on BasicOmniOpMode). Hardware names: left_front_drive, left_back_drive, right_front_drive, right_back_drive",
  "linear-auto": "Minimal LinearOpMode Autonomous skeleton with elapsed-time guard",
  "pedro-auto":
    "Pedro Pathing autonomous using a finite state machine over PathChains. Requires install_pedro first; tune poses for your season",
  "pedro-teleop":
    "Pedro Pathing TeleOp: manual mecanum drive with on-demand automated path following and slow mode. Requires install_pedro first",
};

function linearTeleop(a: TemplateArgs): string {
  return `package ${a.packageName};

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;

@TeleOp(name = "${a.opModeName}", group = "${a.group}")
public class ${a.className} extends LinearOpMode {

    private final ElapsedTime runtime = new ElapsedTime();

    @Override
    public void runOpMode() {
        // Map hardware here. Names must match the robot configuration on the Driver Station.
        // DcMotor motor = hardwareMap.get(DcMotor.class, "motor_name");

        telemetry.addData("Status", "Initialized");
        telemetry.update();

        waitForStart();
        runtime.reset();

        while (opModeIsActive()) {
            // Read gamepad1 / gamepad2 and command hardware here.

            telemetry.addData("Status", "Run Time: " + runtime.toString());
            telemetry.update();
        }
    }
}
`;
}

function mecanumTeleop(a: TemplateArgs): string {
  return `package ${a.packageName};

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;

/*
 * POV-drive mecanum TeleOp for a 4-motor holonomic drivetrain.
 * Left stick = translate, right stick X = rotate.
 * Motor directions assume a standard mecanum X roller pattern; if the robot
 * drives backward when you push the left stick forward, flip all four directions.
 */
@TeleOp(name = "${a.opModeName}", group = "${a.group}")
public class ${a.className} extends LinearOpMode {

    private final ElapsedTime runtime = new ElapsedTime();

    @Override
    public void runOpMode() {
        DcMotor leftFrontDrive = hardwareMap.get(DcMotor.class, "left_front_drive");
        DcMotor leftBackDrive = hardwareMap.get(DcMotor.class, "left_back_drive");
        DcMotor rightFrontDrive = hardwareMap.get(DcMotor.class, "right_front_drive");
        DcMotor rightBackDrive = hardwareMap.get(DcMotor.class, "right_back_drive");

        leftFrontDrive.setDirection(DcMotor.Direction.REVERSE);
        leftBackDrive.setDirection(DcMotor.Direction.REVERSE);
        rightFrontDrive.setDirection(DcMotor.Direction.FORWARD);
        rightBackDrive.setDirection(DcMotor.Direction.FORWARD);

        telemetry.addData("Status", "Initialized");
        telemetry.update();

        waitForStart();
        runtime.reset();

        while (opModeIsActive()) {
            double axial = -gamepad1.left_stick_y; // forward is negative on the stick
            double lateral = gamepad1.left_stick_x;
            double yaw = gamepad1.right_stick_x;

            double leftFrontPower = axial + lateral + yaw;
            double rightFrontPower = axial - lateral - yaw;
            double leftBackPower = axial - lateral + yaw;
            double rightBackPower = axial + lateral - yaw;

            // Normalize so no wheel power exceeds 1.0
            double max = Math.max(Math.abs(leftFrontPower), Math.abs(rightFrontPower));
            max = Math.max(max, Math.abs(leftBackPower));
            max = Math.max(max, Math.abs(rightBackPower));
            if (max > 1.0) {
                leftFrontPower /= max;
                rightFrontPower /= max;
                leftBackPower /= max;
                rightBackPower /= max;
            }

            leftFrontDrive.setPower(leftFrontPower);
            rightFrontDrive.setPower(rightFrontPower);
            leftBackDrive.setPower(leftBackPower);
            rightBackDrive.setPower(rightBackPower);

            telemetry.addData("Status", "Run Time: " + runtime.toString());
            telemetry.addData("Front left/right", "%4.2f, %4.2f", leftFrontPower, rightFrontPower);
            telemetry.addData("Back  left/right", "%4.2f, %4.2f", leftBackPower, rightBackPower);
            telemetry.update();
        }
    }
}
`;
}

function linearAuto(a: TemplateArgs): string {
  return `package ${a.packageName};

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.util.ElapsedTime;

@Autonomous(name = "${a.opModeName}", group = "${a.group}")
public class ${a.className} extends LinearOpMode {

    private final ElapsedTime runtime = new ElapsedTime();

    @Override
    public void runOpMode() {
        // Map hardware here.

        telemetry.addData("Status", "Initialized");
        telemetry.update();

        waitForStart();
        runtime.reset();

        // Autonomous sequence goes here. Always guard loops with opModeIsActive().
        while (opModeIsActive() && runtime.seconds() < 30.0) {
            telemetry.addData("Elapsed", "%.1f s", runtime.seconds());
            telemetry.update();
        }
    }
}
`;
}

function pedroAuto(a: TemplateArgs): string {
  return `package ${a.packageName};

import com.pedropathing.follower.Follower;
import com.pedropathing.geometry.BezierLine;
import com.pedropathing.geometry.Pose;
import com.pedropathing.paths.PathChain;
import com.pedropathing.util.Timer;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

import org.firstinspires.ftc.teamcode.pedroPathing.Constants;

/*
 * Pedro Pathing autonomous driven by a finite state machine.
 * Field coordinates: 144x144 inches, (0,0) at the bottom-left corner,
 * heading in radians. Replace the poses below with ones for your routine
 * (the Pedro visualizer at https://visualizer.pedropathing.com helps).
 */
@Autonomous(name = "${a.opModeName}", group = "${a.group}")
public class ${a.className} extends LinearOpMode {

    private Follower follower;
    private Timer pathTimer;
    private int pathState;

    // TODO: replace with your real poses
    private final Pose startPose = new Pose(9, 72, Math.toRadians(0));
    private final Pose scorePose = new Pose(36, 72, Math.toRadians(0));
    private final Pose parkPose = new Pose(36, 36, Math.toRadians(90));

    private PathChain driveToScore, park;

    private void buildPaths() {
        driveToScore = follower.pathBuilder()
                .addPath(new BezierLine(startPose, scorePose))
                .setLinearHeadingInterpolation(startPose.getHeading(), scorePose.getHeading())
                .build();

        park = follower.pathBuilder()
                .addPath(new BezierLine(scorePose, parkPose))
                .setLinearHeadingInterpolation(scorePose.getHeading(), parkPose.getHeading())
                .build();
    }

    private void autonomousPathUpdate() {
        switch (pathState) {
            case 0:
                follower.followPath(driveToScore);
                setPathState(1);
                break;
            case 1:
                if (!follower.isBusy()) {
                    // TODO: score here (mechanism commands), then park.
                    follower.followPath(park, true);
                    setPathState(2);
                }
                break;
            case 2:
                if (!follower.isBusy()) {
                    setPathState(-1); // done
                }
                break;
        }
    }

    private void setPathState(int state) {
        pathState = state;
        pathTimer.resetTimer();
    }

    @Override
    public void runOpMode() {
        pathTimer = new Timer();
        follower = Constants.createFollower(hardwareMap);
        buildPaths();
        follower.setStartingPose(startPose);

        telemetry.addData("Status", "Initialized");
        telemetry.update();

        waitForStart();
        setPathState(0);

        while (opModeIsActive()) {
            follower.update();
            autonomousPathUpdate();

            telemetry.addData("path state", pathState);
            telemetry.addData("x", follower.getPose().getX());
            telemetry.addData("y", follower.getPose().getY());
            telemetry.addData("heading", follower.getPose().getHeading());
            telemetry.update();
        }
    }
}
`;
}

function pedroTeleop(a: TemplateArgs): string {
  return `package ${a.packageName};

import com.pedropathing.follower.Follower;
import com.pedropathing.geometry.BezierLine;
import com.pedropathing.geometry.Pose;
import com.pedropathing.paths.HeadingInterpolator;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.PathChain;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.teamcode.pedroPathing.Constants;

import java.util.function.Supplier;

/*
 * Pedro Pathing TeleOp: manual drive with optional automated path following.
 *   gamepad1 A            -> follow path to the target pose
 *   gamepad1 B            -> cancel automated drive
 *   gamepad1 right bumper -> toggle slow mode
 */
@TeleOp(name = "${a.opModeName}", group = "${a.group}")
public class ${a.className} extends OpMode {

    private Follower follower;
    public static Pose startingPose; // set by your auto via this static field, if desired
    private boolean automatedDrive;
    private Supplier<PathChain> pathChain;
    private boolean slowMode = false;
    private static final double SLOW_MODE_MULTIPLIER = 0.5;

    // TODO: replace with a useful TeleOp target (e.g. your scoring position)
    private final Pose targetPose = new Pose(54, 94, Math.toRadians(135));

    @Override
    public void init() {
        follower = Constants.createFollower(hardwareMap);
        follower.setStartingPose(startingPose == null ? new Pose() : startingPose);
        follower.update();

        // Lazy path generation: built from the live robot pose when requested.
        pathChain = () -> follower.pathBuilder()
                .addPath(new Path(new BezierLine(follower::getPose, targetPose)))
                .setHeadingInterpolation(
                        HeadingInterpolator.linearFromPoint(
                                follower::getHeading, targetPose.getHeading(), 0.8))
                .build();
    }

    @Override
    public void start() {
        follower.startTeleopDrive();
    }

    @Override
    public void loop() {
        follower.update();

        if (!automatedDrive) {
            double scale = slowMode ? SLOW_MODE_MULTIPLIER : 1.0;
            follower.setTeleOpDrive(
                    -gamepad1.left_stick_y * scale,
                    -gamepad1.left_stick_x * scale,
                    -gamepad1.right_stick_x * scale,
                    true // robot-centric; false for field-centric
            );
        }

        if (gamepad1.aWasPressed()) {
            follower.followPath(pathChain.get());
            automatedDrive = true;
        }

        if (automatedDrive && (gamepad1.bWasPressed() || !follower.isBusy())) {
            follower.startTeleopDrive();
            automatedDrive = false;
        }

        if (gamepad1.rightBumperWasPressed()) {
            slowMode = !slowMode;
        }

        telemetry.addData("x", follower.getPose().getX());
        telemetry.addData("y", follower.getPose().getY());
        telemetry.addData("heading", follower.getPose().getHeading());
        telemetry.addData("automatedDrive", automatedDrive);
        telemetry.addData("slowMode", slowMode);
        telemetry.update();
    }
}
`;
}

export function renderTemplate(id: TemplateId, args: TemplateArgs): string {
  let source: string;
  switch (id) {
    case "linear-teleop":
      source = linearTeleop(args);
      break;
    case "mecanum-teleop":
      source = mecanumTeleop(args);
      break;
    case "linear-auto":
      source = linearAuto(args);
      break;
    case "pedro-auto":
      source = pedroAuto(args);
      break;
    case "pedro-teleop":
      source = pedroTeleop(args);
      break;
  }
  return `// @ftc-toolchain generated: opmode — scaffolded; team edits expected\n${source}`;
}

/**
 * Pedro Pathing Constants scaffold (pedroPathing/Constants.java).
 * Every numeric value below is robot-specific and must be tuned; see the
 * pathing/tuning docs. Defaults assume mecanum drive + goBILDA Pinpoint.
 */
export function pedroConstants(packageName: string): string {
  return `// @ftc-toolchain generated: pedro-constants — scaffolded; tune every value\npackage ${packageName};

import com.pedropathing.control.FilteredPIDFCoefficients;
import com.pedropathing.control.PIDFCoefficients;
import com.pedropathing.follower.Follower;
import com.pedropathing.follower.FollowerConstants;
import com.pedropathing.ftc.FollowerBuilder;
import com.pedropathing.ftc.drivetrains.MecanumConstants;
import com.pedropathing.ftc.localization.constants.PinpointConstants;
import com.pedropathing.paths.PathConstraints;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;

/*
 * Pedro Pathing constants. EVERY value here is robot-specific:
 * run the tuning OpModes and follow https://pedropathing.com/docs/pathing/tuning
 * before trusting any path. This scaffold assumes a mecanum drivetrain with a
 * goBILDA Pinpoint localizer; swap the localizer/drivetrain builder calls if
 * your robot differs (see docs: pathing/tuning/localization).
 */
public class Constants {

    public static FollowerConstants followerConstants = new FollowerConstants()
            .mass(13.0) // TODO: robot mass in kg
            .forwardZeroPowerAcceleration(-34.0) // TODO: from Forward Zero Power Acceleration tuner
            .lateralZeroPowerAcceleration(-78.0) // TODO: from Lateral Zero Power Acceleration tuner
            .translationalPIDFCoefficients(new PIDFCoefficients(0.1, 0, 0.01, 0.015))
            .headingPIDFCoefficients(new PIDFCoefficients(1.0, 0, 0.05, 0.01))
            .drivePIDFCoefficients(new FilteredPIDFCoefficients(0.025, 0, 0.00001, 0.6, 0.01))
            .centripetalScaling(0.0005);

    public static MecanumConstants driveConstants = new MecanumConstants()
            .leftFrontMotorName("left_front_drive")   // TODO: match robot configuration
            .leftRearMotorName("left_back_drive")
            .rightFrontMotorName("right_front_drive")
            .rightRearMotorName("right_back_drive")
            .leftFrontMotorDirection(DcMotorSimple.Direction.REVERSE)
            .leftRearMotorDirection(DcMotorSimple.Direction.REVERSE)
            .rightFrontMotorDirection(DcMotorSimple.Direction.FORWARD)
            .rightRearMotorDirection(DcMotorSimple.Direction.FORWARD)
            .xVelocity(57.8)  // TODO: from Forward Velocity tuner
            .yVelocity(52.3); // TODO: from Strafe Velocity tuner

    public static PinpointConstants localizerConstants = new PinpointConstants()
            .forwardPodY(1.0)  // TODO: pod offsets in inches
            .strafePodX(-2.5)
            .forwardEncoderDirection(GoBildaPinpointDriver.EncoderDirection.FORWARD)
            .strafeEncoderDirection(GoBildaPinpointDriver.EncoderDirection.FORWARD);

    public static PathConstraints pathConstraints = new PathConstraints(
            0.995, 0.1, 0.1, 0.009, 50, 1.25, 10, 1);

    public static Follower createFollower(HardwareMap hardwareMap) {
        return new FollowerBuilder(followerConstants, hardwareMap)
                .mecanumDrivetrain(driveConstants)
                .pinpointLocalizer(localizerConstants)
                .pathConstraints(pathConstraints)
                .build();
    }
}
`;
}
