import Link from "next/link";
import { InstallSection } from "./install-section";

const assetPrefix = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const features = [
  { id: "01", label: "Knowledge", title: "Real APIs. Real examples.", body: "Searches official FTC samples and Pedro Pathing docs, so your AI cites working code instead of inventing methods.", tag: "search_knowledge" },
  { id: "02", label: "Scaffold", title: "Clean code, wired up.", body: "Creates one class per mechanism, injects dependencies, and keeps driver bindings in a separate, editable file.", tag: "create_subsystem" },
  { id: "03", label: "Build + deploy", title: "Cable or Wi-Fi. Your choice.", body: "Deploys directly over USB-C, or switches to saved Control Hub Wi-Fi and restores your internet automatically.", tag: "deploy_robot" },
  { id: "04", label: "Robot memory", title: "Next session starts ahead.", body: "Maintains a living docs/ knowledge base of your robot, hardware names, and public subsystem commands.", tag: "document_robot" },
];

const steps = [
  ["01", "Describe", "Say what the mechanism should do."],
  ["02", "Scaffold", "Review a clean, FTC-native implementation."],
  ["03", "Build", "Gradle runs. Compiler errors come back."],
  ["04", "Deploy", "Send it to the Control Hub when you’re ready."],
];

const faqs = [
  ["Do I need to understand MCP?", "No. Add the server with one command, run setup, then talk to your AI like you normally would."],
  ["Does it require Pedro Pathing?", "No. Pedro is optional, and FTC Toolchain includes a tool to install it when your robot needs it."],
  ["Will it overwrite my code?", "Not silently. File-generating tools refuse to overwrite existing work unless you explicitly allow it."],
  ["Does the robot need to be connected?", "Only for deployment and device logs. Scaffolding, docs, and local builds work without a robot."],
  ["How does deployment connect?", "Choose direct USB-C when you are near the robot, or automatic saved-Wi-Fi switching when you want to stay cable-free. No phone tether is required."],
  ["Where does my code go?", "The MCP server runs locally. Your AI client’s normal privacy and data settings still apply."],
];

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <Link href="/" className="brand" aria-label="FTC Toolchain home"><img className="brandMark" src={`${assetPrefix}/logo.svg`} alt="" /><span>FTC Toolchain</span></Link>
        <div className="navLinks"><a href="#features">Features</a><a href="#proof">Proof</a><Link href="/docs">Docs</Link></div>
        <a className="navGit" href="https://github.com/Sanjit-K/ftc-toolchain" target="_blank" rel="noreferrer">GitHub <span>↗</span></a>
      </nav>

      <section className="hero shell">
        <div className="eyebrow"><span className="statusDot" /> Local tools for FTC robot code <b>v0.2</b></div>
        <h1>Your AI can<br /><em>build the robot</em> now.</h1>
        <p className="heroCopy">FTC Toolchain gives Codex, Claude, and other MCP clients the tools to scaffold subsystems, wire TeleOp, build with Gradle, and deploy to your Control Hub.</p>
        <div className="heroActions"><a className="button primary" href="#install">Get started <span>↓</span></a><Link className="button secondary" href="/docs">Read the docs <span>↗</span></Link></div>
        <p className="trust"><span>✓</span> Official FTC SDK <span>✓</span> Pedro Pathing <span>✓</span> Free &amp; open source</p>

        <div className="terminal" aria-label="Example ftc-toolchain terminal session">
          <div className="terminalBar"><div className="lights"><i /><i /><i /></div><span>codex — ~/CenterstageRobot</span><span className="terminalMeta">MCP CONNECTED</span></div>
          <div className="terminalBody">
            <div className="line user"><span>›</span><p>Make an intake subsystem with one motor, <code>spinIn</code> and <code>spinOut</code>, plus a bench test.</p></div>
            <div className="line dim"><span>●</span><p>I’ll scaffold the subsystem, wire its hardware config, then run a build.</p></div>
            <div className="tool"><div><span>⚡</span><b>ftc-toolchain.create_subsystem</b></div><strong>DONE</strong><p>Created <code>subsystems/Intake.java</code> · 48 lines</p></div>
            <div className="tool"><div><span>⚡</span><b>ftc-toolchain.create_test_opmode</b></div><strong>DONE</strong><p>Created <code>opmodes/IntakeBenchTest.java</code></p></div>
            <div className="buildLine"><span>✓</span><b>BUILD SUCCESSFUL</b><small>in 4s</small><i>APK READY</i></div>
          </div>
        </div>
      </section>

      <InstallSection />

      <section className="problem shell">
        <p className="sectionKicker">THE GAP</p>
        <h2>Chat is useful.<br /><span>Shipping robot code is better.</span></h2>
        <div className="problemGrid"><p>Every season starts with hardware maps, drive code, and config names that must match the Driver Station.</p><p>Chatbots can describe the code. You still copy, paste, fix imports, and chase build errors.</p><p>FTC Toolchain closes the loop. The AI runs real tools, builds the code, and tells you exactly what broke.</p></div>
      </section>

      <section className="features shell" id="features">
        <div className="sectionHead"><div><p className="sectionKicker">35 TOOLS. FOUR JOBS.</p><h2>Everything between<br />the prompt and the robot.</h2></div><p>Purpose-built tools for the repetitive, fragile parts of an FTC codebase. Your AI handles the loop; your team reviews every diff.</p></div>
        <div className="featureGrid">{features.map((f) => <article className="featureCard" key={f.id}><div className="featureTop"><span>{f.id}</span><i>↗</i></div><p className="featureLabel">{f.label}</p><h3>{f.title}</h3><p>{f.body}</p><code>{f.tag}</code></article>)}</div>
      </section>

      <section className="loop">
        <div className="shell"><div className="sectionHead light"><div><p className="sectionKicker">THE LOOP</p><h2>You describe the robot.<br />The tools do the typing.</h2></div><p>Nothing is hidden. You stay in control, review the code, and decide when it touches hardware.</p></div>
          <div className="steps">{steps.map(([n,t,b], i) => <div className="step" key={n}><div className="stepIcon">{i === 0 ? "✦" : i === 1 ? "⌘" : i === 2 ? ">_" : "⇧"}</div><span>{n}</span><h3>{t}</h3><p>{b}</p>{i < 3 && <i className="arrow">→</i>}</div>)}</div>
        </div>
      </section>

      <section className="proof shell" id="proof">
        <div className="proofCopy"><p className="sectionKicker">PROOF, NOT A DEMO</p><h2>We rebuilt a real competition robot from a prompt.</h2><p>Eight subsystems. Dual TeleOps. A color-sorting spindexer with custom PID. We started with an empty folder and a plain-English description.</p><p className="honesty">The AI wrote the logic. FTC Toolchain guaranteed the structure, wiring, and a buildable result.</p></div>
        <div className="stats"><div><strong>8<span>/8</span></strong><p>subsystems reproduced</p></div><div><strong>76<span>/76</span></strong><p>public methods matched</p></div><div><strong>01</strong><p>real, installable APK</p></div></div>
        <div className="diffCard"><div className="diffHead"><span>Controls.java</span><small>GENERATED · HUMAN-EDITABLE</small></div><pre><span className="comment">// Driver bindings stay out of robot logic</span>{`\n`}<span className="purple">public void</span> <span className="blue">bind</span>(GamepadEx driver) {`{`}{`\n`}  driver.<span className="blue">getGamepadButton</span>(A){`\n`}    .<span className="blue">whenPressed</span>(intake::<span className="blue">spinIn</span>){`\n`}    .<span className="blue">whenReleased</span>(intake::<span className="blue">stop</span>);{`\n`}{`}`}</pre></div>
      </section>

      <section className="safety shell"><div className="shield">✓</div><div><p className="sectionKicker">YOU’RE IN CONTROL</p><h2>Review the diff.<br />Then run the robot.</h2></div><p>FTC Toolchain proposes and runs local tools. It won’t overwrite existing files by default, and nothing deploys to your Control Hub unless you ask.</p></section>

      <section className="faq shell"><p className="sectionKicker">FAQ</p><h2>The practical questions.</h2><div className="faqGrid">{faqs.map(([q,a]) => <details key={q}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div></section>

      <footer><div className="shell footerInner"><div><Link href="/" className="brand"><img className="brandMark" src={`${assetPrefix}/logo.svg`} alt="" /><span>FTC Toolchain</span></Link><p>Tools that help AI build FTC robot code.</p></div><div className="footerLinks"><div><b>PROJECT</b><Link href="/docs">Docs</Link><a href="https://github.com/Sanjit-K/ftc-toolchain">GitHub</a><a href="https://npmjs.com/package/ftc-toolchain">npm</a></div><div><b>LEGAL</b><a href="https://opensource.org/license/mit">MIT License</a><a href="https://github.com/Sanjit-K/ftc-toolchain/issues">Report an issue</a></div></div></div><div className="shell finePrint"><span>© 2026 FTC Toolchain</span><span>Not affiliated with or endorsed by FIRST®.</span></div></footer>
    </main>
  );
}
