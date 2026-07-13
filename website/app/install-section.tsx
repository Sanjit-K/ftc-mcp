"use client";

import { useState } from "react";

type ClientId = "codex" | "claude" | "other";
type OsId = "unix" | "windows";
type ProjectMode = "existing" | "scratch";

const clients: Array<{ id: ClientId; label: string }> = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "other", label: "Other MCP client" },
];

const defaultPaths: Record<OsId, string> = {
  unix: "/Users/team/DecodeRobot",
  windows: "C:\\Users\\team\\DecodeRobot",
};

function shellEnv(path: string): string {
  return `FTC_TOOLCHAIN_PROJECT_DIR="${path.replaceAll('"', '\\"')}"`;
}

function registration(client: ClientId, projectPath: string): { language: string; content: string } {
  if (client === "codex") {
    return {
      language: "Terminal",
      content: `codex mcp add --env ${shellEnv(projectPath)} ftc-toolchain -- npx -y ftc-toolchain`,
    };
  }
  if (client === "claude") {
    return {
      language: "Terminal",
      content: `claude mcp add ftc-toolchain -e ${shellEnv(projectPath)} -- npx -y ftc-toolchain`,
    };
  }
  return {
    language: "MCP config",
    content: JSON.stringify({
      mcpServers: {
        "ftc-toolchain": {
          command: "npx",
          args: ["-y", "ftc-toolchain"],
          env: { FTC_TOOLCHAIN_PROJECT_DIR: projectPath },
        },
      },
    }, null, 2),
  };
}

function cloneCommand(projectPath: string): string {
  return `git clone --depth 1 https://github.com/FIRST-Tech-Challenge/FtcRobotController.git "${projectPath.replaceAll('"', '\\"')}"`;
}

interface CopyBlockProps {
  id: string;
  label: string;
  language: string;
  content: string;
  copiedId: string | null;
  onCopy: (id: string, content: string) => void;
}

function CopyBlock({ id, label, language, content, copiedId, onCopy }: CopyBlockProps) {
  return <div className="setupCommand">
    <div className="setupCommandHead"><span>{label}</span><small>{language}</small></div>
    <div className="setupCode"><pre><code>{content}</code></pre><button type="button" onClick={() => onCopy(id, content)} aria-label={`Copy ${label}`}>{copiedId === id ? "Copied ✓" : "Copy"}</button></div>
  </div>;
}

export function InstallSection() {
  const [projectMode, setProjectMode] = useState<ProjectMode>("existing");
  const [client, setClient] = useState<ClientId>("codex");
  const [os, setOs] = useState<OsId>("unix");
  const [projectPath, setProjectPath] = useState(defaultPaths.unix);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const resolvedPath = projectPath.trim() || defaultPaths[os];
  const register = registration(client, resolvedPath);
  const isScratch = projectMode === "scratch";
  const registerStep = isScratch ? 2 : 1;
  const setupStep = isScratch ? 3 : 2;
  const verifyStep = isScratch ? 4 : 3;

  function chooseOs(nextOs: OsId) {
    setOs(nextOs);
    setProjectPath(defaultPaths[nextOs]);
    setCopiedId(null);
  }

  async function copy(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
    } catch {
      setCopiedId(null);
    }
  }

  return <section className="install" id="install">
    <div className="shell setupIntro">
      <div><p className="sectionKicker">START BUILDING</p><h2>Connect your existing<br />robot project.</h2></div>
      <p>Choose your AI client, enter the FTC SDK project root—the folder containing <code>TeamCode</code>—then copy the generated setup.</p>
    </div>
    <div className="shell setupGrid">
      <div className="setupControls">
        <fieldset><legend>1. Choose how to begin</legend><div className="modeTabs" aria-label="Project starting point"><button type="button" aria-pressed={!isScratch} className={!isScratch ? "active" : ""} onClick={() => { setProjectMode("existing"); setCopiedId(null); }}>Use an existing project</button><button type="button" aria-pressed={isScratch} className={isScratch ? "active" : ""} onClick={() => { setProjectMode("scratch"); setCopiedId(null); }}>Start from scratch</button></div></fieldset>
        <fieldset><legend>2. Choose your client</legend><div className="setupTabs" aria-label="AI client">{clients.map((item) => <button key={item.id} type="button" aria-pressed={client === item.id} className={client === item.id ? "active" : ""} onClick={() => { setClient(item.id); setCopiedId(null); }}>{item.label}</button>)}</div></fieldset>
        <fieldset><legend>3. Choose your computer</legend><div className="osTabs" aria-label="Operating system"><button type="button" aria-pressed={os === "unix"} className={os === "unix" ? "active" : ""} onClick={() => chooseOs("unix")}>macOS / Linux</button><button type="button" aria-pressed={os === "windows"} className={os === "windows" ? "active" : ""} onClick={() => chooseOs("windows")}>Windows</button></div></fieldset>
        <label className="pathField"><span>4. {isScratch ? "New project location" : "FTC project root"}</span><input value={projectPath} onChange={(event) => { setProjectPath(event.target.value); setCopiedId(null); }} spellCheck={false} aria-describedby="pathHint" /><small id="pathHint">{isScratch ? "Choose an empty location. FTC Toolchain will clone the official SDK here." : <>Use the SDK root, not the <code>TeamCode</code> folder itself.</>}</small></label>
        <div className="setupRequirements"><b>Before you start</b><span>Node 18+</span><span>Git</span><span>Android Studio + JDK 17</span><span>adb for robot deploys</span></div>
      </div>
      <div className="installCard">
        {isScratch && <CopyBlock id="clone" label="1. Clone the official FTC SDK" language="Terminal · run once" content={cloneCommand(resolvedPath)} copiedId={copiedId} onCopy={copy} />}
        <CopyBlock id="register" label={client === "other" ? `${registerStep}. Add this server to your MCP config` : `${registerStep}. Register FTC Toolchain`} language={register.language} content={register.content} copiedId={copiedId} onCopy={copy} />
        <CopyBlock id="setup" label={`${setupStep}. Download FTC + Pedro references`} language="Terminal · run once" content="npx -y ftc-toolchain setup" copiedId={copiedId} onCopy={copy} />
        <div className="setupVerify"><span>{verifyStep}</span><div><b>Start a new AI session</b><p>Ask: “Run <code>inspect_project</code> before changing anything.” It should report the selected path, OpModes, Git state, Gradle, Android SDK, and hardware names.</p></div></div>
      </div>
    </div>
  </section>;
}
