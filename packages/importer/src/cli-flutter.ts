#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { projectBoard } from "@facet/protocol";
import { PrivateKeySigner } from "applesauce-signers";
import { buildFlutterImport } from "./flutter-import";
import { createImportPublicationPlan, loadBoardEvents, publishImportEvents } from "./publisher";
import { writeReport } from "./report";
import { verifyImportProjection } from "./verification";

const { values } = parseArgs({
  options: {
    repo: { type: "string", default: "/Users/jeff/code/whitenoise" },
    mapping: { type: "string" },
    "board-id": { type: "string" },
    relay: { type: "string" },
    output: { type: "string", default: "packages/importer/output/flutter-import" },
    publish: { type: "boolean", default: false },
    "allow-warnings": { type: "boolean", default: false },
  },
  strict: true,
});

const mappingPath = required(values.mapping, "--mapping");
const boardId = required(values["board-id"], "--board-id");
const relayUrl = required(
  values.relay ?? process.env.FACET_RELAY_URL,
  "--relay or FACET_RELAY_URL",
);
const key = required(process.env.FACET_IMPORTER_KEY, "FACET_IMPORTER_KEY");
const outputBase = values.output!;
const signer = PrivateKeySigner.fromKey(key);
const importerPubkey = await signer.getPublicKey();
const [mapping, boardEvents] = await Promise.all([
  Bun.file(mappingPath).json(),
  loadBoardEvents(relayUrl, boardId),
]);
const board = projectBoard(boardEvents, boardId, { importerPubkeys: [importerPubkey] });
if (!board.board) throw new Error(`Board ${boardId} was not found or is not valid.`);
const result = await buildFlutterImport({
  repoPath: values.repo!,
  mapping,
  board,
  signer,
  relayUrl,
  capturedAt: new Date().toISOString(),
});
const publicationPlan = await createImportPublicationPlan({
  relayUrl,
  signer,
  events: result.events,
  source: "flutter",
});
const preflight = verifyImportProjection({
  boardEvents: [...boardEvents, ...publicationPlan.existingEvents],
  importEvents: publicationPlan.pendingEvents,
  boardId,
  importerPubkey,
});
result.report.skippedExisting = publicationPlan.skipped;
result.report.verification = {
  expectedEvents: result.events.length,
  expectedImportKeys: publicationPlan.expectedKeys.length,
  pendingEvents: publicationPlan.pendingEvents.length,
  existingImportKeys: publicationPlan.skipped,
  preflight: "passed",
  postPublish: "not_requested",
  verifiedImportKeys: publicationPlan.skipped,
  projectedCounts: preflight.projectedCounts,
};

await mkdir(dirname(outputBase), { recursive: true });
await Promise.all([
  Bun.write(
    `${outputBase}.events.jsonl`,
    `${result.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  ),
  writeReport(result.report, `${outputBase}.report`),
]);
if (values.publish) {
  if (result.report.warnings.length > 0 && !values["allow-warnings"]) {
    throw new Error(
      `Refusing to publish with ${result.report.warnings.length} warning(s). Review the report, then rerun with --allow-warnings to acknowledge them.`,
    );
  }
  const publication = await publishImportEvents({
    relayUrl,
    signer,
    events: result.events,
    source: "flutter",
    plan: publicationPlan,
  });
  result.report.skippedExisting = publication.skipped;
  result.report.importedCounts.published = publication.published;
  const postPublish = verifyImportProjection({
    boardEvents,
    importEvents: publication.verifiedEvents,
    boardId,
    importerPubkey,
  });
  result.report.verification.postPublish = "passed";
  result.report.verification.verifiedImportKeys = publicationPlan.expectedKeys.length;
  result.report.verification.projectedCounts = postPublish.projectedCounts;
  await writeReport(result.report, `${outputBase}.report`);
}
console.log(
  JSON.stringify(
    {
      events: result.events.length,
      warnings: result.report.warnings.length,
      preflight: result.report.verification.preflight,
      pendingEvents: result.report.verification.pendingEvents,
      skippedExisting: result.report.skippedExisting,
      postPublish: result.report.verification.postPublish,
      published: values.publish,
      outputBase,
    },
    null,
    2,
  ),
);

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}
