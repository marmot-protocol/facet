import { EventFactory } from "applesauce-core/factories";
import type { NostrEvent } from "nostr-tools";
import { FACET_DEPLOYMENT_TAG, FACET_TAG, KINDS } from "./constants";
import { scopeTags } from "./tags";
import type {
  Assessment,
  Board,
  Capability,
  ComparisonSubject,
  DeploymentControl,
  FeatureArea,
  Membership,
  Mutation,
  MutationOperation,
  ThreadStateValue,
} from "./types";

export type MutationValue =
  | DeploymentControl
  | Board
  | Membership
  | ComparisonSubject
  | FeatureArea
  | Capability
  | Assessment
  | ThreadStateValue;

export type MutationFactoryInput<T extends MutationValue> = {
  kind: number;
  operation: MutationOperation;
  entityId: string;
  baseEventId?: string | null;
  value: T;
  importMetadata?: Mutation<T>["importMetadata"];
  relayUrl?: string;
  createdAt?: number;
};

export function mutationTags<T extends MutationValue>(input: MutationFactoryInput<T>): string[][] {
  const value = input.value as MutationValue & {
    boardId?: string;
    featureAreaId?: string;
    capabilityId?: string;
    subjectId?: string;
  };
  const tags: string[][] = [
    ["-"],
    ["t", input.kind === KINDS.deployment ? FACET_DEPLOYMENT_TAG : FACET_TAG],
    ["x", input.entityId],
    ["o", input.operation],
  ];

  if (value.boardId) {
    tags.push(
      ...scopeTags({
        boardId: value.boardId,
        ...(value.featureAreaId ? { featureAreaId: value.featureAreaId } : {}),
        ...(value.capabilityId ? { capabilityId: value.capabilityId } : {}),
        ...(value.subjectId ? { subjectId: value.subjectId } : {}),
      }),
    );
  }
  if (input.kind === KINDS.board && "id" in value) tags.push(["b", value.id]);
  if (input.kind === KINDS.deployment && "superAdminPubkey" in value) {
    tags.push(["p", value.superAdminPubkey]);
  }
  if (input.kind === KINDS.membership && "pubkey" in value) {
    tags.push(["p", value.pubkey], ["r", value.role]);
  }
  if (input.kind === KINDS.subject && "id" in value) tags.push(["s", value.id]);
  if (input.kind === KINDS.featureArea && "id" in value) tags.push(["f", value.id]);
  if (input.kind === KINDS.capability && "id" in value) tags.push(["c", value.id]);
  if (input.kind === KINDS.threadState && "rootCommentId" in value) {
    tags.push(["e", value.rootCommentId, input.relayUrl ?? "", "root"]);
  }
  if (input.baseEventId) {
    tags.push(["e", input.baseEventId, input.relayUrl ?? "", "previous"]);
  }
  if (input.importMetadata) tags.push(["t", `imported-${input.importMetadata.source}`]);

  return dedupeTags(tags);
}

export function createMutationFactory<T extends MutationValue>(
  input: MutationFactoryInput<T>,
): EventFactory<number> {
  const content: Mutation<T> = {
    schema: "facet.v1",
    operation: input.operation,
    entityId: input.entityId,
    baseEventId: input.baseEventId ?? null,
    value: input.value,
    ...(input.importMetadata ? { importMetadata: input.importMetadata } : {}),
  };
  return EventFactory.fromKind(input.kind)
    .created(input.createdAt)
    .content(JSON.stringify(content))
    .modifyPublicTags(() => mutationTags(input));
}

export function createCommentEditFactory(input: {
  original: NostrEvent;
  content: string;
  boardId: string;
  capabilityId: string;
  featureAreaId?: string;
  subjectId?: string;
  target: string;
  createdAt?: number;
}): EventFactory<number> {
  return EventFactory.fromKind(KINDS.commentEdit)
    .created(input.createdAt)
    .content(input.content)
    .modifyPublicTags(() => [
      ["-"],
      ["e", input.original.id],
      ["b", input.boardId],
      ["c", input.capabilityId],
      ...(input.featureAreaId ? [["f", input.featureAreaId]] : []),
      ...(input.subjectId ? [["s", input.subjectId]] : []),
      ["t", FACET_TAG],
      ["t", input.target],
    ]);
}

function dedupeTags(tags: string[][]): string[][] {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = JSON.stringify(tag);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
