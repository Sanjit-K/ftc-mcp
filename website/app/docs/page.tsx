import Link from "next/link";

const tools = ["inspect_project", "check_project_hygiene", "create_project", "list_generated_files", "list_backups", "restore_backup", "list_samples", "search_docs", "create_subsystem", "create_teleop", "hardware_manifest", "validate_hardware", "build", "build_and_deploy", "clear_robot_logs", "robot_logs", "document_subsystem"];

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
        <h2 id="tools">Tool reference</h2><p>The server exposes 28 focused tools. These are the ones you’ll meet first.</p><div className="toolList">{tools.map((tool,i)=><div key={tool}><code>{tool}</code><span>{i < 6 ? "Project setup, hygiene, inventory, and recovery" : i < 8 ? "Search FTC and Pedro references" : i < 12 ? "Generate and validate structured robot code" : i < 16 ? "Build, install, and debug" : "Maintain the robot knowledge base"}</span></div>)}</div>
        <h2 id="bindings">Human-editable bindings</h2><p>Generated TeleOps keep button mappings separate from subsystem logic. Drivers can remap controls without touching how the mechanism works.</p>
        <h2 id="knowledge">Robot knowledge base</h2><p>ftc-mcp maintains a plain-text <code>docs/</code> directory describing hardware names, subsystem commands, and project structure. A new AI session can inspect it before making changes.</p>
        <h2 id="troubleshooting">Troubleshooting</h2><details><summary>Gradle sync does not appear<span>+</span></summary><p>Open the <code>FtcRobotController</code> folder itself in Android Studio, not its parent directory.</p></details><details><summary>The docs folder is missing in Android Studio<span>+</span></summary><p>Switch the project browser from Android view to Project view.</p></details><details><summary>Deploy fails with a signature mismatch<span>+</span></summary><p>Uninstall the existing Robot Controller package with adb, then deploy again.</p></details>
        <h2 id="config">Configuration</h2><div className="toolList"><div><code>FTC_PROJECT_DIR</code><span>Default FTC project location</span></div><div><code>FTC_MCP_REFS</code><span>Additional local reference sources</span></div><div><code>ADB_PATH</code><span>Custom Android Debug Bridge path</span></div></div>
      </article>
    </div>
  </main>
}
