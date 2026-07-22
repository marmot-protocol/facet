import { createHash } from "node:crypto";
import {
  type Assessment,
  assessmentId,
  type BoardProjection,
  type ComparisonSubject,
  createMutationFactory,
  importedEntityId,
  KINDS,
  orderKeyBetween,
} from "@facet/protocol";
import type { EventSigner } from "applesauce-core/factories";
import type { NostrEvent } from "nostr-tools";
import { z } from "zod";
import type { ImportReport, ImportWarning } from "./types";

export const FLUTTER_RELEASE_TAG = "v2026.5.22+25";
export const FLUTTER_COMMIT = "2c16c5b0b384d52c660fbdea11922aceeb01ff74";

const evidenceSchema = z.object({
  path: z.string().min(1),
  contains: z.string().min(1).optional(),
});

const mappingSchema = z.object({
  capabilities: z.array(
    z
      .object({
        capabilityId: z.string().optional(),
        capabilityTitle: z.string().optional(),
        status: z.enum([
          "unknown",
          "not_implemented",
          "partial",
          "implemented",
          "stub_or_broken",
          "not_applicable",
        ]),
        note: z.string().optional(),
        evidence: z.array(evidenceSchema).min(1),
      })
      .refine(
        (value) => Boolean(value.capabilityId || value.capabilityTitle),
        "capabilityId or capabilityTitle is required",
      ),
  ),
});

export async function inspectFlutterRepository(
  repoPath: string,
): Promise<{ files: string[]; sourceHash: string }> {
  const resolved = runGit(repoPath, ["rev-parse", `${FLUTTER_RELEASE_TAG}^{commit}`]).trim();
  if (resolved !== FLUTTER_COMMIT)
    throw new Error(`Flutter tag resolved to ${resolved}, expected ${FLUTTER_COMMIT}.`);
  const files = runGit(repoPath, ["ls-tree", "-r", "--name-only", FLUTTER_COMMIT])
    .split(/\r?\n/u)
    .filter((path) => path.endsWith(".dart"));
  const sourceHash = createHash("sha256").update(files.join("\n")).digest("hex");
  return { files, sourceHash };
}

export async function buildFlutterImport(input: {
  repoPath: string;
  mapping: unknown;
  board: BoardProjection;
  signer: EventSigner;
  relayUrl: string;
  capturedAt: string;
}): Promise<{ events: NostrEvent[]; report: ImportReport }> {
  const parsed = mappingSchema.parse(input.mapping);
  const inspection = await inspectFlutterRepository(input.repoPath);
  const warnings: ImportWarning[] = [];
  const events: NostrEvent[] = [];
  const baseTime = Math.floor(Date.now() / 1000);
  let flutter = [...input.board.subjects.values()]
    .map(({ value }) => value)
    .find((subject) => normalize(subject.name) === "flutter");
  if (!flutter) {
    const previous =
      [...input.board.subjects.values()]
        .map(({ value }) => value.orderKey)
        .sort()
        .at(-1) ?? null;
    flutter = {
      id: importedEntityId("flutter-subject", FLUTTER_COMMIT),
      boardId: input.board.boardId,
      name: "Flutter",
      description: `Historical White Noise Flutter release ${FLUTTER_RELEASE_TAG} (${FLUTTER_COMMIT}).`,
      orderKey: orderKeyBetween(previous, null),
      state: "historical",
      includeInGapAnalysis: false,
      locked: true,
    } satisfies ComparisonSubject;
    events.push(
      await createMutationFactory({
        kind: KINDS.subject,
        operation: "create",
        entityId: flutter.id,
        value: flutter,
        importMetadata: { source: "flutter", sourceId: FLUTTER_COMMIT },
        relayUrl: input.relayUrl,
        createdAt: baseTime,
      }).sign(input.signer),
    );
  }

  const capabilities = [...input.board.capabilities.values()].map(({ value }) => value);
  for (const item of parsed.capabilities) {
    const capability = item.capabilityId
      ? capabilities.find((value) => value.id === item.capabilityId)
      : capabilities.find(
          (value) => normalize(value.title) === normalize(item.capabilityTitle ?? ""),
        );
    if (!capability) {
      warnings.push({
        code: "missing_evidence",
        sourceId: item.capabilityId ?? item.capabilityTitle ?? "unknown",
        message: "Mapping references an unknown Facet capability.",
      });
      continue;
    }
    const evidenceNotes: string[] = [];
    let concrete = true;
    for (const evidence of item.evidence) {
      if (!inspection.files.includes(evidence.path)) {
        concrete = false;
        evidenceNotes.push(`missing path ${evidence.path}`);
        continue;
      }
      const content = runGit(input.repoPath, ["show", `${FLUTTER_COMMIT}:${evidence.path}`]);
      if (evidence.contains && !content.includes(evidence.contains)) {
        concrete = false;
        evidenceNotes.push(`missing text in ${evidence.path}: ${evidence.contains}`);
      } else {
        evidenceNotes.push(
          `${evidence.path}${evidence.contains ? ` contains ${evidence.contains}` : ""}`,
        );
      }
    }
    if (!concrete && item.status !== "unknown") {
      warnings.push({
        code: "missing_evidence",
        sourceId: capability.id,
        message: `Refused ${item.status}; ${evidenceNotes.join("; ")}.`,
      });
      continue;
    }
    const id = assessmentId(input.board.boardId, capability.id, flutter.id);
    const value: Assessment = {
      id,
      boardId: input.board.boardId,
      featureAreaId: capability.featureAreaId,
      capabilityId: capability.id,
      subjectId: flutter.id,
      status: item.status,
      note: [item.note, `Evidence at ${FLUTTER_RELEASE_TAG}: ${evidenceNotes.join("; ")}`]
        .filter(Boolean)
        .join("\n"),
      state: "active",
    };
    events.push(
      await createMutationFactory({
        kind: KINDS.assessment,
        operation: "create",
        entityId: id,
        value,
        importMetadata: { source: "flutter", sourceId: `${FLUTTER_COMMIT}:${capability.id}` },
        relayUrl: input.relayUrl,
        createdAt: baseTime + 1,
      }).sign(input.signer),
    );
  }

  return {
    events,
    report: {
      importerVersion: "facet-importer/0.1.0",
      source: "flutter",
      capturedAt: input.capturedAt,
      sourceDetails: {
        release: FLUTTER_RELEASE_TAG,
        commit: FLUTTER_COMMIT,
        repository: input.repoPath,
      },
      sourceHashes: { commit: FLUTTER_COMMIT, dartInventory: inspection.sourceHash },
      sourceCounts: { dartFiles: inspection.files.length, mappings: parsed.capabilities.length },
      importedCounts: {
        subjects: events.filter((event) => event.kind === KINDS.subject).length,
        assessments: events.filter((event) => event.kind === KINDS.assessment).length,
      },
      skippedExisting: 0,
      verification: {
        expectedEvents: events.length,
        expectedImportKeys: 0,
        pendingEvents: events.length,
        existingImportKeys: 0,
        preflight: "not_run",
        postPublish: "not_requested",
        verifiedImportKeys: 0,
        projectedCounts: {},
      },
      warnings,
      note: "Historical Flutter evidence is locked and excluded from gap analysis. Ambiguous or unproven statuses remain unknown.",
    },
  };
}

function runGit(repoPath: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ");
}
