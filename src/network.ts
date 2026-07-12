import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./exec.js";
import { buildProject, type BuildOptions } from "./robot.js";
import { DATA_DIR, resolveProject, ToolError } from "./paths.js";

type WifiPlatform = "macos" | "windows";
type JobStage = "queued" | "switching-to-robot" | "deploying" | "returning-home" | "succeeded" | "failed";

interface WifiDeployJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  stage: JobStage;
  platform: WifiPlatform;
  robotSsid: string;
  homeSsid: string;
  robotHost: string;
  robotPort: number;
  apkPath: string;
  wifiDevice?: string;
  delaySeconds: number;
  messages: string[];
}

const JOBS_DIR = join(DATA_DIR, "wifi-deploy-jobs");
const RC_PACKAGE = "com.qualcomm.ftcrobotcontroller";
const RC_ACTIVITY = `${RC_PACKAGE}/org.firstinspires.ftc.robotcontroller.internal.FtcRobotControllerActivity`;

function platformName(): WifiPlatform {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  throw new ToolError("Automatic Wi-Fi deployment currently supports macOS and Windows only.");
}

function jobPath(id: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new ToolError("Invalid Wi-Fi deployment job ID.");
  return join(JOBS_DIR, `${id}.json`);
}

function writeJob(job: WifiDeployJob): void {
  mkdirSync(JOBS_DIR, { recursive: true });
  writeFileSync(jobPath(job.id), `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(jobPath(job.id), 0o600); } catch { /* Windows permissions are profile-managed. */ }
}

function readJob(id: string): WifiDeployJob {
  const path = jobPath(id);
  if (!existsSync(path)) throw new ToolError(`Wi-Fi deployment job ${id} was not found.`);
  return JSON.parse(readFileSync(path, "utf8")) as WifiDeployJob;
}

function updateJob(job: WifiDeployJob, stage: JobStage, message: string): void {
  job.stage = stage;
  job.updatedAt = new Date().toISOString();
  job.messages.push(message);
  writeJob(job);
}

async function detectWifi(platform: WifiPlatform): Promise<{ ssid: string; device?: string }> {
  if (platform === "macos") {
    const ports = await run("networksetup", ["-listallhardwareports"], { timeoutMs: 10_000 });
    const device = ports.stdout.match(/Hardware Port: (?:Wi-Fi|AirPort)\r?\nDevice: ([^\r\n]+)/)?.[1]?.trim();
    if (!device) throw new ToolError("Could not find the macOS Wi-Fi device with networksetup.");
    const current = await run("networksetup", ["-getairportnetwork", device], { timeoutMs: 10_000 });
    const ssid = current.stdout.match(/Current Wi-Fi Network:\s*(.+)/)?.[1]?.trim();
    if (!ssid) throw new ToolError("The Mac is not currently connected to a Wi-Fi network. Connect to home Wi-Fi first.");
    return { ssid, device };
  }
  const current = await run("netsh", ["wlan", "show", "interfaces"], { timeoutMs: 10_000 });
  const ssid = current.stdout.match(/^\s*SSID\s*:\s*(.+)$/mi)?.[1]?.trim();
  if (!ssid) throw new ToolError("Windows is not currently connected to Wi-Fi. Connect to home Wi-Fi first.");
  return { ssid };
}

async function switchWifi(job: WifiDeployJob, ssid: string): Promise<void> {
  const result = job.platform === "macos"
    ? await run("networksetup", ["-setairportnetwork", job.wifiDevice ?? "en0", ssid], { timeoutMs: 30_000 })
    : await run("netsh", ["wlan", "connect", `name=${ssid}`, `ssid=${ssid}`], { timeoutMs: 30_000 });
  if (result.code !== 0) {
    throw new Error(`Could not connect to saved Wi-Fi network "${ssid}": ${(result.stderr || result.stdout).trim()}`);
  }
}

function adbExecutable(): string {
  if (process.env.ADB_PATH && existsSync(process.env.ADB_PATH)) return process.env.ADB_PATH;
  const macDefault = join(homedir(), "Library/Android/sdk/platform-tools/adb");
  return existsSync(macDefault) ? macDefault : "adb";
}

async function waitForAdb(target: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  let last = "";
  while (Date.now() < deadline) {
    const result = await run(adbExecutable(), ["connect", target], { timeoutMs: 8_000 });
    last = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code === 0 && /connected to|already connected to/i.test(last)) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`ADB could not reach ${target}: ${last || "connection timed out"}`);
}

async function installApk(job: WifiDeployJob): Promise<void> {
  const target = `${job.robotHost}:${job.robotPort}`;
  await waitForAdb(target);
  const install = await run(adbExecutable(), ["-s", target, "install", "-r", job.apkPath], { timeoutMs: 120_000 });
  const output = `${install.stdout}\n${install.stderr}`.trim();
  if (install.code !== 0 || !/Success/i.test(output)) throw new Error(`adb install failed: ${output}`);
  const stop = await run(adbExecutable(), ["-s", target, "shell", "am", "force-stop", RC_PACKAGE], { timeoutMs: 20_000 });
  if (stop.code !== 0) throw new Error(`APK installed, but the Robot Controller app could not be stopped: ${stop.stderr || stop.stdout}`);
  const start = await run(adbExecutable(), ["-s", target, "shell", "am", "start", "-n", RC_ACTIVITY], { timeoutMs: 20_000 });
  if (start.code !== 0) throw new Error(`APK installed, but the Robot Controller app could not be restarted: ${start.stderr || start.stdout}`);
}

export async function runWifiDeployWorker(jobId: string): Promise<void> {
  const job = readJob(jobId);
  let deploymentError: string | null = null;
  await new Promise((resolve) => setTimeout(resolve, job.delaySeconds * 1_000));
  try {
    updateJob(job, "switching-to-robot", `Switching Wi-Fi from ${job.homeSsid} to ${job.robotSsid}.`);
    await switchWifi(job, job.robotSsid);
    updateJob(job, "deploying", `Connected to ${job.robotSsid}; waiting for ADB at ${job.robotHost}:${job.robotPort}.`);
    await installApk(job);
    job.messages.push("Installed TeamCode-debug.apk and restarted the Robot Controller app.");
  } catch (error) {
    deploymentError = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      updateJob(job, "returning-home", `Returning Wi-Fi to ${job.homeSsid}.`);
      await switchWifi(job, job.homeSsid);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    } catch (error) {
      const returnError = error instanceof Error ? error.message : String(error);
      deploymentError = deploymentError ? `${deploymentError}; also failed to restore Wi-Fi: ${returnError}` : `Deployment completed, but Wi-Fi restoration failed: ${returnError}`;
    }
  }
  if (deploymentError) updateJob(job, "failed", deploymentError);
  else updateJob(job, "succeeded", `Deployment complete; Wi-Fi restored to ${job.homeSsid}.`);
}

export async function startWifiDeploy(opts: {
  robotSsid: string;
  homeSsid?: string;
  projectPath?: string;
  robotHost?: string;
  robotPort?: number;
  delaySeconds?: number;
  clean?: boolean;
  timeoutSeconds?: number;
  stacktrace?: boolean;
  dryRun?: boolean;
  platform?: WifiPlatform;
}): Promise<string> {
  const platform = opts.platform ?? platformName();
  if (!opts.robotSsid.trim()) throw new ToolError("robotSsid is required.");
  const project = resolveProject(opts.projectPath);
  const apkPath = join(project, "TeamCode/build/outputs/apk/debug/TeamCode-debug.apk");
  if (opts.dryRun) {
    return [
      "Wi-Fi deployment preview — no build, network switch, or deployment performed.",
      `Platform: ${platform}`,
      `Build: ${project}`,
      `Robot Wi-Fi: ${opts.robotSsid}`,
      `Robot ADB: ${opts.robotHost ?? "192.168.43.1"}:${opts.robotPort ?? 5555}`,
      `APK: ${apkPath}`,
      `Return Wi-Fi: ${opts.homeSsid ?? "detect current network when started"}`,
      "Requirement: connect to the Control Hub once manually so its Wi-Fi profile is saved.",
    ].join("\n");
  }
  if ((platform === "macos") !== (process.platform === "darwin") || (platform === "windows") !== (process.platform === "win32")) {
    throw new ToolError(`Cannot run a ${platform} Wi-Fi switch on ${process.platform}.`);
  }
  const current = await detectWifi(platform);
  const homeSsid = opts.homeSsid?.trim() || current.ssid;
  if (homeSsid === opts.robotSsid.trim()) throw new ToolError("The computer is already on the robot Wi-Fi. Connect to the internet Wi-Fi before starting this job.");
  const buildOptions: BuildOptions = { clean: opts.clean, timeoutSeconds: opts.timeoutSeconds, stacktrace: opts.stacktrace };
  const build = await buildProject(project, buildOptions);
  const id = `wifi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const job: WifiDeployJob = {
    id, createdAt: now, updatedAt: now, stage: "queued", platform,
    robotSsid: opts.robotSsid.trim(), homeSsid, robotHost: opts.robotHost ?? "192.168.43.1",
    robotPort: opts.robotPort ?? 5555, apkPath, wifiDevice: current.device,
    delaySeconds: Math.max(5, Math.min(opts.delaySeconds ?? 10, 30)),
    messages: ["Build completed while internet was available. Wi-Fi switch queued."],
  };
  writeJob(job);
  const workerEntry = fileURLToPath(new URL("./index.js", import.meta.url));
  const child = spawn(process.execPath, [workerEntry, "__wifi-deploy-worker", id], { detached: true, stdio: "ignore", env: process.env });
  child.unref();
  return [
    build,
    "",
    `Wi-Fi deployment job started: ${id}`,
    `The computer will switch to ${job.robotSsid} in ${job.delaySeconds} seconds, deploy locally, and return to ${job.homeSsid}.`,
    `The AI connection may pause briefly. After internet returns, call wifi_deploy_status with jobId "${id}".`,
  ].join("\n");
}

export function wifiDeployStatus(jobId?: string): string {
  mkdirSync(JOBS_DIR, { recursive: true });
  const id = jobId ?? readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => statSync(join(JOBS_DIR, b)).mtimeMs - statSync(join(JOBS_DIR, a)).mtimeMs)[0]?.replace(/\.json$/, "");
  if (!id) throw new ToolError("No Wi-Fi deployment jobs found. Start one with wifi_deploy_start.");
  const job = readJob(id);
  return [
    `Wi-Fi deployment ${job.id}: ${job.stage.toUpperCase()}`,
    `Robot: ${job.robotSsid} (${job.robotHost}:${job.robotPort})`,
    `Return network: ${job.homeSsid}`,
    `Updated: ${job.updatedAt}`,
    "",
    ...job.messages.map((message) => `- ${message}`),
  ].join("\n");
}
