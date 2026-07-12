import { spawn } from "node:child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}

/** Keep only the last `max` characters, noting truncation. */
export function tail(text: string, max = 8000): string {
  if (text.length <= max) return text;
  return `…(truncated ${text.length - max} chars)…\n` + text.slice(-max);
}
