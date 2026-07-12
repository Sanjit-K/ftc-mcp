import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./exec.js";
import { REFS_DIR, refsPresent } from "./paths.js";

const SDK_REPO = "https://github.com/FIRST-Tech-Challenge/FtcRobotController";
const DOCS_REPO = "https://github.com/Pedro-Pathing/Docs";

async function clone(url: string, dest: string, label: string): Promise<void> {
  if (existsSync(dest)) {
    console.error(`✓ ${label} already present (${dest})`);
    return;
  }
  console.error(`↓ Cloning ${label} …`);
  const res = await run("git", ["clone", "--depth", "1", url, dest], { timeoutMs: 300_000 });
  if (res.code !== 0) {
    throw new Error(
      `Failed to clone ${label}: ${res.stderr || res.stdout}\n` +
        `Is git installed and online? You can also clone manually into ${dest}.`
    );
  }
  console.error(`✓ ${label} ready`);
}

/**
 * Fetch the reference material the knowledge tools read (official FTC SDK
 * samples + Pedro Pathing docs) into REFS_DIR. Idempotent.
 */
export async function runSetup(): Promise<void> {
  mkdirSync(REFS_DIR, { recursive: true });
  console.error(`Setting up ftc-mcp reference material in ${REFS_DIR}`);
  await clone(SDK_REPO, join(REFS_DIR, "FtcRobotController"), "FTC SDK samples");
  await clone(DOCS_REPO, join(REFS_DIR, "PedroDocs"), "Pedro Pathing docs");
  console.error(
    refsPresent()
      ? "\n✓ Setup complete. The knowledge tools (list_samples, search_docs, …) are ready."
      : "\n⚠ Setup finished but reference paths are still missing — check the clone output above."
  );
}
