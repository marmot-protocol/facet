import {
  COMMENT_CREATED_AT_TAG,
  COMMENT_PARENT_TAG,
  COMMENT_ROOT_TAG,
  createCommentEditFactory,
  createMutationFactory,
  DELETED_COMMENT_TAG,
  DELETED_EDIT_TAG,
  FACET_DELETION_TAG,
  FACET_TAG,
  getTag,
  KINDS,
  type MutationFactoryInput,
  type MutationValue,
  type ProjectedComment,
} from "@facet/protocol";
import type { Action } from "applesauce-actions";
import { CommentFactory, ReactionFactory } from "applesauce-common/factories";
import { DeleteFactory } from "applesauce-core/factories";
import type { NostrEvent } from "applesauce-core/helpers/event";

let lastCreatedAt = 0;

export function observeFacetTimestamp(createdAt: number): void {
  lastCreatedAt = Math.max(lastCreatedAt, createdAt);
}

function nextCreatedAt(after = 0): number {
  const now = Math.floor(Date.now() / 1000);
  lastCreatedAt = Math.max(now, lastCreatedAt + 1, after + 1);
  return lastCreatedAt;
}

export function PublishMutation<T extends MutationValue>(input: MutationFactoryInput<T>): Action {
  return async ({ signer, publish }) => {
    const event = await createMutationFactory({
      ...input,
      createdAt: input.createdAt ?? nextCreatedAt(),
    }).sign(signer);
    await publish(event);
  };
}

export function CreateFacetComment(input: {
  parent: NostrEvent;
  content: string;
  boardId: string;
  featureAreaId: string;
  capabilityId: string;
  subjectId?: string;
  target: string;
  threadId: string;
}): Action {
  return async ({ signer, publish }) => {
    const event = await CommentFactory.create(input.parent, input.content)
      .created(nextCreatedAt(input.parent.created_at))
      .modifyPublicTags((tags) => [
        ...tags,
        ["-"],
        ["b", input.boardId],
        ["f", input.featureAreaId],
        ["c", input.capabilityId],
        ...(input.subjectId ? [["s", input.subjectId]] : []),
        ["x", input.threadId],
        ["t", FACET_TAG],
        ["t", input.target],
      ])
      .sign(signer);
    await publish(event);
  };
}

export function EditFacetComment(input: {
  original: NostrEvent;
  content: string;
  boardId: string;
  featureAreaId?: string;
  capabilityId: string;
  subjectId?: string;
  target: string;
}): Action {
  return async ({ signer, publish }) => {
    const event = await createCommentEditFactory({
      ...input,
      createdAt: nextCreatedAt(input.original.created_at),
    }).sign(signer);
    await publish(event);
  };
}

export function ReactToFacetComment(input: {
  comment: NostrEvent;
  emoji: string;
  boardId: string;
  featureAreaId: string;
  capabilityId: string;
}): Action {
  return async ({ signer, publish }) => {
    const event = await ReactionFactory.create(input.comment, input.emoji)
      .created(nextCreatedAt(input.comment.created_at))
      .modifyPublicTags((tags) => [
        ...tags,
        ["-"],
        ["b", input.boardId],
        ["f", input.featureAreaId],
        ["c", input.capabilityId],
        ["t", FACET_TAG],
      ])
      .sign(signer);
    await publish(event);
  };
}

export function DeleteFacetComment(input: {
  comment: ProjectedComment;
  boardId: string;
  featureAreaId: string;
  capabilityId: string;
  reason?: string;
}): Action {
  return async ({ signer, publish }) => {
    if (input.comment.deleted || input.comment.event.kind !== KINDS.comment) {
      throw new Error("Only an available Facet comment can be deleted.");
    }
    const targets = [input.comment.event, ...input.comment.editHistory];
    const subjectId = getTag(input.comment.event, "s");
    const deletion = await DeleteFactory.fromEvents(targets, input.reason)
      .created(nextCreatedAt(Math.max(...targets.map((event) => event.created_at))))
      .modifyPublicTags((tags) => [
        ...tags,
        ["-"],
        ["b", input.boardId],
        ["f", input.featureAreaId],
        ["c", input.capabilityId],
        ...(subjectId ? [["s", subjectId]] : []),
        ["x", input.comment.threadId],
        [COMMENT_ROOT_TAG, input.comment.rootCommentId],
        ...(input.comment.parentCommentId
          ? [[COMMENT_PARENT_TAG, input.comment.parentCommentId]]
          : []),
        [COMMENT_CREATED_AT_TAG, String(input.comment.event.created_at)],
        [DELETED_COMMENT_TAG, input.comment.id],
        ...input.comment.editHistory.map((event) => [DELETED_EDIT_TAG, event.id]),
        ["t", FACET_TAG],
        ["t", FACET_DELETION_TAG],
        ["t", input.comment.target],
      ])
      .sign(signer);
    await publish(deletion);
  };
}

export function DeleteFacetReaction(input: {
  event: NostrEvent;
  boardId: string;
  featureAreaId: string;
  capabilityId: string;
  reason?: string;
}): Action {
  return async ({ signer, publish }) => {
    if (input.event.kind !== KINDS.reaction) {
      throw new Error("Only a Facet reaction can be removed with this action.");
    }
    const deletion = await DeleteFactory.fromEvents([input.event], input.reason)
      .created(nextCreatedAt(input.event.created_at))
      .modifyPublicTags((tags) => [
        ...tags,
        ["-"],
        ["b", input.boardId],
        ["f", input.featureAreaId],
        ["c", input.capabilityId],
        ["t", FACET_TAG],
        ["t", FACET_DELETION_TAG],
      ])
      .sign(signer);
    await publish(deletion);
  };
}

export function ResolveThread(input: MutationFactoryInput<MutationValue>): Action {
  if (input.kind !== KINDS.threadState) throw new Error("ResolveThread requires kind 3506.");
  return PublishMutation(input);
}
