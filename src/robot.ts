import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { run, tail } from "./exec.js";
import { ToolError, resolveProject } from "./paths.js";

const RC_PACKAGE = "com.qualcomm.ftcrobotcontroller";
const RC_ACTIVITY = `${RC_PACKAGE}/org.firstinspires.ftc.robotcontroller.internal.FtcRobotControllerActivity`;
/** Control Hub's address when the laptop is joined to its WiFi AP. */
const CONTROL_HUB_IP = "192.168.43.1";

function adbPath(): string {
  if (process.env.ADB_PATH && existsSync(process.env.ADB_PATH)) return process.env.ADB_PATH;
  const defaultSdk = join(homedir(), "Library/Android/sdk/platform-tools/adb");
  if (existsSync(defaultSdk)) return defaultSdk;
  return "adb"; // rely on PATH
}

async function adb(args: string[], timeoutMs = 30_000) {
  const res = await run(adbPath(), args, { timeoutMs });
  if (res.code === null && !res.timedOut) {
    throw new ToolError(
      `Could not run adb (${res.stderr}). Install Android platform-tools or set ADB_PATH.`
    );
  }
  return res;
}

function serialArgs(serial?: string): string[] {
  return serial ? ["-s", serial] : [];
}

export async function adbDevices(): Promise<string> {
  const res = await adb(["devices", "-l"]);
  const out = res.stdout.trim();
  const lines = out.split("\n").slice(1).filter((l) => l.trim());
  if (lines.length === 0) {
    return (
      out +
      "\n\nNo devices connected. For a REV Control Hub: join its WiFi network " +
      `(default password 'password'), then run adb_connect (it lives at ${CONTROL_HUB_IP}:5555). ` +
      "For a phone-based Robot Controller: plug in USB or use adb_connect with its IP."
    );
  }
  return out;
}

export async function adbConnect(host?: string, port = 5555): Promise<string> {
  const target = `${host ?? CONTROL_HUB_IP}:${port}`;
  const res = await adb(["connect", target], 15_000);
  const combined = (res.stdout + res.stderr).trim();
  if (/connected/.test(combined) && !/cannot|failed|refused/.test(combined)) {
    return `${combined}\nDevice ready. Use build + deploy to push code, robot_logs to read logcat.`;
  }
  throw new ToolError(
    `${combined || "adb connect timed out"}\n` +
      `Checklist: is the laptop on the robot's WiFi network? Control Hub AP is ` +
      `usually "${CONTROL_HUB_IP}" — the hub's SSID/password are on the Driver Station ` +
      `(Program & Manage). For USB-connected devices just run adb_devices.`
  );
}

// ---------- Gradle build ----------

function ensureLocalProperties(project: string): string | null {
  const localProps = join(project, "local.properties");
  if (existsSync(localProps)) return null;
  const sdkDir =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    join(homedir(), "Library/Android/sdk");
  if (!existsSync(sdkDir)) {
    throw new ToolError(
      `No local.properties and no Android SDK found (looked at ANDROID_HOME, ANDROID_SDK_ROOT, ${sdkDir}). ` +
        `Install the Android SDK (e.g. via Android Studio) to build.`
    );
  }
  // Gradle's properties parser needs escaped path separators on Windows only;
  // on macOS/Linux the raw path is fine.
  writeFileSync(localProps, `sdk.dir=${sdkDir}\n`);
  return `Wrote local.properties pointing at ${sdkDir}`;
}

export async function buildProject(projectPath?: string): Promise<string> {
  const project = resolveProject(projectPath);
  const notes: string[] = [];
  const propsNote = ensureLocalProperties(project);
  if (propsNote) notes.push(propsNote);

  const gradlew = join(project, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!existsSync(gradlew)) throw new ToolError(`No gradlew wrapper in ${project}`);

  const res = await run(
    gradlew,
    ["--console=plain", ":TeamCode:assembleDebug"],
    { cwd: project, timeoutMs: 600_000 }
  );
  if (res.timedOut) throw new ToolError("Gradle build timed out after 10 minutes.");

  const output = res.stdout + "\n" + res.stderr;
  if (res.code === 0) {
    const apk = join(project, "TeamCode/build/outputs/apk/debug/TeamCode-debug.apk");
    notes.push(`BUILD SUCCESSFUL. APK: ${apk}`);
    return notes.join("\n");
  }

  // Surface just the compiler/gradle errors, not thousands of lines of log.
  const errorLines = output
    .split("\n")
    .filter(
      (l) =>
        /error:|FAILURE:|Caused by:|\.java:\d+/.test(l) ||
        /^e: /.test(l) ||
        /What went wrong/.test(l)
    )
    .slice(0, 60);
  throw new ToolError(
    `BUILD FAILED (exit ${res.code}).\n` +
      (errorLines.length ? errorLines.join("\n") : tail(output, 4000))
  );
}

// ---------- Deploy + logs ----------

export async function deploy(projectPath?: string, serial?: string): Promise<string> {
  const project = resolveProject(projectPath);
  const apk = join(project, "TeamCode/build/outputs/apk/debug/TeamCode-debug.apk");
  if (!existsSync(apk)) {
    throw new ToolError(`APK not found at ${apk}. Run the build tool first.`);
  }

  const install = await adb([...serialArgs(serial), "install", "-r", apk], 120_000);
  const installOut = (install.stdout + install.stderr).trim();
  if (install.code !== 0 || !/Success/i.test(installOut)) {
    throw new ToolError(
      `adb install failed:\n${tail(installOut, 2000)}\n` +
        `If no device is listed, run adb_connect first. If signatures mismatch ` +
        `(INSTALL_FAILED_UPDATE_INCOMPATIBLE), uninstall the existing app once: ` +
        `adb uninstall ${RC_PACKAGE} (this clears robot configs — re-pair on the Driver Station after).`
    );
  }

  // Restart the Robot Controller app so the new code is live.
  await adb([...serialArgs(serial), "shell", "am", "force-stop", RC_PACKAGE]);
  await adb([...serialArgs(serial), "shell", "am", "start", "-n", RC_ACTIVITY]);
  return (
    `Installed TeamCode-debug.apk and restarted the Robot Controller app.\n` +
    `New OpModes should now appear on the Driver Station. Give it ~10s to reconnect.`
  );
}

export async function robotLogs(opts: {
  serial?: string;
  lines?: number;
  filter?: string;
  errorsOnly?: boolean;
}): Promise<string> {
  const lines = Math.min(opts.lines ?? 300, 2000);
  const args = [...serialArgs(opts.serial), "logcat", "-d", "-t", String(lines)];
  if (opts.errorsOnly) args.push("*:E");
  const res = await adb(args, 30_000);
  if (res.code !== 0) {
    throw new ToolError(
      `logcat failed: ${res.stderr.trim() || res.stdout.trim()}\nIs a device connected? Run adb_devices.`
    );
  }
  let out = res.stdout;
  if (opts.filter) {
    const needle = opts.filter.toLowerCase();
    out = out
      .split("\n")
      .filter((l) => l.toLowerCase().includes(needle))
      .join("\n");
  }
  if (!out.trim()) return "No matching log lines.";
  return tail(out, 12_000);
}
