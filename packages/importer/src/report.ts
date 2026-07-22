import type { ImportReport } from "./types";

export async function writeReport(report: ImportReport, outputBase: string): Promise<void> {
  await Promise.all([
    Bun.write(`${outputBase}.json`, `${JSON.stringify(report, null, 2)}\n`),
    Bun.write(`${outputBase}.md`, reportMarkdown(report)),
  ]);
}

export function reportMarkdown(report: ImportReport): string {
  const counts = (values: Record<string, number>) =>
    Object.entries(values)
      .map(([name, count]) => `| ${name} | ${count} |`)
      .join("\n");
  const warnings = report.warnings.length
    ? report.warnings
        .map((warning) => `- **${warning.code}** (${warning.sourceId}): ${warning.message}`)
        .join("\n")
    : "- None";
  return `# ${report.source === "outline" ? "Outline" : "Flutter"} migration report

- Captured: ${report.capturedAt}
- Importer: ${report.importerVersion}
- Skipped existing events/entities: ${report.skippedExisting}
- Note: ${report.note}

## Verification

- Preflight: ${report.verification.preflight}
- Expected events: ${report.verification.expectedEvents}
- Expected stable import keys: ${report.verification.expectedImportKeys}
- Pending events: ${report.verification.pendingEvents}
- Existing stable import keys: ${report.verification.existingImportKeys}
- Post-publish: ${report.verification.postPublish}
- Verified stable import keys: ${report.verification.verifiedImportKeys}

### Projected board counts

| Type | Count |
|---|---:|
${counts(report.verification.projectedCounts)}

## Source details

${Object.entries(report.sourceDetails)
  .map(([name, value]) => `- ${name}: ${value}`)
  .join("\n")}

## Source hashes

${Object.entries(report.sourceHashes)
  .map(([name, hash]) => `- ${name}: \`${hash}\``)
  .join("\n")}

## Source counts

| Type | Count |
|---|---:|
${counts(report.sourceCounts)}

## Imported counts

| Type | Count |
|---|---:|
${counts(report.importedCounts)}

## Warnings

${warnings}
`;
}
