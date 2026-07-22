import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { KINDS } from "@facet/protocol";
import type { NostrEvent } from "nostr-tools";

export async function loadSeedEvents(): Promise<NostrEvent[]> {
  const seedFile = process.env.FACET_POLICY_SEED_FILE;
  if (seedFile) return parseJsonLines(await readFile(seedFile, "utf8"));

  const binary = process.env.FACET_STRFRY_BIN;
  if (binary) {
    const filter = JSON.stringify({
      kinds: [
        KINDS.deployment,
        KINDS.board,
        KINDS.membership,
        KINDS.subject,
        KINDS.featureArea,
        KINDS.capability,
        KINDS.assessment,
        KINDS.threadState,
        KINDS.comment,
        KINDS.commentEdit,
        KINDS.reaction,
        KINDS.deletion,
      ],
    });
    const processResult = spawnSync(binary, ["scan", filter], {
      ...(process.env.FACET_STRFRY_DIR ? { cwd: process.env.FACET_STRFRY_DIR } : {}),
      encoding: "utf8",
      env: process.env,
    });
    if (processResult.error) {
      throw new Error(`strfry seed scan failed: ${processResult.error.message}`);
    }
    if (processResult.status !== 0) {
      throw new Error(`strfry seed scan failed: ${processResult.stderr}`);
    }
    return parseJsonLines(processResult.stdout);
  }

  if (process.env.FACET_ALLOW_EMPTY_SEED === "true") return [];
  throw new Error(
    "Set FACET_STRFRY_BIN or FACET_POLICY_SEED_FILE. Set FACET_ALLOW_EMPTY_SEED=true only for a verified-empty first deployment.",
  );
}

function parseJsonLines(input: string): NostrEvent[] {
  return input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as NostrEvent;
      } catch (error) {
        throw new Error(`Invalid seed JSON on line ${index + 1}: ${String(error)}`);
      }
    });
}
