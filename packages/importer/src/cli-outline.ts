#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { projectBoard } from "@facet/protocol";
import { PrivateKeySigner } from "applesauce-signers";
import { parseOutlineMatrix, readOutlineMarkdown } from "./markdown";
import { OutlineApi } from "./outline-api";
import { buildOutlineImport } from "./outline-import";
import { createImportPublicationPlan, loadBoardEvents, publishImportEvents } from "./publisher";
import { writeReport } from "./report";
import { verifyImportProjection } from "./verification";

const { values } = parseArgs({
  options: {
    export: { type: "string", short: "e" },
    "board-id": { type: "string" },
    relay: { type: "string" },
    "outline-url": { type: "string" },
    "document-id": { type: "string" },
    output: { type: "string", default: "packages/importer/output/outline-import" },
    publish: { type: "boolean", default: false },
    "allow-warnings": { type: "boolean", default: false },
  },
  strict: true,
});

const exportPath = required(values.export, "--export");
const boardId = required(values["board-id"], "--board-id");
const relayUrl = required(
  values.relay ?? process.env.FACET_RELAY_URL,
  "--relay or FACET_RELAY_URL",
);
const outlineUrl = required(
  values["outline-url"] ?? process.env.OUTLINE_BASE_URL,
  "--outline-url or OUTLINE_BASE_URL",
);
const documentId = required(
  values["document-id"] ?? process.env.OUTLINE_DOCUMENT_ID,
  "--document-id or OUTLINE_DOCUMENT_ID",
);
const token = required(process.env.OUTLINE_API_TOKEN, "OUTLINE_API_TOKEN");
const key = required(
  process.env.FACET_IMPORTER_KEY,
  "FACET_IMPORTER_KEY (hex or nsec, injected by a secret manager)",
);
const outputBase = values.output!;

const signer = PrivateKeySigner.fromKey(key);
const importerPubkey = await signer.getPublicKey();
const outline = new OutlineApi(outlineUrl, token);
const capturedAt = new Date().toISOString();
const [{ markdown, hash: markdownHash, sourceName }, document, comments, boardEvents] =
  await Promise.all([
    readOutlineMarkdown(exportPath),
    outline.document(documentId),
    outline.comments(documentId),
    loadBoardEvents(relayUrl, boardId),
  ]);
const matrix = parseOutlineMatrix(markdown);
const apiSnapshot = JSON.stringify({ document, comments });
const apiHash = createHash("sha256").update(apiSnapshot).digest("hex");
const board = projectBoard(boardEvents, boardId, { importerPubkeys: [importerPubkey] });
if (!board.board) throw new Error(`Board ${boardId} was not found or is not valid.`);

const result = await buildOutlineImport({
  matrix,
  comments,
  board,
  signer,
  relayUrl,
  markdownHash,
  apiHash,
  capturedAt,
  documentId,
  exportSourceName: sourceName,
  ...(typeof document.title === "string" ? { apiDocumentTitle: document.title } : {}),
});
const publicationPlan = await createImportPublicationPlan({
  relayUrl,
  signer,
  events: result.events,
  source: "outline",
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
  Bun.write(
    `${outputBase}.outline-api.json`,
    `${JSON.stringify({ capturedAt, document, comments }, null, 2)}\n`,
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
    source: "outline",
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
      sourceName,
      featureAreas: matrix.featureAreas.length,
      capabilities: matrix.featureAreas.reduce((sum, area) => sum + area.capabilities.length, 0),
      comments: comments.length,
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
