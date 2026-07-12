import Link from "next/link";

const toolGroups = [
  {
    name: "Knowledge",
    tools: [
      { name: "list_samples", description: "Lists official FtcRobotController sample OpModes for drive code, sensors, AprilTag vision, gamepads, telemetry, and other SDK features. Filter by Basic, Concept, Robot, Sensor, Sample, or Utility." },
      { name: "get_sample", description: "Returns the complete Java source of an official FTC sample OpMode by the name returned from list_samples, such as BasicOmniOpMode_Linear." },
      { name: "search_docs", description: "Searches Pedro Pathing documentation and official FTC sample OpModes. Use it for path following, tuning, localization, coordinates, hardware APIs, and SDK behavior; small technical-term typos are tolerated." },
      { name: "get_doc", description: "Returns a complete Pedro Pathing documentation page as Markdown using an ID returned by search_docs, such as pathing/tuning/localization/pinpoint." },
      { name: "reference_status", description: "Reports local FTC sample and Pedro documentation counts, Git branches, commits, commit dates, cache age, and the exact reference-library location without using the network." },
      { name: "update_references", description: "Fast-forwards the cached official FTC SDK samples and Pedro docs checkouts, then refreshes the search cache. Refuses to touch either checkout when it contains local changes." },
    ],
  },
  {
    name: "Project",
    tools: [
      { name: "inspect_project", description: "Start here when entering a robot project or debugging setup. Summarizes the resolved project path, SDK, Git state, OpModes, subsystem docs, Pedro setup, hardware-name collisions, latest APK, reference library, Android SDK, and next actions." },
      { name: "check_project_hygiene", description: "Runs a read-only pre-competition audit for duplicate Driver Station names, orphaned generated file pairs, broken subsystem-doc links, incompatible hardware types, stale or missing APKs, disabled OpModes, TODOs, and uncommitted Git changes." },
      { name: "create_project", description: "Clones a fresh official FtcRobotController SDK project into the ftc-mcp workspace or a specified destination. Skip this when the team already has a project and pass that path to other tools." },
      { name: "list_opmodes", description: "Lists every @TeleOp and @Autonomous class in TeamCode, including its Java class, Driver Station display name, relative file path, type, and whether it is @Disabled." },
      { name: "list_generated_files", description: "Inventories Java and robot-documentation files marked as scaffolded by ftc-mcp, grouped by artifact kind. Markers identify origin only—team edits are expected and must be preserved." },
      { name: "list_backups", description: "Lists project-scoped recovery snapshots created automatically before ftc-mcp overwrites files, including each backup ID and every contained relative path." },
      { name: "restore_backup", description: "Previews restoring all or selected relative paths from an ftc-mcp backup. Nothing changes unless confirm is true; a confirmed restore first backs up the current versions and never deletes unrelated files." },
      { name: "create_opmode", description: "Scaffolds a Java OpMode in TeamCode from linear TeleOp, mecanum TeleOp, linear autonomous, Pedro autonomous, or Pedro TeleOp templates. Supports custom display name, group, package, safe preview, and explicit overwrite." },
      { name: "install_pedro", description: "Installs Pedro Pathing into an FTC SDK project: adds the Maven repository and dependencies, raises compileSdk to 34 when needed, and scaffolds mecanum + Pinpoint Constants.java. Every generated constant must be tuned afterward." },
    ],
  },
  {
    name: "Robot architecture",
    tools: [
      { name: "create_subsystem", description: "Scaffolds one plain FTC subsystem class with HardwareMap construction, typed hardware fields, config-name constants, injected subsystem dependencies, action methods, and a real safety stop(). It can also create a bench-test TeleOp and living Markdown documentation." },
      { name: "document_subsystem", description: "Writes or updates docs/subsystems/<Name>.md and refreshes docs/ROBOT.md. Use it to preserve functions, hardware names, tuning values, quirks, wiring notes, and mechanical constraints for future sessions." },
      { name: "list_subsystems", description: "Lists the robot’s documented subsystems from the docs/ knowledge base with their summaries and file paths. Use it first to understand the existing robot architecture." },
      { name: "get_subsystem", description: "Returns one subsystem’s knowledge-base document—hardware, config names, functions, tuning, and quirks—and can append the matching Java source when includeSource is true." },
      { name: "create_calculation", description: "Scaffolds a stateless, static-only Java helper for reusable calculations such as live trajectory math. Supports package grouping, safe preview, and explicit overwrite so math stays out of OpModes and subsystem classes." },
      { name: "hardware_manifest", description: "Scans TeamCode for every robot-configuration name used by hardwareMap and generated subsystem constructors, reports each type and source file, and flags names shared across files for Driver Station cross-checking." },
      { name: "validate_hardware", description: "Runs a hardware preflight that flags one Driver Station name requested as incompatible device types, cross-file sharing, and unresolved constants, then reports whether errors must be fixed before running an OpMode." },
      { name: "create_teleop", description: "Generates a TeleOp plus a separate <Name>Controls.java containing only controller bindings. Supports mecanum or Pedro drive, subsystem construction, hold/press/toggle actions, exclusive groups, safety guards, slow mode, automation stubs, dry-run preview, and explicit overwrite." },
    ],
  },
  {
    name: "Build, deploy & debug",
    tools: [
      { name: "adb_devices", description: "Lists Android devices visible to adb, including connected REV Control Hubs and Robot Controller phones, with guidance when no device is attached." },
      { name: "adb_connect", description: "Connects adb to a REV Control Hub or Robot Controller phone over Wi-Fi. The default target is 192.168.43.1:5555 when the laptop is joined to the Control Hub access point." },
      { name: "robot_status", description: "Returns a read-only snapshot of the selected device: adb serial, model, Android version, Robot Controller app version, Android battery-service level and temperature, and data-storage usage. A serial is required when multiple devices are connected." },
      { name: "restart_robot_controller", description: "Force-stops and restarts the Robot Controller app without rebuilding or reinstalling an APK. Use it when the Driver Station is stale or an OpMode left the app unhealthy." },
      { name: "build", description: "Compiles :TeamCode:assembleDebug with Gradle, optionally cleaning first and using a custom timeout or stacktrace. Returns verified APK path, size, and duration on success, or contextual compiler/Gradle errors on failure." },
      { name: "deploy", description: "Installs an already-built TeamCode debug APK on the selected robot with adb install -r, then restarts the Robot Controller app. Run build first; specify serial when multiple devices are attached." },
      { name: "build_and_deploy", description: "The safest competition-day path: builds TeamCode first, verifies that the expected fresh APK exists, installs only after that build succeeds, and restarts the Robot Controller app. Supports clean, timeout, stacktrace, and device-serial options." },
      { name: "clear_robot_logs", description: "Clears the selected robot’s logcat buffer before reproducing a crash or bad behavior. Reproduce the problem, then call robot_logs for a clean signal." },
      { name: "robot_logs", description: "Returns recent logcat from the selected robot after deployment or an OpMode failure. Limit the line count, filter case-insensitively by OpMode/RobotCore/Exception text, or request error-level entries only." },
    ],
  },
];

export default function Docs() {
  return <main className="docsPage">
    <nav className="nav shell"><Link href="/" className="brand"><span className="brandMark">f</span><span>ftc-mcp</span><small>/ docs</small></Link><div className="navLinks"><Link href="/#features">Features</Link><Link href="/">Home</Link></div><a className="navGit" href="https://github.com/Sanjit-K/ftc-mcp">GitHub ↗</a></nav>
    <div className="docsLayout shell">
      <aside><b>GET STARTED</b><a href="#quickstart" className="active">Quickstart</a><a href="#first-build">First build</a><b>CONCEPTS</b><a href="#tools">Tool reference</a><a href="#bindings">Bindings</a><a href="#knowledge">Robot knowledge</a><b>OPERATIONS</b><a href="#troubleshooting">Troubleshooting</a><a href="#config">Configuration</a></aside>
      <article className="docsContent">
        <p className="sectionKicker">QUICKSTART</p><h1 id="quickstart">From install to first build.</h1><p className="lead">ftc-mcp runs locally and gives your MCP-compatible AI a set of focused tools for working inside an FtcRobotController project.</p>
        <div className="callout"><b>Before you start</b><p>Install Node 18+ and Android Studio. You only need <code>adb</code> when deploying to a physical Control Hub.</p></div>
        <h2>1. Add the MCP server</h2><pre><code><span>$</span> claude mcp add ftc -- npx -y ftc-mcp</code></pre>
        <h2>2. Set up your project</h2><pre><code><span>$</span> cd ~/FtcRobotController{`\n`}<span>$</span> npx ftc-mcp setup</code></pre>
        <h2 id="first-build">3. Ask for a mechanism</h2><blockquote>“Preview an intake subsystem with one motor called intakeMotor. Add spinIn, spinOut, and stop.”</blockquote><p>Every code generator supports <code>dryRun: true</code>, so your AI can show the exact Java, docs, and target paths before writing anything. Approve the shape, then create it and run a build.</p>
        <h2 id="tools">Complete tool reference</h2><p>All 32 MCP tools are listed below. These descriptions closely mirror the metadata the LLM receives when it decides which tool to call.</p>
        {toolGroups.map((group) => <section className="toolGroup" key={group.name}><h3>{group.name}</h3><div className="toolList">{group.tools.map((tool) => <div key={tool.name}><code>{tool.name}</code><span>{tool.description}</span></div>)}</div></section>)}
        <h2 id="bindings">Human-editable bindings</h2><p>Generated TeleOps keep button mappings separate from subsystem logic. Drivers can remap controls without touching how the mechanism works.</p>
        <h2 id="knowledge">Robot knowledge base</h2><p>ftc-mcp maintains a plain-text <code>docs/</code> directory describing hardware names, subsystem commands, and project structure. A new AI session can inspect it before making changes.</p>
        <h2 id="troubleshooting">Troubleshooting</h2><details><summary>Gradle sync does not appear<span>+</span></summary><p>Open the <code>FtcRobotController</code> folder itself in Android Studio, not its parent directory.</p></details><details><summary>The docs folder is missing in Android Studio<span>+</span></summary><p>Switch the project browser from Android view to Project view.</p></details><details><summary>Deploy fails with a signature mismatch<span>+</span></summary><p>Uninstall the existing Robot Controller package with adb, then deploy again.</p></details>
        <h2 id="config">Configuration</h2><div className="toolList"><div><code>FTC_PROJECT_DIR</code><span>Default FTC project location</span></div><div><code>FTC_MCP_REFS</code><span>Additional local reference sources</span></div><div><code>ADB_PATH</code><span>Custom Android Debug Bridge path</span></div></div>
      </article>
    </div>
  </main>;
}
