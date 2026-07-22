#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { FacetWritePolicy, type StrfryPluginRequest } from "./policy";
import { loadSeedEvents } from "./seed";

async function main(): Promise<void> {
  const legacyImporterPubkeys = parseList(process.env.FACET_IMPORTER_PUBKEYS);
  const importerPubkeys =
    process.env.FACET_TRUSTED_IMPORTER_PUBKEYS === undefined
      ? legacyImporterPubkeys
      : parseList(process.env.FACET_TRUSTED_IMPORTER_PUBKEYS);
  const activeImporterPubkeys =
    process.env.FACET_ACTIVE_IMPORTER_PUBKEYS === undefined
      ? legacyImporterPubkeys
      : parseList(process.env.FACET_ACTIVE_IMPORTER_PUBKEYS);

  const policy = new FacetWritePolicy({
    importerPubkeys,
    activeImporterPubkeys,
    maxClockSkewSeconds: parseInteger(process.env.FACET_MAX_CLOCK_SKEW_SECONDS, 300),
    requireNip42: process.env.FACET_REQUIRE_NIP42 !== "false",
    allowOtherEvents: process.env.FACET_ALLOW_OTHER_EVENTS === "true",
  });

  const seed = await loadSeedEvents();
  policy.replay(seed);
  console.error(`[facet-policy] replayed ${seed.length} stored event(s)`);

  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    try {
      const request = JSON.parse(line) as StrfryPluginRequest;
      console.log(JSON.stringify(policy.evaluate(request)));
    } catch (error) {
      console.error(`[facet-policy] malformed request: ${String(error)}`);
    }
  });
}

void main().catch((error) => {
  console.error(`[facet-policy] startup failed: ${String(error)}`);
  process.exitCode = 1;
});

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
