import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  COMMENT_CREATED_AT_TAG,
  COMMENT_ROOT_TAG,
  DELETED_COMMENT_TAG,
  DELETED_EDIT_TAG,
  FACET_DELETION_TAG,
  FACET_TAG,
  KINDS,
} from "./constants";
import { assessmentId, membershipId } from "./ids";
import { admitEvent, createPolicyReplayState } from "./permissions";
import { projectBoard } from "./projection";
import { createTestIdentity, signMutation, signTemplate } from "./testing";
import type {
  Assessment,
  Board,
  Capability,
  ComparisonSubject,
  FeatureArea,
  Membership,
} from "./types";

describe("Facet projection", () => {
  it("projects a signed multi-author board deterministically", async () => {
    const fixture = await boardFixture();
    const expected = projectBoard(fixture.events, fixture.board.id);
    expect(expected.board?.value.name).toBe("White Noise");
    expect(expected.subjects.get(fixture.subject.id)?.value.name).toBe("macOS");
    expect(expected.capabilities.get(fixture.capability.id)?.value.title).toBe("Message editing");
    expect(expected.assessments.get(fixture.assessment.id)?.value.status).toBe("implemented");
    expect(expected.invalidEvents).toEqual([]);

    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(fixture.events, {
          minLength: fixture.events.length,
          maxLength: fixture.events.length,
        }),
        async (shuffled) => {
          const actual = projectBoard(shuffled, fixture.board.id);
          expect(actual.board?.currentEvent.id).toBe(expected.board?.currentEvent.id);
          expect(actual.capabilities.get(fixture.capability.id)?.currentEvent.id).toBe(
            expected.capabilities.get(fixture.capability.id)?.currentEvent.id,
          );
          expect(actual.invalidEvents).toEqual([]);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("rejects private boards", async () => {
    const superAdmin = createTestIdentity();
    const bootstrap = await signMutation(superAdmin, {
      kind: KINDS.deployment,
      operation: "bootstrap",
      entityId: "deployment",
      value: { superAdminPubkey: superAdmin.pubkey },
      createdAt: 1,
    });
    const privateBoard: Board = {
      id: "private",
      name: "Private",
      visibility: "private",
      state: "active",
    };
    const create = await signMutation(superAdmin, {
      kind: KINDS.board,
      operation: "create",
      entityId: privateBoard.id,
      value: privateBoard,
      createdAt: 2,
    });
    const projection = projectBoard([bootstrap, create], privateBoard.id);
    expect(projection.board).toBeUndefined();
    expect(projection.invalidEvents[0]?.reason).toContain("public boards only");
  });

  it("rejects unprotected Facet writes before authorization", async () => {
    const identity = createTestIdentity();
    const protectedBootstrap = await signMutation(identity, {
      kind: KINDS.deployment,
      operation: "bootstrap",
      entityId: "deployment",
      value: { superAdminPubkey: identity.pubkey },
      createdAt: 1,
    });
    const unprotected = signTemplate(identity, {
      kind: protectedBootstrap.kind,
      created_at: protectedBootstrap.created_at,
      content: protectedBootstrap.content,
      tags: protectedBootstrap.tags.filter((tag) => tag[0] !== "-"),
    });

    const projection = projectBoard([unprotected], "");
    expect(projection.superAdminPubkey).toBeUndefined();
    expect(projection.invalidEvents[0]?.reason).toContain("NIP-70 protected-event tag");
  });

  it("enforces final-admin protection", async () => {
    const fixture = await boardFixture();
    const removed: Membership = { ...fixture.membership, state: "removed" };
    const event = await signMutation(fixture.superAdmin, {
      kind: KINDS.membership,
      operation: "remove",
      entityId: removed.id,
      baseEventId: fixture.membershipEvent.id,
      value: removed,
      createdAt: 20,
    });
    const projection = projectBoard([...fixture.events, event], fixture.board.id);
    expect(projection.invalidEvents.at(-1)?.reason).toContain("final board admin");
  });

  it("supports comment edit overlays, deletion tombstones, and removed-member denial", async () => {
    const fixture = await boardFixture();
    const comment = signTemplate(fixture.admin, {
      kind: KINDS.comment,
      created_at: 20,
      content: "Original",
      tags: [
        ["-"],
        ["b", fixture.board.id],
        ["c", fixture.capability.id],
        ["f", fixture.area.id],
        ["e", fixture.capabilityEvent.id],
        ["k", String(KINDS.capability)],
        ["E", fixture.capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "thread-1"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const edit = signTemplate(fixture.admin, {
      kind: KINDS.commentEdit,
      created_at: 21,
      content: "Edited",
      tags: [
        ["-"],
        ["e", comment.id],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["t", FACET_TAG],
      ],
    });
    const deletion = signTemplate(fixture.admin, {
      kind: KINDS.deletion,
      created_at: 22,
      content: "Removed",
      tags: [
        ["-"],
        ["e", comment.id],
        ["e", edit.id],
        ["k", String(KINDS.comment)],
        ["k", String(KINDS.commentEdit)],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["x", "thread-1"],
        [COMMENT_ROOT_TAG, comment.id],
        [COMMENT_CREATED_AT_TAG, String(comment.created_at)],
        [DELETED_COMMENT_TAG, comment.id],
        [DELETED_EDIT_TAG, edit.id],
        ["t", FACET_TAG],
        ["t", FACET_DELETION_TAG],
        ["t", "target:capability"],
      ],
    });
    const projection = projectBoard([...fixture.events, comment, edit, deletion], fixture.board.id);
    expect(projection.comments[0]).toMatchObject({
      content: "Edited",
      edited: true,
      deleted: true,
    });

    const secondAdmin = createTestIdentity();
    const secondMembership: Membership = {
      id: membershipId(fixture.board.id, secondAdmin.pubkey),
      boardId: fixture.board.id,
      pubkey: secondAdmin.pubkey,
      role: "admin",
      state: "active",
    };
    const addSecond = await signMutation(fixture.superAdmin, {
      kind: KINDS.membership,
      operation: "add",
      entityId: secondMembership.id,
      value: secondMembership,
      createdAt: 23,
    });
    const removed: Membership = { ...fixture.membership, state: "removed" };
    const removeOriginal = await signMutation(secondAdmin, {
      kind: KINDS.membership,
      operation: "remove",
      entityId: removed.id,
      baseEventId: fixture.membershipEvent.id,
      value: removed,
      createdAt: 24,
    });
    const lateDelete = signTemplate(fixture.admin, {
      kind: KINDS.deletion,
      created_at: 25,
      content: "",
      tags: [
        ["-"],
        ["e", comment.id],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["t", FACET_TAG],
      ],
    });
    const denied = projectBoard(
      [...fixture.events, comment, addSecond, removeOriginal, lateDelete],
      fixture.board.id,
    );
    expect(denied.invalidEvents.at(-1)?.reason).toContain("current members");
  });

  it("reconstructs a content-free thread tombstone after strfry removes a comment and its edits", async () => {
    const fixture = await boardFixture();
    const comment = signTemplate(fixture.admin, {
      kind: KINDS.comment,
      created_at: 20,
      content: "Original body",
      tags: [
        ["-"],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["e", fixture.capabilityEvent.id],
        ["k", String(KINDS.capability)],
        ["E", fixture.capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "deleted-thread"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const edit = signTemplate(fixture.admin, {
      kind: KINDS.commentEdit,
      created_at: 21,
      content: "Replacement body",
      tags: [
        ["-"],
        ["e", comment.id],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["t", FACET_TAG],
      ],
    });
    const reply = signTemplate(fixture.admin, {
      kind: KINDS.comment,
      created_at: 22,
      content: "A surviving reply",
      tags: [
        ["-"],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["e", comment.id],
        ["k", String(KINDS.comment)],
        ["E", fixture.capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "deleted-thread"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const deletion = signTemplate(fixture.admin, {
      kind: KINDS.deletion,
      created_at: 23,
      content: "Deleted by author",
      tags: [
        ["-"],
        ["e", comment.id],
        ["e", edit.id],
        ["k", String(KINDS.comment)],
        ["k", String(KINDS.commentEdit)],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["x", "deleted-thread"],
        [COMMENT_ROOT_TAG, comment.id],
        [COMMENT_CREATED_AT_TAG, String(comment.created_at)],
        [DELETED_COMMENT_TAG, comment.id],
        [DELETED_EDIT_TAG, edit.id],
        ["t", FACET_TAG],
        ["t", FACET_DELETION_TAG],
        ["t", "target:capability"],
      ],
    });

    const beforeRelayDeletion = projectBoard(
      [...fixture.events, comment, edit, reply, deletion],
      fixture.board.id,
    );
    expect(beforeRelayDeletion.invalidEvents).toEqual([]);

    const afterRelayDeletion = projectBoard(
      [...fixture.events, reply, deletion],
      fixture.board.id,
      { orphanedDeletionEventIds: "all" },
    );
    expect(afterRelayDeletion.invalidEvents).toEqual([]);
    expect(afterRelayDeletion.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: comment.id,
          content: "",
          deleted: true,
          threadId: "deleted-thread",
        }),
        expect.objectContaining({
          id: reply.id,
          parentCommentId: comment.id,
          rootCommentId: comment.id,
          content: "A surviving reply",
          deleted: false,
        }),
      ]),
    );

    const resolved = await signMutation(fixture.admin, {
      kind: KINDS.threadState,
      operation: "resolve",
      entityId: "deleted-thread",
      value: {
        id: "deleted-thread",
        boardId: fixture.board.id,
        capabilityId: fixture.capability.id,
        rootCommentId: comment.id,
        state: "resolved",
      },
      createdAt: 24,
    });
    const resolvedAfterDeletion = projectBoard(
      [...fixture.events, reply, deletion, resolved],
      fixture.board.id,
      { orphanedDeletionEventIds: "all" },
    );
    expect(resolvedAfterDeletion.invalidEvents).toEqual([]);
    expect(resolvedAfterDeletion.threadStates.get("deleted-thread")?.value.state).toBe("resolved");
  });

  it("requires archived entities to be restored before ordinary writes", async () => {
    const fixture = await boardFixture();
    const archived = await signMutation(fixture.admin, {
      kind: KINDS.capability,
      operation: "archive",
      entityId: fixture.capability.id,
      baseEventId: fixture.events.at(-2)?.id ?? null,
      value: { ...fixture.capability, state: "archived" },
      createdAt: 20,
    });
    const staleUpdate = await signMutation(fixture.admin, {
      kind: KINDS.capability,
      operation: "update",
      entityId: fixture.capability.id,
      baseEventId: archived.id,
      value: { ...fixture.capability, title: "Update while archived" },
      createdAt: 21,
    });
    const comment = signTemplate(fixture.admin, {
      kind: KINDS.comment,
      created_at: 22,
      content: "Comment while archived",
      tags: [
        ["-"],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["e", fixture.capabilityEvent.id],
        ["k", String(KINDS.capability)],
        ["E", fixture.capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "archived-thread"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const denied = projectBoard(
      [...fixture.events, archived, staleUpdate, comment],
      fixture.board.id,
    );
    expect(denied.capabilities.get(fixture.capability.id)?.value.state).toBe("archived");
    expect(denied.invalidEvents.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must be restored"),
        expect.stringContaining("active capability"),
      ]),
    );

    const restored = await signMutation(fixture.admin, {
      kind: KINDS.capability,
      operation: "restore",
      entityId: fixture.capability.id,
      baseEventId: archived.id,
      value: fixture.capability,
      createdAt: 23,
    });
    const allowed = projectBoard([...fixture.events, archived, restored], fixture.board.id);
    expect(allowed.capabilities.get(fixture.capability.id)?.value.state).toBe("active");
    expect(allowed.invalidEvents).toEqual([]);
  });

  it("enforces deterministic assessment identity and capability scope", async () => {
    const fixture = await boardFixture();
    const wrongId = await signMutation(fixture.admin, {
      kind: KINDS.assessment,
      operation: "create",
      entityId: "forged-assessment-id",
      value: { ...fixture.assessment, id: "forged-assessment-id" },
      createdAt: 20,
    });
    const wrongArea = await signMutation(fixture.admin, {
      kind: KINDS.assessment,
      operation: "update",
      entityId: fixture.assessment.id,
      baseEventId: fixture.assessmentEvent.id,
      value: { ...fixture.assessment, featureAreaId: "wrong-area" },
      createdAt: 21,
    });

    const projection = projectBoard([...fixture.events, wrongId, wrongArea], fixture.board.id);
    expect(projection.invalidEvents.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Assessment ID is not deterministic"),
        expect.stringContaining("feature area does not match"),
      ]),
    );
    expect(projection.assessments.size).toBe(1);
  });

  it("retains stale-but-real predecessors and rejects nonexistent bases", async () => {
    const fixture = await boardFixture();
    const first = await signMutation(fixture.admin, {
      kind: KINDS.capability,
      operation: "update",
      entityId: fixture.capability.id,
      baseEventId: fixture.capabilityEvent.id,
      value: { ...fixture.capability, title: "First concurrent edit" },
      createdAt: 20,
    });
    const stale = await signMutation(fixture.admin, {
      kind: KINDS.capability,
      operation: "update",
      entityId: fixture.capability.id,
      baseEventId: fixture.capabilityEvent.id,
      value: { ...fixture.capability, title: "Second concurrent edit" },
      createdAt: 21,
    });
    const forged = await signMutation(fixture.admin, {
      kind: KINDS.capability,
      operation: "update",
      entityId: fixture.capability.id,
      baseEventId: "f".repeat(64),
      value: { ...fixture.capability, title: "Forged base" },
      createdAt: 22,
    });

    const projection = projectBoard([...fixture.events, first, stale, forged], fixture.board.id);
    const projected = projection.capabilities.get(fixture.capability.id);
    expect(projected?.value.title).toBe("Second concurrent edit");
    expect(projected?.history).toHaveLength(3);
    expect(projection.invalidEvents.at(-1)?.reason).toContain("unknown predecessor");
  });

  it("moves capabilities without stranding historically scoped discussion", async () => {
    const fixture = await boardFixture();
    const originalThread = signTemplate(fixture.admin, {
      kind: KINDS.comment,
      created_at: 8,
      content: "Discussion before movement",
      tags: [
        ["-"],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["e", fixture.capabilityEvent.id],
        ["k", String(KINDS.capability)],
        ["E", fixture.capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "old-area-thread"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const destination: FeatureArea = {
      ...fixture.area,
      id: "calls",
      title: "Calls",
      orderKey: "b0",
    };
    const destinationEvent = await signMutation(fixture.admin, {
      kind: KINDS.featureArea,
      operation: "create",
      entityId: destination.id,
      value: destination,
      createdAt: 9,
    });
    const moved = await signMutation(fixture.admin, {
      kind: KINDS.capability,
      operation: "update",
      entityId: fixture.capability.id,
      baseEventId: fixture.capabilityEvent.id,
      value: { ...fixture.capability, featureAreaId: destination.id },
      createdAt: 10,
    });
    const historicalReply = signTemplate(fixture.admin, {
      kind: KINDS.comment,
      created_at: 11,
      content: "Reply after movement",
      tags: [
        ["-"],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["e", originalThread.id],
        ["k", String(KINDS.comment)],
        ["E", fixture.capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "old-area-thread"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const newThread = signTemplate(fixture.admin, {
      kind: KINDS.comment,
      created_at: 12,
      content: "Discussion after movement",
      tags: [
        ["-"],
        ["b", fixture.board.id],
        ["f", destination.id],
        ["c", fixture.capability.id],
        ["e", moved.id],
        ["k", String(KINDS.capability)],
        ["E", moved.id],
        ["K", String(KINDS.capability)],
        ["x", "new-area-thread"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });

    const projection = projectBoard(
      [...fixture.events, originalThread, destinationEvent, moved, historicalReply, newThread],
      fixture.board.id,
    );
    expect(projection.invalidEvents).toEqual([]);
    expect(projection.capabilities.get(fixture.capability.id)?.value.featureAreaId).toBe(
      destination.id,
    );
    expect(projection.comments).toHaveLength(3);
    expect(projection.comments.find((comment) => comment.id === historicalReply.id)).toMatchObject({
      parentCommentId: originalThread.id,
      threadId: "old-area-thread",
    });
  });

  it("requires active capabilities to be archived before their feature area", async () => {
    const fixture = await boardFixture();
    const archived = await signMutation(fixture.admin, {
      kind: KINDS.featureArea,
      operation: "archive",
      entityId: fixture.area.id,
      baseEventId: fixture.areaEvent.id,
      value: { ...fixture.area, state: "archived" },
      createdAt: 20,
    });
    const projection = projectBoard([...fixture.events, archived], fixture.board.id);
    expect(projection.featureAreas.get(fixture.area.id)?.value.state).toBe("active");
    expect(projection.invalidEvents.at(-1)?.reason).toContain("Archive active capabilities");
  });

  it("removes an exact prior reaction and rejects forged discussion scope", async () => {
    const fixture = await boardFixture();
    const comment = signTemplate(fixture.admin, {
      kind: KINDS.comment,
      created_at: 20,
      content: "A rationale",
      tags: [
        ["-"],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["e", fixture.capabilityEvent.id],
        ["k", String(KINDS.capability)],
        ["E", fixture.capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "thread-1"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const reaction = signTemplate(fixture.admin, {
      kind: KINDS.reaction,
      created_at: 21,
      content: "👍",
      tags: [
        ["-"],
        ["e", comment.id],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["t", FACET_TAG],
      ],
    });
    const forged = signTemplate(fixture.admin, {
      kind: KINDS.reaction,
      created_at: 22,
      content: "👀",
      tags: [
        ["-"],
        ["e", comment.id],
        ["b", fixture.board.id],
        ["f", "different-area"],
        ["c", fixture.capability.id],
        ["t", FACET_TAG],
      ],
    });
    const deletion = signTemplate(fixture.admin, {
      kind: KINDS.deletion,
      created_at: 23,
      content: "Reaction removed by author",
      tags: [
        ["-"],
        ["e", reaction.id],
        ["k", String(KINDS.reaction)],
        ["b", fixture.board.id],
        ["f", fixture.area.id],
        ["c", fixture.capability.id],
        ["t", FACET_TAG],
        ["t", FACET_DELETION_TAG],
      ],
    });

    const projection = projectBoard(
      [...fixture.events, comment, reaction, forged, deletion],
      fixture.board.id,
    );
    expect(projection.comments).toHaveLength(1);
    expect(projection.reactions).toHaveLength(0);
    expect(projection.invalidEvents.at(-1)?.reason).toContain("active capability and feature area");
  });

  it("rejects non-monotonic authority events in admission policy", async () => {
    const fixture = await boardFixture();
    const state = createPolicyReplayState(fixture.events);
    const lateMember = createTestIdentity();
    const membership: Membership = {
      id: membershipId(fixture.board.id, lateMember.pubkey),
      boardId: fixture.board.id,
      pubkey: lateMember.pubkey,
      role: "member",
      state: "active",
    };
    const backdated = await signMutation(fixture.admin, {
      kind: KINDS.membership,
      operation: "add",
      entityId: membership.id,
      value: membership,
      createdAt: 2,
    });
    expect(admitEvent(state, backdated)).toEqual({
      accepted: false,
      reason: "Authority event does not advance the high-water mark.",
    });
  });

  it("does not let a member impersonate an importer", async () => {
    const fixture = await boardFixture();
    const forged = await signMutation(fixture.admin, {
      kind: KINDS.capability,
      operation: "update",
      entityId: fixture.capability.id,
      baseEventId: fixture.events.at(-2)?.id ?? null,
      value: { ...fixture.capability, title: "Forged import" },
      importMetadata: { source: "outline", sourceId: "forged" },
      createdAt: 20,
    });

    const projection = projectBoard([...fixture.events, forged], fixture.board.id);
    expect(projection.invalidEvents.at(-1)?.reason).toContain("configured importer key");
    expect(projection.capabilities.get(fixture.capability.id)?.value.title).toBe("Message editing");
  });
});

async function boardFixture() {
  const superAdmin = createTestIdentity();
  const admin = createTestIdentity();
  const board: Board = {
    id: "white-noise",
    name: "White Noise",
    visibility: "public",
    state: "active",
  };
  const membership: Membership = {
    id: membershipId(board.id, admin.pubkey),
    boardId: board.id,
    pubkey: admin.pubkey,
    role: "admin",
    state: "active",
  };
  const subject: ComparisonSubject = {
    id: "macos",
    boardId: board.id,
    name: "macOS",
    orderKey: "a0",
    state: "active",
    includeInGapAnalysis: true,
    locked: false,
  };
  const area: FeatureArea = {
    id: "messaging",
    boardId: board.id,
    title: "Messaging",
    orderKey: "a0",
    state: "active",
  };
  const capability: Capability = {
    id: "message-editing",
    boardId: board.id,
    featureAreaId: area.id,
    title: "Message editing",
    orderKey: "a0",
    state: "active",
    desiredOutcome: "standardize",
    decisionStatus: "decided",
    priority: "now",
    completionStatus: "in_progress",
    links: [],
  };
  const assessment: Assessment = {
    id: assessmentId(board.id, capability.id, subject.id),
    boardId: board.id,
    featureAreaId: area.id,
    capabilityId: capability.id,
    subjectId: subject.id,
    status: "implemented",
    state: "active",
  };
  const bootstrap = await signMutation(superAdmin, {
    kind: KINDS.deployment,
    operation: "bootstrap",
    entityId: "deployment",
    value: { superAdminPubkey: superAdmin.pubkey },
    createdAt: 1,
  });
  const boardEvent = await signMutation(superAdmin, {
    kind: KINDS.board,
    operation: "create",
    entityId: board.id,
    value: board,
    createdAt: 2,
  });
  const membershipEvent = await signMutation(superAdmin, {
    kind: KINDS.membership,
    operation: "add",
    entityId: membership.id,
    value: membership,
    createdAt: 3,
  });
  const subjectEvent = await signMutation(admin, {
    kind: KINDS.subject,
    operation: "create",
    entityId: subject.id,
    value: subject,
    createdAt: 4,
  });
  const areaEvent = await signMutation(admin, {
    kind: KINDS.featureArea,
    operation: "create",
    entityId: area.id,
    value: area,
    createdAt: 5,
  });
  const capabilityEvent = await signMutation(admin, {
    kind: KINDS.capability,
    operation: "create",
    entityId: capability.id,
    value: capability,
    createdAt: 6,
  });
  const assessmentEvent = await signMutation(admin, {
    kind: KINDS.assessment,
    operation: "create",
    entityId: assessment.id,
    value: assessment,
    createdAt: 7,
  });
  return {
    superAdmin,
    admin,
    board,
    membership,
    membershipEvent,
    subject,
    area,
    areaEvent,
    capability,
    capabilityEvent,
    assessment,
    assessmentEvent,
    events: [
      bootstrap,
      boardEvent,
      membershipEvent,
      subjectEvent,
      areaEvent,
      capabilityEvent,
      assessmentEvent,
    ],
  };
}
