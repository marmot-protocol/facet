import {
  COMMENT_ROOT_TAG,
  DELETED_COMMENT_TAG,
  DELETED_EDIT_TAG,
  FACET_DELETION_TAG,
  FACET_TAG,
  KINDS,
  type ProjectedComment,
} from "@facet/protocol";
import { ActionRunner } from "applesauce-actions";
import { EventStore } from "applesauce-core";
import { PrivateKeySigner } from "applesauce-signers";
import { type NostrEvent, nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";
import {
  CreateFacetComment,
  DeleteFacetComment,
  observeFacetTimestamp,
  PublishMutation,
} from "./actions";

describe("Facet action clock", () => {
  it("keeps dependent writes causally ordered inside the relay clock-skew window", async () => {
    const signer = new PrivateKeySigner();
    const events: NostrEvent[] = [];
    const runner = new ActionRunner(new EventStore(), signer, (event) => {
      events.push(event);
    });
    runner.saveToStore = false;
    const floor = Math.floor(Date.now() / 1000) + 5;
    observeFacetTimestamp(floor);
    const pubkey = await signer.getPublicKey();

    for (const entityId of ["one", "two"]) {
      await runner.run(() =>
        PublishMutation({
          kind: KINDS.deployment,
          operation: "bootstrap",
          entityId,
          value: { superAdminPubkey: pubkey },
        }),
      );
    }

    expect(events.map((event) => event.created_at)).toEqual([floor + 1, floor + 2]);
  });

  it("publishes a structural deletion receipt targeting the comment and all edits", async () => {
    const signer = new PrivateKeySigner();
    const now = Math.floor(Date.now() / 1000);
    const comment = await signer.signEvent({
      kind: KINDS.comment,
      created_at: now,
      content: "Original",
      tags: [
        ["-"],
        ["b", "white-noise"],
        ["f", "messaging"],
        ["c", "editing"],
        ["x", "thread-1"],
        ["t", FACET_TAG],
        ["t", "target:capability"],
      ],
    });
    const edit = await signer.signEvent({
      kind: KINDS.commentEdit,
      created_at: now + 1,
      content: "Replacement",
      tags: [
        ["-"],
        ["e", comment.id],
        ["b", "white-noise"],
        ["f", "messaging"],
        ["c", "editing"],
        ["t", FACET_TAG],
      ],
    });
    const projected: ProjectedComment = {
      id: comment.id,
      event: comment,
      content: edit.content,
      edited: true,
      editHistory: [edit],
      deleted: false,
      imported: false,
      threadId: "thread-1",
      rootCommentId: comment.id,
      target: "target:capability",
    };
    const events: NostrEvent[] = [];
    const runner = new ActionRunner(new EventStore(), signer, (event) => {
      events.push(event);
    });
    runner.saveToStore = false;

    await runner.run(() =>
      DeleteFacetComment({
        comment: projected,
        boardId: "white-noise",
        featureAreaId: "messaging",
        capabilityId: "editing",
      }),
    );

    const deletion = events[0]!;
    expect(deletion.kind).toBe(KINDS.deletion);
    expect(deletion.tags.filter((tag) => tag[0] === "e").map((tag) => tag[1])).toEqual(
      expect.arrayContaining([comment.id, edit.id]),
    );
    expect(deletion.tags).toEqual(
      expect.arrayContaining([
        ["t", FACET_DELETION_TAG],
        [DELETED_COMMENT_TAG, comment.id],
        [DELETED_EDIT_TAG, edit.id],
        [COMMENT_ROOT_TAG, comment.id],
      ]),
    );
  });

  it("preserves canonical profile mentions and adds their Nostr p tags", async () => {
    const signer = new PrivateKeySigner();
    const mentionedPubkey = await new PrivateKeySigner().getPublicKey();
    const parent = await signer.signEvent({
      kind: KINDS.capability,
      created_at: Math.floor(Date.now() / 1000),
      content: "{}",
      tags: [],
    });
    const events: NostrEvent[] = [];
    const runner = new ActionRunner(new EventStore(), signer, (event) => {
      events.push(event);
    });
    runner.saveToStore = false;

    await runner.run(() =>
      CreateFacetComment({
        parent,
        content: `Ask nostr:${nip19.npubEncode(mentionedPubkey)} about this.`,
        boardId: "white-noise",
        featureAreaId: "messaging",
        capabilityId: "editing",
        target: "target:capability",
        threadId: "thread-2",
      }),
    );

    expect(events[0]?.content).toContain(`nostr:${nip19.npubEncode(mentionedPubkey)}`);
    expect(events[0]?.tags).toContainEqual(["p", mentionedPubkey]);
  });
});
