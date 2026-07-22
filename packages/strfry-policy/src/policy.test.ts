import type { Board, Capability, ComparisonSubject, FeatureArea } from "@facet/protocol";
import {
  COMMENT_CREATED_AT_TAG,
  COMMENT_ROOT_TAG,
  DELETED_COMMENT_TAG,
  FACET_DELETION_TAG,
  FACET_TAG,
  KINDS,
} from "@facet/protocol";
import { createTestIdentity, signMutation, signTemplate } from "@facet/protocol/testing";
import { describe, expect, it } from "vitest";
import { FacetWritePolicy, type StrfryPluginRequest } from "./policy";

describe("strfry policy", () => {
  it("requires NIP-42 auth matching the signer", async () => {
    const identity = createTestIdentity();
    const event = await bootstrap(identity, 100);
    const policy = new FacetWritePolicy();
    expect(policy.evaluate(request(event, undefined))).toMatchObject({
      action: "reject",
      msg: expect.stringContaining("auth-required"),
    });
    expect(policy.evaluate(request(event, identity.pubkey))).toEqual({
      id: event.id,
      action: "accept",
    });
  });

  it("allows exactly one atomic bootstrap", async () => {
    const first = createTestIdentity();
    const second = createTestIdentity();
    const policy = new FacetWritePolicy();
    const one = await bootstrap(first, 100);
    const two = await bootstrap(second, 101);
    expect(policy.evaluate(request(one, first.pubkey)).action).toBe("accept");
    expect(policy.evaluate(request(two, second.pubkey))).toMatchObject({
      action: "reject",
      msg: expect.stringContaining("already bootstrapped"),
    });
  });

  it("rejects private board creation and backdated writes", async () => {
    const identity = createTestIdentity();
    const policy = new FacetWritePolicy();
    const root = await bootstrap(identity, 100);
    policy.evaluate(request(root, identity.pubkey));
    const board: Board = { id: "private", name: "Private", visibility: "private", state: "active" };
    const event = await signMutation(identity, {
      kind: KINDS.board,
      operation: "create",
      entityId: board.id,
      value: board,
      createdAt: 101,
    });
    expect(policy.evaluate(request(event, identity.pubkey))).toMatchObject({
      action: "reject",
      msg: expect.stringContaining("public boards only"),
    });
    expect(policy.evaluate({ ...request(event, identity.pubkey), receivedAt: 1000 })).toMatchObject(
      {
        action: "reject",
        msg: expect.stringContaining("clock-skew"),
      },
    );
  });

  it("fails closed for unrelated relay writes by default", () => {
    const policy = new FacetWritePolicy();
    const event = {
      id: "0".repeat(64),
      pubkey: "1".repeat(64),
      created_at: 100,
      kind: 1,
      tags: [],
      content: "hello",
      sig: "2".repeat(128),
    };
    expect(policy.evaluate(request(event, event.pubkey))).toMatchObject({
      action: "reject",
      msg: expect.stringContaining("Facet events only"),
    });
  });

  it("revokes new importer writes without invalidating historical replay", async () => {
    const superAdmin = createTestIdentity();
    const importer = createTestIdentity();
    const bootstrapEvent = await bootstrap(superAdmin, 100);
    const board: Board = {
      id: "white-noise",
      name: "White Noise",
      visibility: "public",
      state: "active",
    };
    const boardEvent = await signMutation(superAdmin, {
      kind: KINDS.board,
      operation: "create",
      entityId: board.id,
      value: board,
      createdAt: 101,
    });
    const subject: ComparisonSubject = {
      id: "flutter",
      boardId: board.id,
      name: "Flutter",
      orderKey: "a0",
      state: "historical",
      includeInGapAnalysis: false,
      locked: true,
    };
    const imported = await signMutation(importer, {
      kind: KINDS.subject,
      operation: "create",
      entityId: subject.id,
      value: subject,
      importMetadata: { source: "flutter", sourceId: "release" },
      createdAt: 102,
    });

    const migrationPolicy = new FacetWritePolicy({
      importerPubkeys: [importer.pubkey],
      activeImporterPubkeys: [importer.pubkey],
    });
    expect(migrationPolicy.evaluate(request(bootstrapEvent, superAdmin.pubkey)).action).toBe(
      "accept",
    );
    expect(migrationPolicy.evaluate(request(boardEvent, superAdmin.pubkey)).action).toBe("accept");
    expect(migrationPolicy.evaluate(request(imported, importer.pubkey)).action).toBe("accept");

    const forbiddenCorrection = await signMutation(importer, {
      kind: KINDS.subject,
      operation: "archive",
      entityId: subject.id,
      baseEventId: imported.id,
      value: { ...subject, state: "archived" },
      importMetadata: { source: "flutter", sourceId: "forbidden-correction" },
      createdAt: 103,
    });
    expect(migrationPolicy.evaluate(request(forbiddenCorrection, importer.pubkey))).toMatchObject({
      action: "reject",
      msg: expect.stringContaining("operation is not allowed"),
    });

    const revokedPolicy = new FacetWritePolicy({
      importerPubkeys: [importer.pubkey],
      activeImporterPubkeys: [],
    });
    expect(() => revokedPolicy.replay([bootstrapEvent, boardEvent, imported])).not.toThrow();
    const laterImport = await signMutation(importer, {
      kind: KINDS.subject,
      operation: "create",
      entityId: "another-import",
      value: { ...subject, id: "another-import", name: "Another import" },
      importMetadata: { source: "flutter", sourceId: "later" },
      createdAt: 104,
    });
    expect(revokedPolicy.evaluate(request(laterImport, importer.pubkey))).toMatchObject({
      action: "reject",
      msg: expect.stringContaining("not active"),
    });
  });

  it("replays a canonical NIP-09 receipt after strfry removes the comment payload", async () => {
    const admin = createTestIdentity();
    const bootstrapEvent = await bootstrap(admin, 100);
    const board: Board = {
      id: "white-noise",
      name: "White Noise",
      visibility: "public",
      state: "active",
    };
    const boardEvent = await signMutation(admin, {
      kind: KINDS.board,
      operation: "create",
      entityId: board.id,
      value: board,
      createdAt: 101,
    });
    const area: FeatureArea = {
      id: "messaging",
      boardId: board.id,
      title: "Messaging",
      orderKey: "a0",
      state: "active",
    };
    const areaEvent = await signMutation(admin, {
      kind: KINDS.featureArea,
      operation: "create",
      entityId: area.id,
      value: area,
      createdAt: 102,
    });
    const capability: Capability = {
      id: "editing",
      boardId: board.id,
      featureAreaId: area.id,
      title: "Editing",
      orderKey: "a0",
      state: "active",
      desiredOutcome: "standardize",
      decisionStatus: "open",
      priority: "now",
      completionStatus: "in_progress",
      links: [],
    };
    const capabilityEvent = await signMutation(admin, {
      kind: KINDS.capability,
      operation: "create",
      entityId: capability.id,
      value: capability,
      createdAt: 103,
    });
    const comment = signTemplate(admin, {
      kind: KINDS.comment,
      created_at: 104,
      content: "Delete me",
      tags: [
        ["-"],
        ["b", board.id],
        ["f", area.id],
        ["c", capability.id],
        ["e", capabilityEvent.id],
        ["k", String(KINDS.capability)],
        ["E", capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "thread-delete"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const deletion = signTemplate(admin, {
      kind: KINDS.deletion,
      created_at: 105,
      content: "Deleted by author",
      tags: [
        ["-"],
        ["e", comment.id],
        ["k", String(KINDS.comment)],
        ["b", board.id],
        ["f", area.id],
        ["c", capability.id],
        ["x", "thread-delete"],
        [COMMENT_ROOT_TAG, comment.id],
        [COMMENT_CREATED_AT_TAG, String(comment.created_at)],
        [DELETED_COMMENT_TAG, comment.id],
        ["t", FACET_TAG],
        ["t", FACET_DELETION_TAG],
        ["t", "target:capability"],
      ],
    });
    const policy = new FacetWritePolicy();
    for (const event of [
      bootstrapEvent,
      boardEvent,
      areaEvent,
      capabilityEvent,
      comment,
      deletion,
    ]) {
      expect(policy.evaluate(request(event, admin.pubkey)).action).toBe("accept");
    }

    const restarted = new FacetWritePolicy();
    expect(() =>
      restarted.replay([bootstrapEvent, boardEvent, areaEvent, capabilityEvent, deletion]),
    ).not.toThrow();

    const lateReply = signTemplate(admin, {
      kind: KINDS.comment,
      created_at: 106,
      content: "Too late",
      tags: [
        ["-"],
        ["b", board.id],
        ["f", area.id],
        ["c", capability.id],
        ["e", comment.id],
        ["k", String(KINDS.comment)],
        ["E", capabilityEvent.id],
        ["K", String(KINDS.capability)],
        ["x", "thread-delete"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    expect(restarted.evaluate(request(lateReply, admin.pubkey))).toMatchObject({
      action: "reject",
      msg: expect.stringContaining("parent was deleted"),
    });
  });
});

async function bootstrap(identity: ReturnType<typeof createTestIdentity>, createdAt: number) {
  return signMutation(identity, {
    kind: KINDS.deployment,
    operation: "bootstrap",
    entityId: "deployment",
    value: { superAdminPubkey: identity.pubkey },
    createdAt,
  });
}

function request(
  event: StrfryPluginRequest["event"],
  authed: string | undefined,
): StrfryPluginRequest {
  return {
    type: "new",
    event,
    receivedAt: event.created_at,
    sourceType: "IP4",
    ...(authed ? { authed } : {}),
  };
}
