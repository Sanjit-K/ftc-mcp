import { networkInterfaces, platform as hostPlatform } from "node:os";
import { createConnection } from "node:net";

export type SetupPlatform = "macos" | "windows";
export type InternetMethod = "usb-tether" | "bluetooth-tether" | "wifi-client-bridge";

function detectedPlatform(): SetupPlatform {
  return hostPlatform() === "win32" ? "windows" : "macos";
}

export function dualNetworkGuide(opts: {
  platform?: SetupPlatform;
  method?: InternetMethod;
  robotHost?: string;
  robotPort?: number;
}): string {
  const platform = opts.platform ?? detectedPlatform();
  const method = opts.method ?? "usb-tether";
  const host = opts.robotHost ?? "192.168.43.1";
  const port = opts.robotPort ?? 5555;
  const methodSteps: Record<InternetMethod, string[]> = {
    "usb-tether": platform === "windows"
      ? [
          "Connect the phone to the PC by USB and enable USB tethering / Personal Hotspot.",
          "For iPhone on Windows, install the current Apple Devices app or iTunes so the USB network adapter is available.",
          "Keep the PC's Wi-Fi connected to the Control Hub network.",
        ]
      : [
          "Connect the phone to the Mac by USB, enable Personal Hotspot, and approve Trust/Allow prompts.",
          "Keep the Mac's Wi-Fi connected to the Control Hub network.",
        ],
    "bluetooth-tether": [
      "Pair the phone and computer over Bluetooth, enable the phone's Bluetooth hotspot/tethering, and join its Bluetooth PAN.",
      "Keep the computer's Wi-Fi connected to the Control Hub network.",
      "Bluetooth is cable-free but slower and less reliable than USB tethering.",
    ],
    "wifi-client-bridge": [
      "Configure a travel router or extender in client mode so it joins the home Wi-Fi.",
      "Connect its Ethernet port to the computer with a short cable/adapter.",
      "Keep the computer's Wi-Fi connected to the Control Hub network.",
    ],
  };
  const checks = platform === "windows"
    ? [
        `Test-NetConnection ${host} -Port ${port}`,
        "Test-NetConnection api.openai.com -Port 443",
        "Get-NetIPInterface -AddressFamily IPv4 | Sort-Object InterfaceMetric",
      ]
    : [
        "route -n get default",
        `route -n get ${host}`,
        `nc -vz ${host} ${port}`,
        "nc -vz api.openai.com 443",
      ];
  return [
    `# Dual-network setup (${platform}, ${method})`,
    "Goal: internet uses the phone/home bridge while the directly connected robot subnet uses Wi-Fi.",
    "",
    ...methodSteps[method].map((step, index) => `${index + 1}. ${step}`),
    `${methodSteps[method].length + 1}. Verify both paths with the commands below.`,
    `${methodSteps[method].length + 2}. Connect ADB with: adb connect ${host}:${port}`,
    "",
    "Checks:",
    ...checks.map((command) => `- ${command}`),
    "",
    `ftc-mcp: call network_diagnostics, then adb_connect with host ${host} and port ${port}.`,
    "If internet fails while robot ADB works, lower the route/interface metric for the tether or Ethernet interface; do not bridge or modify the Control Hub network.",
    "Development only: disconnect programming computers and auxiliary wireless equipment before a match, following the current FTC competition manual.",
  ].join("\n");
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; elapsedMs: number; error?: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, elapsedMs: Date.now() - started, error });
    };
    socket.setTimeout(timeoutMs, () => finish(false, "timed out"));
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(false, error.message));
  });
}

export async function networkDiagnostics(opts: {
  robotHost?: string;
  robotPort?: number;
  checkInternet?: boolean;
  internetHost?: string;
  timeoutMs?: number;
}): Promise<string> {
  const robotHost = opts.robotHost ?? "192.168.43.1";
  const robotPort = opts.robotPort ?? 5555;
  const internetHost = opts.internetHost ?? "api.openai.com";
  const timeoutMs = Math.max(250, Math.min(opts.timeoutMs ?? 3_000, 10_000));
  const [robot, internet] = await Promise.all([
    tcpProbe(robotHost, robotPort, timeoutMs),
    opts.checkInternet === false ? Promise.resolve(null) : tcpProbe(internetHost, 443, timeoutMs),
  ]);
  const interfaces = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => `${name}: ${address.address}/${address.netmask}`)
  );
  const simultaneous = robot.ok && (internet?.ok ?? true);
  return [
    `Dual-network diagnostic: ${simultaneous ? "PASS" : "ATTENTION NEEDED"}`,
    `Robot ADB ${robotHost}:${robotPort}: ${robot.ok ? `reachable (${robot.elapsedMs}ms)` : `unreachable — ${robot.error}`}`,
    ...(internet ? [`Internet ${internetHost}:443: ${internet.ok ? `reachable (${internet.elapsedMs}ms)` : `unreachable — ${internet.error}`}`] : []),
    "",
    "Active IPv4 interfaces:",
    ...(interfaces.length ? interfaces.map((line) => `- ${line}`) : ["- none detected"]),
    "",
    simultaneous
      ? `Both paths are available. Run adb_connect with host ${robotHost} and port ${robotPort}, then build_and_deploy.`
      : !robot.ok
        ? "Robot path is unavailable. Join the Control Hub Wi-Fi and verify its Program & Manage page before retrying."
        : "Robot ADB works but internet does not. Enable USB/Bluetooth tethering or a Wi-Fi client bridge and make that interface the preferred default route.",
  ].join("\n");
}
