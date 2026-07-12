import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./exec.js";
import { REFS_DIR, refsPresent } from "./paths.js";
import { PEDRO_DOCS_DIR, SAMPLES_DIR, ToolError } from "./paths.js";
import { readdirSync } from "node:fs";

const SDK_REPO = "https://github.com/FIRST-Tech-Challenge/FtcRobotController";
const DOCS_REPO = "https://github.com/Pedro-Pathing/Docs";

async function clone(url: string, dest: string, label: string, update = false): Promise<string> {
  if (existsSync(dest)) {
    if (update) {
      const dirty = await run("git", ["status", "--porcelain"], { cwd: dest, timeoutMs: 10_000 });
      if (dirty.code !== 0) throw new ToolError(`${label} at ${dest} is not a readable Git checkout.`);
      if (dirty.stdout.trim()) throw new ToolError(`${label} has local changes at ${dest}; refusing to overwrite them.`);
      const pull = await run("git", ["pull", "--ff-only"], { cwd: dest, timeoutMs: 300_000 });
      if (pull.code !== 0) throw new ToolError(`Could not update ${label}: ${pull.stderr || pull.stdout}`);
      console.error(`✓ ${label} updated`);
      return `${label}: ${(pull.stdout || "updated").trim()}`;
    }
    console.error(`✓ ${label} already present (${dest})`);
    return `${label}: already present`;
  }
  console.error(`↓ Cloning ${label} …`);
  const res = await run("git", ["clone", "--depth", "1", url, dest], { timeoutMs: 300_000 });
  if (res.code !== 0) {
    throw new ToolError(
      `Failed to clone ${label}: ${res.stderr || res.stdout}\n` +
        `Is git installed and online? You can also clone manually into ${dest}.`
    );
  }
  console.error(`✓ ${label} ready`);
  return `${label}: cloned`;
}

/**
 * Fetch the reference material the knowledge tools read (official FTC SDK
 * samples + Pedro Pathing docs) into REFS_DIR. Idempotent.
 */
export async function runSetup(opts: { update?: boolean } = {}): Promise<void> {
  mkdirSync(REFS_DIR, { recursive: true });
  console.error(`Setting up ftc-toolchain reference material in ${REFS_DIR}`);
  await clone(SDK_REPO, join(REFS_DIR, "FtcRobotController"), "FTC SDK samples", opts.update);
  await clone(DOCS_REPO, join(REFS_DIR, "PedroDocs"), "Pedro Pathing docs", opts.update);
  console.error(
    refsPresent()
      ? "\n✓ Setup complete. The knowledge tools (list_samples, search_docs, …) are ready."
      : "\n⚠ Setup finished but reference paths are still missing — check the clone output above."
  );
}

async function repoStatus(path: string, label: string): Promise<string> {
  if (!existsSync(path)) return `${label}: MISSING`;
  const [head, date, branch] = await Promise.all([
    run("git", ["rev-parse", "--short", "HEAD"], { cwd: path, timeoutMs: 5_000 }),
    run("git", ["log", "-1", "--format=%cI"], { cwd: path, timeoutMs: 5_000 }),
    run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: path, timeoutMs: 5_000 }),
  ]);
  if (head.code !== 0) return `${label}: present, but Git metadata is unavailable`;
  const ageDays = date.stdout.trim() ? Math.floor((Date.now() - new Date(date.stdout.trim()).getTime()) / 86_400_000) : null;
  return `${label}: ${branch.stdout.trim()} @ ${head.stdout.trim()}${date.stdout.trim() ? ` · ${date.stdout.trim()}${ageDays !== null ? ` · ${ageDays}d old` : ""}` : ""}`;
}

export async function referenceStatus(): Promise<string> {
  const sdkRepo = join(REFS_DIR, "FtcRobotController");
  const docsRepo = join(REFS_DIR, "PedroDocs");
  const samples = existsSync(SAMPLES_DIR) ? readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".java")).length : 0;
  const countDocs = (dir: string): number => existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => n + (entry.isDirectory() ? countDocs(join(dir, entry.name)) : entry.name.endsWith(".mdx") ? 1 : 0), 0)
    : 0;
  return [
    `Reference library: ${refsPresent() ? "READY" : "INCOMPLETE"}`,
    `Location: ${REFS_DIR}`,
    `Content: ${samples} FTC samples · ${countDocs(PEDRO_DOCS_DIR)} Pedro docs`,
    await repoStatus(sdkRepo, "FTC SDK"),
    await repoStatus(docsRepo, "Pedro docs"),
    "Run update_references (or `npx ftc-toolchain setup --update`) to fast-forward clean reference checkouts.",
  ].join("\n");
}

export async function updateReferences(): Promise<string> {
  mkdirSync(REFS_DIR, { recursive: true });
  const results = await Promise.all([
    clone(SDK_REPO, join(REFS_DIR, "FtcRobotController"), "FTC SDK samples", true),
    clone(DOCS_REPO, join(REFS_DIR, "PedroDocs"), "Pedro Pathing docs", true),
  ]);
  return `Reference update complete.\n${results.map((result) => `- ${result}`).join("\n")}`;
}
