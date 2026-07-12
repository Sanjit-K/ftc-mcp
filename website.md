# FTC Toolchain — Website Plan

What the ftc-toolchain website should contain, page by page. Audience: **FTC students and
mentors** (grades 7–12, plus coaches) who already use Android Studio and want an AI
that can actually build, wire, and deploy robot code — not just chat about it.

Goal of the site: a visitor understands what ftc-toolchain is in 10 seconds, sees it work in
under a minute, and can copy two commands to install it. Secondary goal: be the docs.

---

## Site structure

A single marketing landing page + a docs section. Keep it to two "surfaces":

1. **Landing page** (`/`) — the pitch, scannable, one screen of real value per scroll.
2. **Docs** (`/docs`) — install, tool reference, guides, troubleshooting.

Optional later: `/blog` (build logs, release notes), `/showcase` (teams using it).

---

## Landing page — section by section

### 1. Hero
- **Headline:** "Your AI can build the robot now." (or: "AI that writes, wires, and deploys FTC code.")
- **Subhead:** "ftc-toolchain gives Codex, Claude, and other MCP clients the tools to scaffold subsystems, wire TeleOp, build with Gradle, and deploy to your Control Hub — the whole loop, from prompt to robot."
- **Primary CTA:** `Get started` → jumps to install. **Secondary:** `View on GitHub`.
- **Hero visual:** a short looping terminal/asciinema clip: a person types *"make an intake subsystem with one motor, spinIn and spinOut, plus a bench test"* and files appear + a green `BUILD SUCCESSFUL`. Motion sells this better than a screenshot.
- Trust line under the CTA: "Works with the official FtcRobotController SDK and Pedro Pathing. Free & open source (MIT)."

### 2. The problem (short, relatable)
Three lines, FTC-specific:
- "Every season starts with the same boilerplate: hardware maps, drive code, config names that must match the Driver Station."
- "AI chatbots can *describe* the code — but you still copy-paste, fix imports, and chase build errors."
- "ftc-toolchain closes the loop: the AI runs the tools, builds the code, and tells you what broke."

### 3. What it does (3–4 feature cards)
Group the 20 tools into the buckets and show them as cards with an icon each:
- **Knowledge** — "Searches the official FTC samples and Pedro Pathing docs so the AI cites real, working code — not hallucinated APIs."
- **Subsystems & TeleOp** — "Scaffolds one clean class per mechanism, injects dependencies, and generates a TeleOp with a *separate, human-editable bindings file* your drivers can remap."
- **Build & Deploy** — "Runs Gradle, extracts the actual compiler errors, installs the APK over WiFi, and reads logcat back."
- **Robot knowledge base** — "Keeps a living `docs/` describing every subsystem — so next session the AI already knows your robot."

### 4. How it works (the loop)
A simple 4-step horizontal diagram:
`Describe → Scaffold → Build → Deploy` with one line each. Reinforce that the AI drives
the tools; the student stays in control and reviews the diffs.

### 5. Live example / proof (the strongest section)
Use the **reconstruction case study** — it's the credibility anchor:
- "We took a real competition robot (8 subsystems, dual TeleOps, a color-sorting spindexer with custom PID), turned it into a plain-English prompt, and rebuilt it through ftc-toolchain into an empty folder."
- Result stat tiles: **8/8 subsystems reproduced · 76/76 public methods · compiles to a real APK.**
- A before/after: original inline controls vs the generated separate `Controls.java`.
- Keep it honest: note the AI writes the logic; the tools guarantee the structure, wiring, and that it builds.

### 6. Install (make it copy-paste obvious)
Two commands, big monospace block with a copy button:
```
codex mcp add ftc-toolchain -- npx -y ftc-toolchain
npx ftc-toolchain setup
```
Tabs for **Codex** / **Claude Code** / **Other MCP clients**. Requirements line:
Node 18+, Android Studio (for building), adb (for deploying).

### 7. Safety / "who's in control"
Reassure mentors: "The AI proposes and runs tools; you approve and review every change in
git. Nothing deploys to your robot without you asking." Important for school adoption.

### 8. FAQ (5–6 items)
- "Do I need to know how MCP works?" (No — two commands.)
- "Does it work without Pedro Pathing?" (Yes; Pedro is optional, one tool installs it.)
- "Will it overwrite my code?" (No — refuses to overwrite unless you pass overwrite.)
- "Does it need a robot connected?" (No — only the deploy/logs tools do.)
- "Which season / SDK version?" (Tracks the current FtcRobotController; Pedro 2.x.)
- "Is my code sent anywhere?" (The MCP server runs locally; your AI client's normal privacy applies.)

### 9. Footer
GitHub, npm, docs, license (MIT), a "not affiliated with FIRST" disclaimer, and a link to
report issues. Credit FTC SDK and Pedro Pathing.

---

## Docs section (`/docs`)

- **Quickstart** — install, `setup`, first subsystem, first build.
- **Concepts** — subsystems, the bindings file, the robot knowledge base, the hardware manifest.
- **Tool reference** — one entry per tool (name, what it does, params, example call, example output). Auto-generatable from the tool descriptions.
- **Guides** — "Scaffold a mechanism from a description", "Build a TeleOp with automations & guards", "Install & tune Pedro Pathing", "Connect and deploy to a Control Hub", "Reconstruct a robot from a prompt".
- **Troubleshooting** — the real rough edges we hit, so people don't get stuck:
  - Gradle sync not appearing (open the `FtcRobotController` subfolder, not its parent).
  - `docs/` invisible in Android Studio (switch to "Project" view).
  - Signature mismatch on deploy (`adb uninstall …`).
  - Panels `@Configurable` needs `install_pedro`.
- **Config** — env vars (`FTC_TOOLCHAIN_PROJECT_DIR`, `FTC_TOOLCHAIN_REFS`, `FTC_TOOLCHAIN_HOME`, `ADB_PATH`).
- **Deployment choices** — use direct USB-C for a connected ADB device, or build while online and automatically switch macOS or Windows to a saved Control Hub network before restoring internet Wi-Fi.

---

## Design & tone notes
- **Voice:** builder-to-builder, not corporate. Short sentences. FTC vocabulary (OpMode, Control Hub, Driver Station, subsystem) used correctly — this signals it's made by someone who's done FTC.
- **Look:** dark, technical, "IDE-adjacent." Monospace for anything a user types. A robot/orange accent works (evokes FTC) but avoid FIRST's exact branding to stay clearly unaffiliated.
- **Motion:** the hero terminal clip is the single most important asset. One good 20–30s recording of a real session (subsystem → build → green checkmark) does more than any paragraph.
- **Accessibility:** real text (not text-in-images) for code, good contrast, works on mobile — mentors will open it on phones.
- **Must render code and terminal output cleanly** with copy buttons; most of the page is code.

## Build notes (suggested, not required)
- Static site (Astro / Next static export / plain HTML). No backend needed.
- Host on GitHub Pages or Vercel; point a domain like `ftctoolchain.dev` at it.
- Docs can be MDX so the tool reference and guides live next to the code and version with it.
- Add Open Graph tags + a social preview image (the hero clip's poster frame) so shared links look good in team Discords/Slacks — that's how this spreads between teams.

## What NOT to do
- No sign-up wall, no email capture before the value. It's a dev tool — the install commands are the CTA.
- Don't overstate: it doesn't tune your robot or replace testing. Say "scaffolds and builds," not "writes your whole robot."
- Don't imply FIRST endorsement.
