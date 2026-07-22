import {
  type Assessment,
  assessmentId,
  type BoardProjection,
  type Capability,
  type ComparisonSubject,
  createMutationFactory,
  FACET_TAG,
  type FeatureArea,
  type ImportMetadata,
  importedEntityId,
  importedThreadId,
  KINDS,
  orderKeyBetween,
  type ThreadStateValue,
} from "@facet/protocol";
import { CommentFactory, ReactionFactory } from "applesauce-common/factories";
import type { EventSigner } from "applesauce-core/factories";
import type { NostrEvent } from "nostr-tools";
import type { ImportedMatrix, ImportReport, ImportWarning, OutlineComment } from "./types";

export type OutlineImportInput = {
  matrix: ImportedMatrix;
  comments: OutlineComment[];
  board: BoardProjection;
  signer: EventSigner;
  relayUrl: string;
  markdownHash: string;
  apiHash: string;
  capturedAt: string;
  documentId: string;
  exportSourceName: string;
  apiDocumentTitle?: string;
};

export async function buildOutlineImport(
  input: OutlineImportInput,
): Promise<{ events: NostrEvent[]; report: ImportReport }> {
  if (!input.board.board) throw new Error("The target board does not exist.");
  const events: NostrEvent[] = [];
  const warnings: ImportWarning[] = [...input.matrix.warnings];
  if (
    input.apiDocumentTitle &&
    normalize(input.apiDocumentTitle) !== normalize(input.matrix.title)
  ) {
    warnings.push({
      code: "source_disagreement",
      sourceId: input.documentId,
      message: `Markdown title "${input.matrix.title}" differs from API title "${input.apiDocumentTitle}".`,
    });
  }
  const signer = input.signer;
  const baseTime = Math.floor(Date.now() / 1000);
  const boardId = input.board.boardId;
  const subjectByName = new Map(
    [...input.board.subjects.values()].map(({ value }) => [normalize(value.name), value]),
  );
  const subjectIds = new Map<string, string>();
  let subjectOrder =
    [...input.board.subjects.values()]
      .map(({ value }) => value.orderKey)
      .sort()
      .at(-1) ?? null;

  for (const subjectName of unique([
    ...input.matrix.subjects,
    "macOS",
    "iOS",
    "Android",
    "Linux",
  ])) {
    const existing = subjectByName.get(normalize(subjectName));
    if (existing) {
      subjectIds.set(normalize(subjectName), existing.id);
      continue;
    }
    const id = importedEntityId("outline-subject", subjectName);
    subjectOrder = orderKeyBetween(subjectOrder, null);
    const value: ComparisonSubject = {
      id,
      boardId,
      name: subjectName,
      orderKey: subjectOrder,
      state: "active",
      includeInGapAnalysis: true,
      locked: false,
    };
    events.push(
      await createMutationFactory({
        kind: KINDS.subject,
        operation: "create",
        entityId: id,
        value,
        importMetadata: metadata("outline", `subject:${subjectName}`),
        relayUrl: input.relayUrl,
        createdAt: baseTime,
      }).sign(signer),
    );
    subjectIds.set(normalize(subjectName), id);
  }

  const capabilityEvents = new Map<string, NostrEvent>();
  const capabilityValues = new Map<string, Capability>();
  let areaOrder: string | null = null;
  for (const [areaIndex, importedArea] of input.matrix.featureAreas.entries()) {
    const areaId = importedEntityId("outline-area", importedArea.sourceId);
    areaOrder = orderKeyBetween(areaOrder, null);
    const area: FeatureArea = {
      id: areaId,
      boardId,
      title: importedArea.title,
      ...(importedArea.description ? { description: importedArea.description } : {}),
      orderKey: areaOrder,
      state: "active",
    };
    events.push(
      await createMutationFactory({
        kind: KINDS.featureArea,
        operation: "create",
        entityId: areaId,
        value: area,
        importMetadata: metadata("outline", importedArea.sourceId),
        relayUrl: input.relayUrl,
        createdAt: baseTime + 1,
      }).sign(signer),
    );
    let capabilityOrder: string | null = null;
    for (const importedCapability of importedArea.capabilities) {
      const capabilityId = importedEntityId("outline-capability", importedCapability.sourceId);
      capabilityOrder = orderKeyBetween(capabilityOrder, null);
      const capability: Capability = {
        id: capabilityId,
        boardId,
        featureAreaId: areaId,
        title: importedCapability.title,
        ...(importedCapability.description ? { description: importedCapability.description } : {}),
        orderKey: capabilityOrder,
        state: "active",
        desiredOutcome: importedCapability.desiredOutcome,
        decisionStatus: importedCapability.decisionStatus,
        priority: importedCapability.priority,
        links: importedCapability.links,
      };
      const event = await createMutationFactory({
        kind: KINDS.capability,
        operation: "create",
        entityId: capabilityId,
        value: capability,
        importMetadata: metadata("outline", importedCapability.sourceId),
        relayUrl: input.relayUrl,
        createdAt: baseTime + 2,
      }).sign(signer);
      events.push(event);
      capabilityEvents.set(importedCapability.sourceId, event);
      capabilityValues.set(importedCapability.sourceId, capability);

      for (const [subjectName, status] of Object.entries(importedCapability.assessments)) {
        const subjectId = subjectIds.get(normalize(subjectName));
        if (!subjectId) {
          warnings.push({
            code: "ambiguous_status",
            sourceId: importedCapability.sourceId,
            message: `Assessment column has no subject: ${subjectName}`,
          });
          continue;
        }
        const id = assessmentId(boardId, capabilityId, subjectId);
        const assessment: Assessment = {
          id,
          boardId,
          featureAreaId: areaId,
          capabilityId,
          subjectId,
          status,
          state: "active",
        };
        events.push(
          await createMutationFactory({
            kind: KINDS.assessment,
            operation: "create",
            entityId: id,
            value: assessment,
            importMetadata: metadata("outline", `${importedCapability.sourceId}:${subjectName}`),
            relayUrl: input.relayUrl,
            createdAt: baseTime + 3,
          }).sign(signer),
        );
      }
    }
    if (areaIndex > 500) throw new Error("Refusing implausibly large Outline export.");
  }

  const commentEvents = new Map<string, NostrEvent>();
  const rootByCommentId = new Map<string, string>();
  const commentById = new Map(input.comments.map((comment) => [comment.id, comment]));
  const sortedComments = sortComments(input.comments);
  for (const comment of sortedComments) {
    const matched = matchCapability(comment, input.matrix);
    if (!matched) {
      warnings.push({
        code: "orphan_comment",
        sourceId: comment.id,
        message: `Could not match comment anchor to a capability: ${comment.anchorText ?? "no anchor"}`,
      });
      continue;
    }
    const capability = capabilityValues.get(matched.sourceId)!;
    const capabilityEvent = capabilityEvents.get(matched.sourceId)!;
    const depth = commentDepth(comment, commentById);
    const directParent = comment.parentCommentId
      ? commentEvents.get(comment.parentCommentId)
      : undefined;
    const rootSourceId = comment.parentCommentId
      ? (rootByCommentId.get(comment.parentCommentId) ?? comment.parentCommentId)
      : comment.id;
    const rootEvent = commentEvents.get(rootSourceId);
    const parent = depth > 1 ? rootEvent : directParent;
    if (depth > 1)
      warnings.push({
        code: "flattened_reply",
        sourceId: comment.id,
        message: `Flattened reply depth ${depth} to one level.`,
      });
    const threadId = importedThreadId(rootSourceId);
    const body = comment.attachmentOnly
      ? "[Attachment omitted during Outline migration]"
      : comment.text;
    if (comment.attachmentOnly)
      warnings.push({
        code: "attachment_omitted",
        sourceId: comment.id,
        message: "Attachment-only comment replaced by a neutral placeholder.",
      });
    const factory = CommentFactory.create(parent ?? capabilityEvent, body)
      .created(baseTime + (parent ? 5 : 4))
      .modifyPublicTags((tags) => [
        ...tags,
        ["-"],
        ["b", boardId],
        ["f", capability.featureAreaId],
        ["c", capability.id],
        ["x", threadId],
        ["i", comment.id],
        ["t", FACET_TAG],
        ["t", "imported-outline"],
        ["t", "target:capability"],
        ["source", "outline", comment.id, comment.authorName, comment.createdAt],
      ]);
    const event = await factory.sign(signer);
    events.push(event);
    commentEvents.set(comment.id, event);
    rootByCommentId.set(comment.id, rootSourceId);

    if (comment.resolvedAt && !parent) {
      const value: ThreadStateValue = {
        id: threadId,
        boardId,
        capabilityId: capability.id,
        rootCommentId: event.id,
        state: "resolved",
      };
      events.push(
        await createMutationFactory({
          kind: KINDS.threadState,
          operation: "resolve",
          entityId: threadId,
          value,
          importMetadata: metadata("outline", `resolved:${comment.id}`, comment),
          relayUrl: input.relayUrl,
          createdAt: baseTime + 6,
        }).sign(signer),
      );
    }

    for (const [reactionIndex, reaction] of comment.reactions.entries()) {
      events.push(
        await ReactionFactory.create(event, reaction.emoji)
          .created(baseTime + 7)
          .modifyPublicTags((tags) => [
            ...tags,
            ["-"],
            ["b", boardId],
            ["f", capability.featureAreaId],
            ["c", capability.id],
            ["i", `${comment.id}:reaction:${reactionIndex}`],
            ["t", FACET_TAG],
            ["t", "imported-outline"],
            ["source", "outline-reaction", reaction.userName ?? "Unknown Outline user"],
          ])
          .sign(signer),
      );
    }
  }

  return {
    events,
    report: {
      importerVersion: "facet-importer/0.1.0",
      source: "outline",
      capturedAt: input.capturedAt,
      sourceDetails: {
        documentId: input.documentId,
        exportSource: input.exportSourceName,
        ...(input.apiDocumentTitle ? { apiDocumentTitle: input.apiDocumentTitle } : {}),
      },
      sourceHashes: { markdown: input.markdownHash, api: input.apiHash },
      sourceCounts: {
        featureAreas: input.matrix.featureAreas.length,
        capabilities: input.matrix.featureAreas.reduce(
          (sum, area) => sum + area.capabilities.length,
          0,
        ),
        comments: input.comments.length,
        reactions: input.comments.reduce((sum, comment) => sum + comment.reactions.length, 0),
      },
      importedCounts: countKinds(events),
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
      note: "One-time Outline snapshot. Changes made in Outline after capturedAt are intentionally excluded.",
    },
  };
}

function metadata(source: "outline", sourceId: string, comment?: OutlineComment): ImportMetadata {
  return {
    source,
    sourceId,
    ...(comment
      ? {
          originalAuthorName: comment.authorName,
          originalCreatedAt: comment.createdAt,
          ...(comment.parentCommentId ? { originalParentId: comment.parentCommentId } : {}),
        }
      : {}),
  };
}

function matchCapability(comment: OutlineComment, matrix: ImportedMatrix) {
  const anchor = normalize(`${comment.anchorText ?? ""} ${comment.text}`);
  const capabilities = matrix.featureAreas.flatMap((area) => area.capabilities);
  return capabilities.find((capability) => anchor.includes(normalize(capability.title)));
}

function sortComments(comments: OutlineComment[]): OutlineComment[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  return [...comments].sort(
    (a, b) =>
      commentDepth(a, byId) - commentDepth(b, byId) || a.createdAt.localeCompare(b.createdAt),
  );
}

function commentDepth(comment: OutlineComment, byId: Map<string, OutlineComment>): number {
  let depth = 0;
  let current = comment;
  const visited = new Set<string>();
  while (current.parentCommentId && !visited.has(current.parentCommentId)) {
    visited.add(current.parentCommentId);
    const parent = byId.get(current.parentCommentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

function countKinds(events: NostrEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[String(event.kind)] = (counts[String(event.kind)] ?? 0) + 1;
  return counts;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}
