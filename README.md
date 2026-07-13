# FTC Toolchain

<img src="website/public/logo.svg" alt="FTC Toolchain logo" width="72" height="72" />

An [MCP](https://modelcontextprotocol.io) server that lets AI agents (Codex, Claude Code, Claude Desktop, or any MCP client) work on **FTC robots**: search official SDK samples and Pedro Pathing docs, scaffold OpModes, build TeamCode with Gradle, deploy to a REV Control Hub over WiFi, and read robot logs — the full code → robot → debug loop.

## Install

Requirements: Node 18+, `git`, `adb` (Android platform-tools), and the Android SDK + JDK 17+ if you want to build (an Android Studio install provides both).

### Codex

```bash
# Register the server (available in every project)
codex mcp add ftc-toolchain -- npx -y ftc-toolchain

# Fetch the reference material the knowledge tools read (one time)
npx ftc-toolchain setup
```

Start a new Codex task and ask it to “list the FTC sample OpModes” to confirm the server is live.

### Claude Code

```bash
# Register the server (available in every project)
claude mcp add ftc-toolchain -- npx -y ftc-toolchain

# Fetch the reference material the knowledge tools read (one time)
npx ftc-toolchain setup
```

Start a new Claude session and ask it to “list the FTC sample OpModes” to confirm it is live.

### Claude Desktop / other MCP clients

```json
{
  "mcpServers": {
    "ftc-toolchain": {
      "command": "npx",
      "args": ["-y", "ftc-toolchain"],
      "env": { "FTC_TOOLCHAIN_PROJECT_DIR": "/path/to/your/FtcRobotController" }
    }
  }
}
```

Then run `npx ftc-toolchain setup` once so the knowledge tools have their reference data.

### From source (development)

```bash
git clone https://github.com/Sanjit-K/ftc-toolchain && cd ftc-toolchain
npm install && npm run build
npm run setup      # clones FTC samples + Pedro docs into refs/
```

Opening this directory in Claude Code picks up [.mcp.json](.mcp.json) automatically.

> **Reference material:** the knowledge tools (`list_samples`, `search_docs`, …) read the official
> FtcRobotController samples and Pedro Pathing docs. `ftc-toolchain setup` clones them into `~/.ftc-toolchain/refs`
> (override with `FTC_TOOLCHAIN_REFS`). The project/robot tools work without this step.

## Choose how to deploy

Use `deploy_robot` as the normal high-level deployment tool. It supports two connection methods.

### Option 1: direct USB-C

Use this when the programming computer is near the robot. Connect the Control Hub or Robot Controller phone by USB, approve any device prompt, and verify it appears in `adb_devices`. Then ask:

```text
deploy_robot(connection: "usb")
```

ftc-toolchain builds a fresh APK, installs it on the attached ADB device, and restarts Robot Controller. If more than one Android device is attached, pass the `serial` shown by `adb_devices`. Internet stays connected throughout the deployment.

### Option 2: automatic Wi-Fi switching

No phone tether or extra router is required. ftc-toolchain can build while the computer is on internet Wi-Fi, return a job ID to Codex or Claude, then run the network-sensitive part as a local background job:

1. Switch to the saved Control Hub Wi-Fi.
2. Connect to `192.168.43.1:5555` with ADB.
3. Install the freshly built APK and restart Robot Controller.
4. Restore the original internet Wi-Fi even when deployment fails.
5. Let the AI read the saved result after it reconnects.

Before the first automatic deployment, manually join the Control Hub once so macOS or Windows saves its SSID and password. Return to internet Wi-Fi, then ask the AI to call:

```text
deploy_robot(connection: "wifi-switch", robotSsid: "YOUR-CONTROL-HUB-SSID")
```

The tool builds before disconnecting and waits 10 seconds before changing networks, giving the MCP response time to reach the AI. The AI connection may pause for roughly 20–60 seconds. Once it returns, call `wifi_deploy_status` with the returned job ID—or omit the ID to read the latest job.

Use `dryRun: true` to preview every path and network involved without building, switching Wi-Fi, or deploying. Both macOS and Windows are supported. On Windows, the Control Hub must appear as a saved `netsh wlan` profile. On macOS, it must be a remembered Wi-Fi network available to `networksetup`.

This is for development and pits only. Disconnect programming computers before a match and follow the current FTC competition manual.

## Tools

Start a new session with `inspect_project`. It reports which FTC project is selected, Git changes, OpModes, documented subsystems, Pedro readiness, hardware-name collisions, the latest APK, reference data, and Android SDK setup—plus the next concrete actions.

**Knowledge**

| Tool | What it does |
|---|---|
| `list_samples` | List the 66 official FTC sample OpModes (drive, sensors, AprilTag vision, ...) |
| `get_sample` | Full Java source of a sample |
| `search_docs` | Keyword search across Pedro Pathing docs + SDK samples |
| `get_doc` | Fetch a Pedro Pathing doc page as markdown |
| `reference_status` | Show local reference counts, commits, branches, dates, and cache location |
| `update_references` | Fast-forward clean FTC SDK and Pedro documentation checkouts |

**Project**

| Tool | What it does |
|---|---|
| `inspect_project` | One-shot readiness check for project path, SDK, Git, OpModes, subsystem docs, Pedro, hardware names, APK, references, and Android tooling |
| `check_project_hygiene` | Read-only pre-competition audit for duplicate names, orphaned files, broken docs, stale builds, TODOs, and Git state |
| `create_project` | Clone a fresh FtcRobotController SDK project |
| `list_opmodes` | List `@TeleOp`/`@Autonomous` classes in TeamCode |
| `list_generated_files` | Inventory files scaffolded by ftc-toolchain, grouped by artifact type |
| `list_backups` | Browse project-scoped recovery snapshots made before overwrites |
| `restore_backup` | Preview or restore selected backup files; confirmed restores back up current versions first |
| `create_opmode` | Scaffold an OpMode: `linear-teleop`, `mecanum-teleop`, `linear-auto`, `pedro-auto`, `pedro-teleop` |
| `install_pedro` | Add Pedro Pathing to a project (Gradle deps, compileSdk 34, `Constants.java` scaffold) |
| `refactor_auto_for_visualizer` | Import an existing Pedro Java auto into an editable `.ftcauto.json` timeline plus a `.pp` file that opens in Pedro Visualizer; paths, waits, and robot actions are extracted conservatively |
| `open_autonomous_studio` | Start the rich autonomous editor on `127.0.0.1`, optionally load an existing Java auto, and import public commands from local subsystem and automation folders |
| `get_autonomous_studio_draft` | Give the agent the live Studio spec together with the original Java so it can integrate structural edits without replacing custom robot logic |

For an existing autonomous, run `refactor_auto_for_visualizer` with its Java path. The generated `.pp` contains the geometry and waits supported by today's Pedro Visualizer. The matching `.ftcauto.json` preserves the complete path/action timeline—such as `spinIntake`, shoot, transfer, and other robot-specific routines—for human review and future code generation. Any expression or transition the importer cannot prove is listed as a review warning instead of being silently changed.

### Local Autonomous Studio

Ask the agent to call `open_autonomous_studio`, or start it directly:

```bash
npx ftc-toolchain studio ~/FtcRobotController
# Load an existing auto at startup:
npx ftc-toolchain studio ~/FtcRobotController \
  --source=TeamCode/src/main/java/org/firstinspires/ftc/teamcode/DecodeAuto.java
```

The studio binds only to `127.0.0.1` and stops with the FTC Toolchain process. It is bundled in the npm package and does not use a hosted web service. Its action library scans Java files under `subsystems/` and `automations/` (plus ftc-toolchain-generated subsystem classes), imports each public `void` method, preserves method parameters as editable action inputs, and groups commands by folder and class. Paths, actions, waits, and timeline order remain editable without an LLM.

When Studio opens an existing Java autonomous, **Update Java safely** patches its starting pose and path builders inside the original class. It preserves imports, annotations, subsystem fields and constructors, `init`/`start`/`loop` behavior, state-machine conditions, helper routines, and custom `followPath` arguments. Timeline changes and added/removed paths require context-aware changes in several parts of the class, so Studio refuses to emit a misleading replacement shell. Ask the agent to call `get_autonomous_studio_draft`; it receives the live visual spec and original source together and can integrate the change without discarding robot code.

**Subsystems** — the recommended way to structure robot code: one plain class per mechanism, with a living markdown knowledge base the LLM reads and updates.

All code generators support `dryRun: true`. This performs the same validation and returns the exact target paths and generated source without touching the filesystem. Use it to review a proposed OpMode, subsystem, calculation helper, or TeleOp before creation or overwrite.

When `overwrite: true` replaces an existing generated target, ftc-toolchain first copies the old version to `~/.ftc-toolchain/backups` (or `$FTC_TOOLCHAIN_HOME/backups`). The backup stays outside the robot repository. `list_generated_files` inventories marked scaffolds, but the marker only records origin—team edits are expected and must be preserved.

Use `list_backups` to find a snapshot and `restore_backup` to inspect it. Restore is preview-only unless `confirm: true`; before a confirmed rollback, the files currently in the project are backed up again, so recovery is reversible.

| Tool | What it does |
|---|---|
| `create_subsystem` | Scaffold a subsystem class (hardcoded config-name constants, action methods, `stop()`) with optional injected subsystem dependencies and dashboard-tunable constants, + a bench-test TeleOp + a markdown doc |
| `document_subsystem` | Write/update a subsystem's knowledge-base doc (functions, tuning, config names, quirks) |
| `list_subsystems` / `get_subsystem` | Read the robot's architecture from `docs/` |
| `create_teleop` | Generate a TeleOp **plus a separate `<Name>Controls.java`** holding only the button bindings, wiring drive + subsystem actions + automations |
| `create_calculation` | Scaffold a stateless helper class (e.g. live trajectory math) |
| `hardware_manifest` | Aggregate every config name across subsystems and flag duplicates/typos vs. the Driver Station config |
| `validate_hardware` | Pre-flight config check for incompatible device types, shared names, and unresolved constants |

**Robot**

| Tool | What it does |
|---|---|
| `deploy_robot` | Preferred deployment tool: choose direct USB for an attached ADB device or automatic Wi-Fi switching for a saved Control Hub network |
| `wifi_deploy_start` | Lower-level Wi-Fi path: build while online, then launch a local macOS/Windows job that switches networks, deploys, and restores the original Wi-Fi |
| `wifi_deploy_status` | Read the latest or selected background deployment state and its complete switch/deploy/recovery timeline after internet reconnects |
| `adb_devices` / `adb_connect` | Find / connect to the robot (Control Hub default: `192.168.43.1:5555`) |
| `robot_status` | Read device identity, Android/RC app versions, battery service, and storage health |
| `restart_robot_controller` | Restart the RC app without rebuilding or reinstalling code |
| `build` | Gradle build with optional clean/timeout/stacktrace controls, contextual errors, and verified APK metadata |
| `deploy` | Install the APK and restart the Robot Controller app |
| `build_and_deploy` | Build first (optionally clean), verify the APK, then install only that successful artifact |
| `clear_robot_logs` | Clear logcat before reproducing a problem for a clean debugging capture |
| `robot_logs` | Filtered logcat from the robot (crashes, OpMode exceptions, SDK events) |

## Typical agent session

1. `search_docs("mecanum field centric")` / `get_sample(...)` → find reference code
2. `create_opmode(className: "CompTeleOp", template: "mecanum-teleop")`
3. `deploy_robot(connection: "usb")` nearby, or `deploy_robot(connection: "wifi-switch", robotSsid: "YOUR-CONTROL-HUB-SSID")` wirelessly
4. Fix any compiler errors returned before a background Wi-Fi switch begins
5. Driver tests the OpMode → reconnect with `adb_connect` when needed, then use `robot_logs(filter: "CompTeleOp")`

## Subsystem workflow

The intended way to build a robot: describe each mechanism to the LLM and let it scaffold subsystems + maintain their docs.

1. *"We have a rolling intake — one motor, spins in, spits out."* →
   `create_subsystem(name: "RollingIntake", group: "intake", motors: [{name: "intakeMotor", config: "intake"}], methods: ["spinIn", "spitOut"])`
   → writes `RollingIntake.java`, `TestRollingIntake.java` (bench test), and `docs/subsystems/RollingIntake.md`.
2. Fill in the method bodies (the LLM can, using `get_sample`/`search_docs` for reference).
3. `document_subsystem` to record tuning values, sensor thresholds, and quirks as you dial them in.
4. `hardware_manifest` before a competition to confirm every config name in code matches the Driver Station configuration — and that two subsystems aren't fighting over one name.
5. A future session runs `list_subsystems` / `get_subsystem` and instantly knows the robot.

Sub-subsystems live under a shared group, e.g. `group: "shooting.turret"` → `teamcode/shooting/turret/`. Calculation-heavy logic goes in `create_calculation` helpers so it stays out of the subsystem and OpMode files.

**Subsystem composition & tuning.** A subsystem can depend on other subsystems — `dependencies: [{type: "ColorSensor"}, {type: "IntakeFlap"}]` injects them into the constructor (config names stay hardcoded, so the constructor only receives siblings). Declare `constants` (PID gains, servo positions, RPM setpoints) and the tunable ones become live-editable dashboard fields: the class is annotated `@Configurable` (Panels, from `install_pedro`) with `public static` fields, so you tune them while the robot runs. Pass `dashboard: "ftcdashboard"` for FTC Dashboard's `@Config`, or `"none"`.

### Building a TeleOp

Describe how driving should feel and what should be automated; `create_teleop` writes **two files**:

- **`<Name>Controls.java`** — nothing but the bindings (`intakeIn` → `driver.right_bumper`). A driver can open this and remap buttons without reading any robot logic or touching an LLM.
- **`<Name>.java`** — the TeleOp: constructs the subsystems, wires the drivetrain, applies each binding, and stubs out the automations you described.

*"Mecanum drive, hold right bumper to intake / left bumper to outtake, operator Y toggles the shooter, left trigger is slow mode, and auto-sort balls by color."* becomes one `create_teleop` call. Bindings are `hold` (while held), `press` (rising edge), or `toggle`. Competing actions on one mechanism (intake in vs. out) share an `exclusiveGroup` so they compile to a single if/else-if/else with one idle call — no fighting over the motor. Automations (multi-step or sensor-driven) come out as clearly-marked stub methods to fill in.

## Configuration

| Env var | Meaning |
|---|---|
| `FTC_TOOLCHAIN_PROJECT_DIR` | Default FTC SDK project used by project/robot tools |
| `FTC_TOOLCHAIN_PROJECT_DIR` | Default FtcRobotController project location |
| `FTC_TOOLCHAIN_REFS` | Location of the reference clones (default: `./refs`) |
| `FTC_TOOLCHAIN_HOME` | Toolchain cache, backups, jobs, and workspace root (default: `~/.ftc-toolchain`) |
| `ADB_PATH` | Explicit path to `adb` if not on PATH |

## Notes

- **Pedro Pathing constants must be tuned.** `install_pedro` scaffolds `Constants.java` with placeholder values for a mecanum drivetrain + goBILDA Pinpoint localizer; run the tuning OpModes (see `search_docs "tuning"`) before trusting any path.
- The Control Hub's WiFi password and SSID are shown on the Driver Station under *Program & Manage*.
- Deploying replaces the Robot Controller app's code but keeps robot configurations. If `adb install` reports a signature mismatch, one `adb uninstall com.qualcomm.ftcrobotcontroller` is needed (this clears configs).

## Development

```bash
npm test            # build + MCP smoke test (no robot needed)
npx ftc-toolchain doctor [projectPath] # diagnose local project/tooling readiness
npx ftc-toolchain setup --update       # refresh cached FTC samples and Pedro docs
node scripts/test-build.mjs [projectPath]           # real Gradle build through the build tool
node scripts/test-pedro-build.mjs [projectPath]     # install_pedro + all templates + full build
node scripts/test-subsystem-build.mjs [projectPath] # scaffold intake/spindexer/turret subsystems + a full TeleOp + build
```

## Website and docs

The open-source marketing site and documentation live in [`website/`](website/). It is a Next.js/vinext app with the landing page at `/` and quickstart documentation at `/docs`.

```bash
cd website
npm install
npm run dev
```

The website content brief is versioned in [`website.md`](website.md).

## Contributing and community

Contributions from FTC students, mentors, alumni, and developers are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, use the repository's guided issue forms for bugs and proposals, and see [SUPPORT.md](SUPPORT.md) for setup help. Robot-facing pull requests must follow the [real robot test policy](HARDWARE_TESTING.md) before merge; automated or mock-only testing is not sufficient.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md), never in a public issue.
