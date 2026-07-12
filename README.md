# ftc-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI agents (Claude Code, Claude Desktop, or any MCP client) work on **FTC robots**: search official SDK samples and Pedro Pathing docs, scaffold OpModes, build TeamCode with Gradle, deploy to a REV Control Hub over WiFi, and read robot logs — the full code → robot → debug loop.

## Setup

```bash
git clone <this repo> && cd ftcmcp
npm install && npm run build

# Reference material (SDK samples + Pedro Pathing docs) used by the knowledge tools:
git clone --depth 1 https://github.com/FIRST-Tech-Challenge/FtcRobotController refs/FtcRobotController
git clone --depth 1 https://github.com/Pedro-Pathing/Docs refs/PedroDocs
```

Requirements: Node 18+, `adb` (Android platform-tools), and the Android SDK + JDK 17+ if you want to build (an Android Studio install provides both).

### Register with Claude Code

Opening this directory in Claude Code picks up [.mcp.json](.mcp.json) automatically. From another project:

```bash
claude mcp add ftc -- node /path/to/ftcmcp/dist/index.js
```

### Register with Claude Desktop

```json
{
  "mcpServers": {
    "ftc": {
      "command": "node",
      "args": ["/path/to/ftcmcp/dist/index.js"],
      "env": { "FTC_PROJECT_DIR": "/path/to/your/FtcRobotController" }
    }
  }
}
```

## Tools

**Knowledge**

| Tool | What it does |
|---|---|
| `list_samples` | List the 66 official FTC sample OpModes (drive, sensors, AprilTag vision, ...) |
| `get_sample` | Full Java source of a sample |
| `search_docs` | Keyword search across Pedro Pathing docs + SDK samples |
| `get_doc` | Fetch a Pedro Pathing doc page as markdown |

**Project**

| Tool | What it does |
|---|---|
| `create_project` | Clone a fresh FtcRobotController SDK project |
| `list_opmodes` | List `@TeleOp`/`@Autonomous` classes in TeamCode |
| `create_opmode` | Scaffold an OpMode: `linear-teleop`, `mecanum-teleop`, `linear-auto`, `pedro-auto`, `pedro-teleop` |
| `install_pedro` | Add Pedro Pathing to a project (Gradle deps, compileSdk 34, `Constants.java` scaffold) |

**Subsystems** — the recommended way to structure robot code: one plain class per mechanism, with a living markdown knowledge base the LLM reads and updates.

| Tool | What it does |
|---|---|
| `create_subsystem` | Scaffold a subsystem class (hardcoded config-name constants, action methods, `stop()`) with optional injected subsystem dependencies and dashboard-tunable constants, + a bench-test TeleOp + a markdown doc |
| `document_subsystem` | Write/update a subsystem's knowledge-base doc (functions, tuning, config names, quirks) |
| `list_subsystems` / `get_subsystem` | Read the robot's architecture from `docs/` |
| `create_teleop` | Generate a TeleOp **plus a separate `<Name>Controls.java`** holding only the button bindings, wiring drive + subsystem actions + automations |
| `create_calculation` | Scaffold a stateless helper class (e.g. live trajectory math) |
| `hardware_manifest` | Aggregate every config name across subsystems and flag duplicates/typos vs. the Driver Station config |

**Robot**

| Tool | What it does |
|---|---|
| `adb_devices` / `adb_connect` | Find / connect to the robot (Control Hub default: `192.168.43.1:5555`) |
| `build` | Gradle `:TeamCode:assembleDebug` with compiler errors extracted on failure |
| `deploy` | Install the APK and restart the Robot Controller app |
| `robot_logs` | Filtered logcat from the robot (crashes, OpMode exceptions, SDK events) |

## Typical agent session

1. `adb_connect` → laptop already on the robot's WiFi joins the Control Hub
2. `search_docs("mecanum field centric")` / `get_sample(...)` → find reference code
3. `create_opmode(className: "CompTeleOp", template: "mecanum-teleop")`
4. `build` → fix any compiler errors → `deploy`
5. Driver tests the OpMode → `robot_logs(filter: "CompTeleOp")` to debug

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
| `FTC_PROJECT_DIR` | Default FTC SDK project used by project/robot tools |
| `FTC_MCP_REFS` | Location of the reference clones (default: `./refs`) |
| `ADB_PATH` | Explicit path to `adb` if not on PATH |

## Notes

- **Pedro Pathing constants must be tuned.** `install_pedro` scaffolds `Constants.java` with placeholder values for a mecanum drivetrain + goBILDA Pinpoint localizer; run the tuning OpModes (see `search_docs "tuning"`) before trusting any path.
- The Control Hub's WiFi password and SSID are shown on the Driver Station under *Program & Manage*.
- Deploying replaces the Robot Controller app's code but keeps robot configurations. If `adb install` reports a signature mismatch, one `adb uninstall com.qualcomm.ftcrobotcontroller` is needed (this clears configs).

## Development

```bash
npm test            # build + MCP smoke test (no robot needed)
node scripts/test-build.mjs [projectPath]           # real Gradle build through the build tool
node scripts/test-pedro-build.mjs [projectPath]     # install_pedro + all templates + full build
node scripts/test-subsystem-build.mjs [projectPath] # scaffold intake/spindexer/turret subsystems + a full TeleOp + build
```
