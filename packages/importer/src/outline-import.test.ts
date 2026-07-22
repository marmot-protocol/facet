import { type Board, getTag, KINDS, projectBoard } from "@facet/protocol";
import { createTestIdentity, signMutation } from "@facet/protocol/testing";
import { PrivateKeySigner } from "applesauce-signers";
import { describe, expect, it } from "vitest";
import { buildOutlineImport } from "./outline-import";
import { importKey } from "./publisher";
import type { ImportedMatrix, OutlineComment } from "./types";
import { verifyImportProjection } from "./verification";

describe("Outline import builder", () => {
  it("creates a valid signed and replayable imported board snapshot", async () => {
    const superAdmin = createTestIdentity();
    const importer = new PrivateKeySigner();
    const importerPubkey = await importer.getPublicKey();
    const board: Board = {
      id: "white-noise",
      name: "White Noise",
      visibility: "public",
      state: "active",
    };
    const bootstrap = await signMutation(superAdmin, {
      kind: KINDS.deployment,
      operation: "bootstrap",
      entityId: "deployment",
      value: { superAdminPubkey: superAdmin.pubkey },
      createdAt: 1,
    });
    const createBoard = await signMutation(superAdmin, {
      kind: KINDS.board,
      operation: "create",
      entityId: board.id,
      value: board,
      createdAt: 2,
    });
    const initial = projectBoard([bootstrap, createBoard], board.id);
    const matrix: ImportedMatrix = {
      title: "White Noise",
      subjects: ["macOS", "iOS"],
      warnings: [],
      featureAreas: [
        {
          sourceId: "messaging",
          title: "Messaging",
          capabilities: [
            {
              sourceId: "messaging:editing",
              title: "Message editing",
              assessments: { macOS: "implemented", iOS: "partial" },
              desiredOutcome: "standardize",
              decisionStatus: "decided",
              priority: "now",
              links: [],
              sourceRow: 1,
            },
          ],
        },
      ],
    };
    const comments: OutlineComment[] = [
      {
        id: "comment-1",
        text: "Message editing needs one shared behavior.",
        anchorText: "Message editing",
        createdAt: "2026-07-01T10:00:00.000Z",
        resolvedAt: "2026-07-02T10:00:00.000Z",
        authorName: "Ada",
        reactions: [{ emoji: "👍", userName: "Grace" }],
        attachmentOnly: false,
      },
      {
        id: "comment-2",
        text: "Agreed.",
        parentCommentId: "comment-1",
        anchorText: "Message editing",
        createdAt: "2026-07-01T11:00:00.000Z",
        authorName: "Grace",
        reactions: [],
        attachmentOnly: false,
      },
    ];
    const result = await buildOutlineImport({
      matrix,
      comments,
      board: initial,
      signer: importer,
      relayUrl: "wss://relay.example.com",
      markdownHash: "a".repeat(64),
      apiHash: "b".repeat(64),
      capturedAt: "2026-07-20T12:00:00.000Z",
      documentId: "document-white-noise",
      exportSourceName: "White Noise.md",
      apiDocumentTitle: "White Noise",
    });
    expect(result.events.some((event) => event.kind === KINDS.comment)).toBe(true);
    expect(result.events.some((event) => event.kind === KINDS.threadState)).toBe(true);
    expect(result.events.some((event) => event.kind === KINDS.reaction)).toBe(true);
    expect(result.events.every((event) => event.pubkey === importerPubkey)).toBe(true);
    expect(
      result.events
        .filter((event) => event.kind === KINDS.comment)
        .map((event) => getTag(event, "i")),
    ).toEqual(["comment-1", "comment-2"]);

    const projection = projectBoard([bootstrap, createBoard, ...result.events], board.id, {
      importerPubkeys: [importerPubkey],
    });
    expect(projection.invalidEvents).toEqual([]);
    expect(projection.featureAreas.size).toBe(1);
    expect(projection.capabilities.size).toBe(1);
    expect(projection.assessments.size).toBe(2);
    expect(projection.comments).toHaveLength(2);
    expect(projection.reactions).toHaveLength(1);
    expect([...projection.threadStates.values()][0]?.value.state).toBe("resolved");
    expect(result.report.sourceDetails.documentId).toBe("document-white-noise");

    const verification = verifyImportProjection({
      boardEvents: [bootstrap, createBoard],
      importEvents: result.events,
      boardId: board.id,
      importerPubkey,
    });
    expect(verification.expectedEvents).toBe(result.events.length);
    expect(verification.projectedCounts).toMatchObject({
      featureAreas: 1,
      capabilities: 1,
      assessments: 2,
      comments: 2,
      reactions: 1,
      threadStates: 1,
    });
    await expect(
      Promise.resolve().then(() =>
        verifyImportProjection({
          boardEvents: [bootstrap, createBoard],
          importEvents: [result.events[0]!, result.events[0]!],
          boardId: board.id,
          importerPubkey,
        }),
      ),
    ).rejects.toThrow("duplicate stable keys");

    const firstImportedEntity = result.events.find((event) => getTag(event, "x"));
    expect(firstImportedEntity).toBeDefined();
    expect(
      importKey({
        ...firstImportedEntity!,
        id: "f".repeat(64),
        created_at: firstImportedEntity!.created_at + 60,
      }),
    ).toBe(importKey(firstImportedEntity!));
    expect(
      importKey({
        ...firstImportedEntity!,
        tags: firstImportedEntity!.tags.map((tag) =>
          tag[0] === "b" ? ["b", "another-board"] : tag,
        ),
      }),
    ).not.toBe(importKey(firstImportedEntity!));
  });
});
