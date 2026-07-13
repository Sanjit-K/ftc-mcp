# Real Robot Test Policy

Automated tests catch regressions, but they cannot prove that generated code installs, starts, and behaves correctly on FTC hardware. Any pull request that can affect robot-facing behavior must be tested with a real Robot Controller before it is merged.

## When hardware testing is required

Real-hardware verification is required for changes involving:

- generated Java, OpModes, subsystems, TeleOp, or Pedro Pathing;
- Gradle builds or APK discovery;
- ADB device selection, install, restart, status, or log collection;
- direct USB deployment;
- automatic macOS or Windows Wi-Fi switching;
- project inspection that depends on a real FTC SDK project; or
- any behavior that could move hardware, change robot code, or affect connectivity.

Documentation-only, website-only, issue-template, and other non-runtime changes are exempt. The pull request must state why hardware testing does not apply.

If a contributor does not have access to a robot, they may open a draft pull request with automated results. It must remain unmerged until a maintainer or another contributor records the required real-hardware test.

## Minimum test procedure

Use a safe test robot or bench setup, not a robot queued for a match.

1. Start from the pull request commit and record the FTC Toolchain commit, operating system, Node version, FTC SDK version, and connection method.
2. Run `npm test`.
3. Run `inspect_project` against the FTC project used for the test.
4. Exercise the changed behavior with the smallest safe setup.
5. For generated code, build the resulting TeamCode with Gradle.
6. For deployment changes, install on a real Robot Controller and confirm the app restarts successfully.
7. For Wi-Fi switching, confirm the computer joins the saved Control Hub network and restores the original internet network after both success and a safe induced failure.
8. Confirm `robot_status` or relevant `robot_logs` output after deployment.
9. Record the result in the pull request without posting Wi-Fi passwords, team credentials, student information, or unrelated robot logs.

Motor and servo tests must begin with mechanisms unloaded or physically restrained where appropriate. Keep an emergency-stop path available. Follow the current FTC game manual and venue rules; never perform development network switching or deployment during an official match.

## Required pull-request evidence

The pull request must include:

- tester name or GitHub handle;
- date;
- Control Hub or Robot Controller type;
- operating system and USB or Wi-Fi connection path;
- FTC SDK version;
- exact test steps;
- observed result;
- relevant sanitized logs; and
- any behavior that was not tested.

“Tests pass,” emulator-only testing, mocks, or an automated Gradle build do not count as real-robot verification.
