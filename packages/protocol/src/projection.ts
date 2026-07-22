import type { Model } from "applesauce-core/event-store";
import type { Filter } from "applesauce-core/helpers/filter";
import { type NostrEvent, verifyEvent } from "nostr-tools";
import { map } from "rxjs";
import {
  COMMENT_CREATED_AT_TAG,
  COMMENT_PARENT_TAG,
  COMMENT_ROOT_TAG,
  DELETED_COMMENT_TAG,
  DELETED_EDIT_TAG,
  FACET_DELETION_TAG,
  FACET_DEPLOYMENT_TAG,
  FACET_TAG,
  KINDS,
} from "./constants";
import { assessmentId, membershipId } from "./ids";
import {
  assessmentMutationSchema,
  boardMutationSchema,
  capabilityMutationSchema,
  deploymentMutationSchema,
  featureAreaMutationSchema,
  membershipMutationSchema,
  subjectMutationSchema,
  threadStateMutationSchema,
} from "./schemas";
import { boardIdForEvent, compareEvents, getTag, getTags, hasTag, targetForComment } from "./tags";
import type {
  ActivityItem,
  Assessment,
  Board,
  BoardProjection,
  Capability,
  ComparisonSubject,
  DeploymentControl,
  EntityState,
  FeatureArea,
  Membership,
  Mutation,
  MutationOperation,
  ProjectedComment,
  ProjectedEntity,
  SubjectState,
  ThreadStateValue,
} from "./types";

type MutationValue =
  | DeploymentControl
  | Board
  | Membership
  | ComparisonSubject
  | FeatureArea
  | Capability
  | Assessment
  | ThreadStateValue;

type ParsedMutation = Mutation<MutationValue>;

export type ProjectionOptions = {
  importerPubkeys?: string[];
  verifySignatures?: boolean;
  /** Canonical stored kind 5 events whose targets may already have been removed by strfry. */
  orphanedDeletionEventIds?: ReadonlySet<string> | "all";
};

type CommentDeletionReceipt = {
  event: NostrEvent;
  commentId: string;
  editIds: string[];
  boardId: string;
  featureAreaId: string;
  capabilityId: string;
  threadId: string;
  rootCommentId: string;
  parentCommentId?: string;
  originalCreatedAt: number;
  target: string;
};

type ProjectionContext = {
  superAdmin?: string;
  deployment?: ProjectedEntity<DeploymentControl>;
  board?: ProjectedEntity<Board>;
  memberships: Map<string, ProjectedEntity<Membership>>;
  subjects: Map<string, ProjectedEntity<ComparisonSubject>>;
  featureAreas: Map<string, ProjectedEntity<FeatureArea>>;
  capabilities: Map<string, ProjectedEntity<Capability>>;
  assessments: Map<string, ProjectedEntity<Assessment>>;
  threadStates: Map<string, ProjectedEntity<ThreadStateValue>>;
  acceptedComments: Map<string, NostrEvent>;
  acceptedReactions: Map<string, NostrEvent>;
  acceptedEdits: NostrEvent[];
  acceptedDeletions: NostrEvent[];
  candidateDeletionReceipts: Map<string, CommentDeletionReceipt>;
  acceptedDeletionReceipts: Map<string, CommentDeletionReceipt>;
  deletedTargetIds: Set<string>;
  orphanedDeletionEventIds: ReadonlySet<string> | "all" | undefined;
  activity: ActivityItem[];
  invalidEvents: Array<{ event: NostrEvent; reason: string }>;
};

const KIND_NAMES: Record<number, string> = {
  [KINDS.deployment]: "deployment",
  [KINDS.board]: "board",
  [KINDS.membership]: "membership",
  [KINDS.subject]: "comparison subject",
  [KINDS.featureArea]: "feature area",
  [KINDS.capability]: "capability",
  [KINDS.assessment]: "assessment",
  [KINDS.threadState]: "thread",
};

export function projectBoard(
  sourceEvents: NostrEvent[],
  boardId: string,
  options: ProjectionOptions = {},
): BoardProjection {
  const events = [...sourceEvents].sort(compareEvents);
  const candidateDeletionReceipts = new Map<string, CommentDeletionReceipt>();
  for (const event of events) {
    if (
      event.kind !== KINDS.deletion ||
      boardIdForEvent(event) !== boardId ||
      !hasTag(event, "-") ||
      !hasTag(event, "t", FACET_TAG) ||
      (options.verifySignatures !== false && !verifyEvent(event))
    ) {
      continue;
    }
    const receipt = parseCommentDeletionReceipt(event);
    if (receipt) candidateDeletionReceipts.set(receipt.commentId, receipt);
  }
  const context: ProjectionContext = {
    memberships: new Map(),
    subjects: new Map(),
    featureAreas: new Map(),
    capabilities: new Map(),
    assessments: new Map(),
    threadStates: new Map(),
    acceptedComments: new Map(),
    acceptedReactions: new Map(),
    acceptedEdits: [],
    acceptedDeletions: [],
    candidateDeletionReceipts,
    acceptedDeletionReceipts: new Map(),
    deletedTargetIds: new Set(),
    orphanedDeletionEventIds: options.orphanedDeletionEventIds,
    activity: [],
    invalidEvents: [],
  };
  const importerPubkeys = new Set(options.importerPubkeys ?? []);

  for (const event of events) {
    if (options.verifySignatures !== false && !verifyEvent(event)) {
      reject(context, event, "Invalid Nostr event signature or ID.");
      continue;
    }
    if (!hasTag(event, "-")) {
      reject(context, event, "Facet writes must carry the NIP-70 protected-event tag.");
      continue;
    }

    if (event.kind === KINDS.deployment) {
      if (!hasTag(event, "t", FACET_DEPLOYMENT_TAG)) {
        reject(context, event, "Deployment event is missing the Facet deployment tag.");
        continue;
      }
      processDeployment(context, event);
      continue;
    }
    if (boardIdForEvent(event) !== boardId) continue;
    if (!hasTag(event, "t", FACET_TAG)) {
      reject(context, event, "Board event is missing the facet.v1 protocol tag.");
      continue;
    }

    if (event.kind >= KINDS.board && event.kind <= KINDS.threadState) {
      processMutation(context, event, boardId, importerPubkeys);
      continue;
    }
    processCollaboration(context, event, importerPubkeys);
  }

  const comments = deriveComments(context);
  const deletedIds = deletedEventIds(context.acceptedDeletions);
  const reactions = [...context.acceptedReactions.values()]
    .filter((reaction) => {
      const targetId = getTag(reaction, "e");
      return !deletedIds.has(reaction.id) && (!targetId || !deletedIds.has(targetId));
    })
    .sort((a, b) => compareEvents(b, a));

  return {
    boardId,
    ...(context.superAdmin ? { superAdminPubkey: context.superAdmin } : {}),
    ...(context.board ? { board: context.board } : {}),
    memberships: context.memberships,
    subjects: context.subjects,
    featureAreas: context.featureAreas,
    capabilities: context.capabilities,
    assessments: context.assessments,
    threadStates: context.threadStates,
    comments,
    reactions,
    activity: [...context.activity].sort(
      (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
    ),
    invalidEvents: context.invalidEvents,
  };
}

export function FacetBoardsModel(options: ProjectionOptions = {}): Model<BoardProjection[]> {
  return (store) => {
    const filters: Filter[] = [
      { kinds: [KINDS.deployment], "#t": [FACET_DEPLOYMENT_TAG] },
      {
        kinds: [
          KINDS.board,
          KINDS.membership,
          KINDS.subject,
          KINDS.featureArea,
          KINDS.capability,
          KINDS.assessment,
          KINDS.threadState,
          KINDS.comment,
          KINDS.commentEdit,
          KINDS.reaction,
          KINDS.deletion,
        ],
      },
    ];
    return store.timeline(filters, true).pipe(
      map((events) => {
        const boardIds = [
          ...new Set(
            events.map((event) => boardIdForEvent(event)).filter((id): id is string => Boolean(id)),
          ),
        ];
        return boardIds
          .map((id) => projectBoard(events, id, options))
          .filter((projection) => projection.board !== undefined)
          .sort((a, b) => a.board!.value.name.localeCompare(b.board!.value.name));
      }),
    );
  };
}

FacetBoardsModel.getKey = () => "facet-boards";

export function FacetDeploymentModel(): Model<string | undefined> {
  return (store) =>
    store
      .timeline({ kinds: [KINDS.deployment], "#t": [FACET_DEPLOYMENT_TAG] }, true)
      .pipe(map((events) => projectBoard(events, "").superAdminPubkey));
}

FacetDeploymentModel.getKey = () => "facet-deployment";

export function FacetBoardModel(
  boardId: string,
  options: ProjectionOptions = {},
): Model<BoardProjection> {
  return (store) => {
    const filters: Filter[] = [
      { kinds: [KINDS.deployment], "#t": [FACET_DEPLOYMENT_TAG] },
      {
        kinds: [
          KINDS.board,
          KINDS.membership,
          KINDS.subject,
          KINDS.featureArea,
          KINDS.capability,
          KINDS.assessment,
          KINDS.threadState,
          KINDS.comment,
          KINDS.commentEdit,
          KINDS.reaction,
          KINDS.deletion,
        ],
        "#b": [boardId],
      },
    ];
    return store
      .timeline(filters, true)
      .pipe(map((events) => projectBoard(events, boardId, options)));
  };
}

FacetBoardModel.getKey = (boardId: string) => `facet-board:${boardId}`;

function processDeployment(context: ProjectionContext, event: NostrEvent): boolean {
  const parsed = parseJson(event, deploymentMutationSchema);
  if (!parsed.ok) return reject(context, event, parsed.reason);
  const mutation = parsed.value;
  if (mutation.entityId !== "deployment") {
    return reject(context, event, "Deployment entityId must be 'deployment'.");
  }
  if (
    getTag(event, "x") !== mutation.entityId ||
    getTag(event, "p") !== mutation.value.superAdminPubkey
  ) {
    return reject(context, event, "Deployment tags do not match content.");
  }
  if (mutation.operation === "bootstrap") {
    if (mutation.baseEventId !== null) {
      return reject(context, event, "Bootstrap must not reference a predecessor event.");
    }
    if (context.superAdmin) return reject(context, event, "Deployment is already bootstrapped.");
    if (event.pubkey !== mutation.value.superAdminPubkey) {
      return reject(context, event, "Bootstrap must establish the signing pubkey.");
    }
    context.superAdmin = event.pubkey;
    context.deployment = applyProjected(context.deployment, mutation.value, event);
    acceptActivity(context, event, "Bootstrapped the Facet deployment");
    return true;
  }
  if (mutation.operation === "rotate") {
    if (!context.superAdmin || event.pubkey !== context.superAdmin) {
      return reject(context, event, "Only the current super-admin may rotate deployment control.");
    }
    if (!baseReferencesHistory(mutation.baseEventId, context.deployment)) {
      return reject(context, event, "Deployment rotation references an unknown predecessor.");
    }
    context.superAdmin = mutation.value.superAdminPubkey;
    context.deployment = applyProjected(context.deployment, mutation.value, event);
    acceptActivity(context, event, "Rotated deployment control");
    return true;
  }
  return reject(context, event, "Unsupported deployment operation.");
}

function processMutation(
  context: ProjectionContext,
  event: NostrEvent,
  boardId: string,
  importerPubkeys: Set<string>,
): boolean {
  const parsed = parseMutation(event);
  if (!parsed.ok) return reject(context, event, parsed.reason);
  const mutation = parsed.value;
  if (getTag(event, "x") !== mutation.entityId || getTag(event, "o") !== mutation.operation) {
    return reject(context, event, "Mutation tags do not match its envelope.");
  }
  if (mutation.entityId !== valueId(mutation.value)) {
    return reject(context, event, "Mutation entityId does not match value.id.");
  }
  if (event.kind === KINDS.board) {
    const value = mutation.value as Board;
    if (getTag(event, "b") !== value.id || value.id !== boardId) {
      return reject(context, event, "Board scope does not match board value.");
    }
    if (value.visibility !== "public") {
      return reject(context, event, "Facet v1 accepts public boards only.");
    }
    if (mutation.operation === "create") {
      if (mutation.baseEventId !== null) {
        return reject(context, event, "Board creation must not reference a predecessor event.");
      }
      if (event.pubkey !== context.superAdmin) {
        return reject(context, event, "Only the super-admin may create a board.");
      }
      if (context.board) return reject(context, event, "Board already exists.");
    } else {
      if (!baseReferencesHistory(mutation.baseEventId, context.board)) {
        return reject(context, event, "Board mutation references an unknown predecessor.");
      }
      if (!isBoardAdmin(context, event.pubkey)) {
        return reject(context, event, "Only a board admin or super-admin may mutate the board.");
      }
    }
    if (!operationMatchesState(mutation.operation, value.state)) {
      return reject(context, event, "Board operation and resulting state disagree.");
    }
    context.board = applyProjected(context.board, value, event);
    acceptActivity(context, event, `${pastTense(mutation.operation)} board ${value.name}`);
    return true;
  }

  const valueBoardId = (mutation.value as { boardId?: string }).boardId;
  if (valueBoardId !== boardId || getTag(event, "b") !== boardId) {
    return reject(context, event, "Mutation board scope does not match its value.");
  }
  if (!context.board)
    return reject(context, event, "Board must exist before board-scoped mutations.");
  const importer = isImporter(event, mutation, importerPubkeys);
  if (isImportMarked(event) && !importer) {
    return reject(context, event, "Import metadata requires a configured importer key.");
  }
  if (
    importer &&
    !allowedImporterMutation(event.kind, mutation.operation, mutation.importMetadata?.source)
  ) {
    return reject(context, event, "Importer operation is not allowed for its source.");
  }
  if (context.board.value.state === "archived" && event.kind !== KINDS.board) {
    return reject(context, event, "Archived boards do not accept writes.");
  }

  if (event.kind === KINDS.membership) {
    const value = mutation.value as Membership;
    const previous = context.memberships.get(value.id);
    if (!isBoardAdmin(context, event.pubkey)) {
      return reject(context, event, "Only a board admin or super-admin may manage members.");
    }
    if (value.id !== membershipId(boardId, value.pubkey)) {
      return reject(context, event, "Membership ID is not deterministic for board and pubkey.");
    }
    if (getTag(event, "p") !== value.pubkey || getTag(event, "r") !== value.role) {
      return reject(context, event, "Membership tags do not match its value.");
    }
    if (!membershipOperationMatches(mutation.operation, value)) {
      return reject(context, event, "Membership operation and resulting role/state disagree.");
    }
    if (!validEntityBase(mutation, previous, ["add"])) {
      return reject(context, event, "Membership mutation references an unknown predecessor.");
    }
    if (removesAdmin(context, value) && activeAdminCount(context) <= 1) {
      return reject(context, event, "Cannot remove or demote the final board admin.");
    }
    context.memberships.set(value.id, applyProjected(previous, value, event));
    acceptActivity(
      context,
      event,
      `${pastTense(mutation.operation)} member ${shortPubkey(value.pubkey)}`,
    );
    return true;
  }

  if (!isActiveMember(context, event.pubkey) && !importer) {
    return reject(context, event, "Only current board members may mutate board content.");
  }

  if (event.kind === KINDS.subject) {
    const value = mutation.value as ComparisonSubject;
    if (getTag(event, "s") !== value.id) return reject(context, event, "Subject tag mismatch.");
    const previous = context.subjects.get(value.id);
    if (!validEntityBase(mutation, previous, ["create"])) {
      return reject(context, event, "Subject mutation references an unknown predecessor.");
    }
    if (previous?.value.state === "archived" && mutation.operation !== "restore") {
      return reject(context, event, "Archived subjects must be restored before mutation.");
    }
    if (mutation.operation === "restore" && !isBoardAdmin(context, event.pubkey)) {
      return reject(context, event, "Only a board admin may restore an archived subject.");
    }
    if (!entityOperationMatchesState(mutation.operation, value.state)) {
      return reject(context, event, "Subject operation and resulting state disagree.");
    }
    if (previous?.value.locked && !isBoardAdmin(context, event.pubkey)) {
      return reject(context, event, "Locked subjects require an administrative correction.");
    }
    context.subjects.set(value.id, applyProjected(previous, value, event));
    acceptActivity(context, event, `${pastTense(mutation.operation)} subject ${value.name}`);
    return true;
  }

  if (event.kind === KINDS.featureArea) {
    const value = mutation.value as FeatureArea;
    if (getTag(event, "f") !== value.id)
      return reject(context, event, "Feature-area tag mismatch.");
    const previous = context.featureAreas.get(value.id);
    if (!validEntityBase(mutation, previous, ["create"])) {
      return reject(context, event, "Feature-area mutation references an unknown predecessor.");
    }
    if (previous?.value.state === "archived" && mutation.operation !== "restore") {
      return reject(context, event, "Archived feature areas must be restored before mutation.");
    }
    if (mutation.operation === "restore" && !isBoardAdmin(context, event.pubkey)) {
      return reject(context, event, "Only a board admin may restore an archived feature area.");
    }
    if (!entityOperationMatchesState(mutation.operation, value.state)) {
      return reject(context, event, "Feature-area operation and resulting state disagree.");
    }
    if (
      mutation.operation === "archive" &&
      [...context.capabilities.values()].some(
        ({ value: capability }) =>
          capability.featureAreaId === value.id && capability.state === "active",
      )
    ) {
      return reject(context, event, "Archive active capabilities before their feature area.");
    }
    context.featureAreas.set(value.id, applyProjected(previous, value, event));
    acceptActivity(context, event, `${pastTense(mutation.operation)} feature area ${value.title}`);
    return true;
  }

  if (event.kind === KINDS.capability) {
    const value = mutation.value as Capability;
    if (getTag(event, "c") !== value.id || getTag(event, "f") !== value.featureAreaId) {
      return reject(context, event, "Capability scope tags mismatch.");
    }
    const area = context.featureAreas.get(value.featureAreaId)?.value;
    if (!area || area.state !== "active") {
      return reject(context, event, "Capability requires an active feature area.");
    }
    const previous = context.capabilities.get(value.id);
    if (!validEntityBase(mutation, previous, ["create"])) {
      return reject(context, event, "Capability mutation references an unknown predecessor.");
    }
    if (previous?.value.state === "archived" && mutation.operation !== "restore") {
      return reject(context, event, "Archived capabilities must be restored before mutation.");
    }
    if (mutation.operation === "restore" && !isBoardAdmin(context, event.pubkey)) {
      return reject(context, event, "Only a board admin may restore an archived capability.");
    }
    if (!entityOperationMatchesState(mutation.operation, value.state)) {
      return reject(context, event, "Capability operation and resulting state disagree.");
    }
    if (value.rationaleCommentId) {
      const rationale = commentReferenceAt(context, value.rationaleCommentId, event);
      const newlySelectsDeletedRationale =
        commentWasDeletedBefore(context, value.rationaleCommentId, event) &&
        previous?.value.rationaleCommentId !== value.rationaleCommentId;
      if (!rationale || getTag(rationale, "c") !== value.id || newlySelectsDeletedRationale) {
        return reject(
          context,
          event,
          "Capability rationale must reference a comment in its discussion.",
        );
      }
    }
    context.capabilities.set(value.id, applyProjected(previous, value, event));
    acceptActivity(context, event, `${pastTense(mutation.operation)} capability ${value.title}`);
    return true;
  }

  if (event.kind === KINDS.assessment) {
    const value = mutation.value as Assessment;
    if (
      getTag(event, "c") !== value.capabilityId ||
      getTag(event, "f") !== value.featureAreaId ||
      getTag(event, "s") !== value.subjectId
    ) {
      return reject(context, event, "Assessment scope tags mismatch.");
    }
    const subject = context.subjects.get(value.subjectId)?.value;
    const capability = context.capabilities.get(value.capabilityId)?.value;
    const previous = context.assessments.get(value.id);
    if (!validEntityBase(mutation, previous, ["create"])) {
      return reject(context, event, "Assessment mutation references an unknown predecessor.");
    }
    if (value.id !== assessmentId(boardId, value.capabilityId, value.subjectId)) {
      return reject(
        context,
        event,
        "Assessment ID is not deterministic for board, capability, and subject.",
      );
    }
    if (capability && value.featureAreaId !== capability.featureAreaId) {
      return reject(context, event, "Assessment feature area does not match its capability.");
    }
    if (!subject || subject.state === "archived" || !capability || capability.state !== "active") {
      return reject(
        context,
        event,
        "Assessment requires an unarchived subject and active capability.",
      );
    }
    if (previous?.value.state === "archived" && mutation.operation !== "restore") {
      return reject(context, event, "Archived assessments must be restored before mutation.");
    }
    if (mutation.operation === "restore" && !isBoardAdmin(context, event.pubkey)) {
      return reject(context, event, "Only a board admin may restore an archived assessment.");
    }
    if (!entityOperationMatchesState(mutation.operation, value.state)) {
      return reject(context, event, "Assessment operation and resulting state disagree.");
    }
    if (subject.locked && !importer && !isBoardAdmin(context, event.pubkey)) {
      return reject(
        context,
        event,
        "Locked-subject assessments require an administrative correction.",
      );
    }
    context.assessments.set(value.id, applyProjected(previous, value, event));
    acceptActivity(context, event, `Set ${value.status.replaceAll("_", " ")} assessment`);
    return true;
  }

  if (event.kind === KINDS.threadState) {
    const value = mutation.value as ThreadStateValue;
    const previous = context.threadStates.get(value.id);
    if (!validEntityBase(mutation, previous, ["resolve"])) {
      return reject(context, event, "Thread mutation references an unknown predecessor.");
    }
    const rootComment = commentReferenceAt(context, value.rootCommentId, event);
    if (!rootComment) {
      return reject(context, event, "Thread state references an unknown root comment.");
    }
    if (
      isReplyReference(context, value.rootCommentId, rootComment) ||
      getTag(rootComment, "c") !== value.capabilityId ||
      (getTag(rootComment, "x") ?? rootComment.id) !== value.id ||
      getTag(event, "c") !== value.capabilityId ||
      context.capabilities.get(value.capabilityId)?.value.state !== "active" ||
      context.featureAreas.get(getTag(rootComment, "f") ?? "")?.value.state !== "active"
    ) {
      return reject(context, event, "Thread state scope does not match an active root discussion.");
    }
    if (importer && !hasTag(rootComment, "t", "imported-outline")) {
      return reject(
        context,
        event,
        "Imported thread state must target an imported Outline thread.",
      );
    }
    if (
      (mutation.operation === "resolve" && value.state !== "resolved") ||
      (mutation.operation === "reopen" && value.state !== "open")
    ) {
      return reject(context, event, "Thread operation and state disagree.");
    }
    context.threadStates.set(value.id, applyProjected(previous, value, event));
    acceptActivity(context, event, `${pastTense(mutation.operation)} discussion thread`);
    return true;
  }
  return reject(context, event, "Unsupported board mutation kind.");
}

function processCollaboration(
  context: ProjectionContext,
  event: NostrEvent,
  importerPubkeys: Set<string>,
): boolean {
  if (!context.board || context.board.value.state !== "active") {
    return reject(context, event, "Active board required for collaboration events.");
  }
  const importer = importerPubkeys.has(event.pubkey) && hasTag(event, "t", "imported-outline");
  const currentMember = isActiveMember(context, event.pubkey);
  if (isImportMarked(event) && !importer) {
    return reject(
      context,
      event,
      "Imported collaboration events require a configured importer key.",
    );
  }
  if (!currentMember && !importer) {
    return reject(context, event, "Only current members may collaborate.");
  }
  const capabilityId = getTag(event, "c");
  const featureAreaId = getTag(event, "f");
  const capability = capabilityId ? context.capabilities.get(capabilityId)?.value : undefined;
  if (
    !capabilityId ||
    !featureAreaId ||
    capability?.state !== "active" ||
    context.featureAreas.get(featureAreaId)?.value.state !== "active" ||
    getTags(event, "b").length !== 1 ||
    getTags(event, "c").length !== 1 ||
    getTags(event, "f").length !== 1
  ) {
    return reject(context, event, "Collaboration requires an active capability and feature area.");
  }

  if (event.kind === KINDS.comment) {
    if (!currentMember && !importer)
      return reject(context, event, "Only current members may comment.");
    const threadId = getTag(event, "x");
    if (!threadId || getTags(event, "x").length !== 1) {
      return reject(context, event, "Comment requires exactly one stable thread ID.");
    }
    const capabilityPointers = capabilityEventIds(context, capabilityId);
    const discussionRootId = getTag(event, "E");
    if (
      getTag(event, "K") !== String(KINDS.capability) ||
      !discussionRootId ||
      !capabilityPointers.has(discussionRootId)
    ) {
      return reject(context, event, "Comment root pointer must reference its capability event.");
    }
    const parentId = replyEventId(event);
    if (parentId) {
      const parent = context.acceptedComments.get(parentId);
      const parentReceipt = context.candidateDeletionReceipts.get(parentId);
      if (!parent && !parentReceipt) return reject(context, event, "Reply parent is unknown.");
      if (commentWasDeletedBefore(context, parentId, event)) {
        return reject(context, event, "Replies cannot be added after their parent was deleted.");
      }
      if ((parent && replyEventId(parent)) || parentReceipt?.parentCommentId) {
        return reject(context, event, "Only one visible reply level is allowed.");
      }
      const parentScope = parent ?? parentReceipt!.event;
      if (!sameCommentThreadScope(event, parentScope)) {
        return reject(context, event, "Reply scope does not match its parent thread.");
      }
    } else if (
      capability.featureAreaId !== featureAreaId ||
      getTag(event, "k") !== String(KINDS.capability) ||
      !getTag(event, "e") ||
      !capabilityPointers.has(getTag(event, "e")!)
    ) {
      return reject(context, event, "Top-level comment must point to its capability event.");
    }
    if (
      importer &&
      parentId &&
      !hasTag(context.acceptedComments.get(parentId)!, "t", "imported-outline")
    ) {
      return reject(context, event, "Imported replies must target imported Outline comments.");
    }
    context.acceptedComments.set(event.id, event);
    acceptActivity(context, event, parentId ? "Replied to a comment" : "Commented on a capability");
    return true;
  }

  if (event.kind === KINDS.commentEdit) {
    if (!currentMember) return reject(context, event, "Only current members may edit comments.");
    const references = getTags(event, "e");
    if (references.length !== 1 || !references[0]?.[1]) {
      return reject(context, event, "Comment edit must reference exactly one original comment.");
    }
    const original = context.acceptedComments.get(references[0][1]);
    const receipt = context.candidateDeletionReceipts.get(references[0][1]);
    const originalReference = original ?? receipt?.event;
    if (!originalReference || originalReference.pubkey !== event.pubkey) {
      return reject(context, event, "Comment edit must target the author's original comment.");
    }
    if (commentWasDeletedBefore(context, references[0][1], event)) {
      return reject(context, event, "Deleted comments cannot be edited.");
    }
    if (hasTag(originalReference, "t", "imported-outline")) {
      return reject(context, event, "Imported comments are locked.");
    }
    if (!sameDiscussionScope(event, originalReference)) {
      return reject(context, event, "Comment edit scope does not match its original comment.");
    }
    context.acceptedEdits.push(event);
    acceptActivity(context, event, "Edited a comment");
    return true;
  }

  if (event.kind === KINDS.reaction) {
    if (!currentMember && !importer)
      return reject(context, event, "Only current members may react.");
    const targetId = getTag(event, "e");
    const target = targetId ? context.acceptedComments.get(targetId) : undefined;
    const receipt = targetId ? context.candidateDeletionReceipts.get(targetId) : undefined;
    const targetReference = target ?? receipt?.event;
    if (!targetReference || getTags(event, "e").length !== 1) {
      return reject(context, event, "Reaction must target a known comment.");
    }
    if (targetId && commentWasDeletedBefore(context, targetId, event)) {
      return reject(context, event, "Deleted comments cannot receive reactions.");
    }
    if (!sameDiscussionScope(event, targetReference)) {
      return reject(context, event, "Reaction scope does not match its target comment.");
    }
    if (importer && !hasTag(targetReference, "t", "imported-outline")) {
      return reject(context, event, "Imported reactions must target imported Outline comments.");
    }
    context.acceptedReactions.set(event.id, event);
    acceptActivity(context, event, "Reacted to a comment");
    return true;
  }

  if (event.kind === KINDS.deletion) {
    if (!currentMember)
      return reject(context, event, "Only current members may remove their content.");
    if (!hasTag(event, "t", FACET_DELETION_TAG)) {
      return reject(context, event, "Deletion is missing its Facet deletion-receipt tag.");
    }
    const targets = uniqueTagValues(event, "e");
    if (targets.length === 0 || targets.length !== getTags(event, "e").length) {
      return reject(context, event, "Deletion targets must be non-empty and unique.");
    }

    const commentReceipt = parseCommentDeletionReceipt(event);
    if (commentReceipt) {
      const expectedTargets = new Set([commentReceipt.commentId, ...commentReceipt.editIds]);
      if (
        expectedTargets.size !== targets.length ||
        targets.some((target) => !expectedTargets.has(target))
      ) {
        return reject(context, event, "Comment deletion targets do not match its signed receipt.");
      }
      const original = context.acceptedComments.get(commentReceipt.commentId);
      const orphanAllowed = mayAcceptOrphanedDeletion(context, event);
      if (!original && !orphanAllowed) {
        return reject(context, event, "Comment deletion must target a known original comment.");
      }
      if (original) {
        if (
          original.pubkey !== event.pubkey ||
          hasTag(original, "t", "imported-outline") ||
          !sameCommentThreadScope(event, original) ||
          replyEventId(original) !== commentReceipt.parentCommentId ||
          original.created_at !== commentReceipt.originalCreatedAt ||
          commentWasDeletedBefore(context, commentReceipt.commentId, event)
        ) {
          return reject(context, event, "Comment deletion receipt does not match its original.");
        }
        const knownEdits = new Map(context.acceptedEdits.map((edit) => [edit.id, edit]));
        const allEdits = context.acceptedEdits.filter(
          (edit) => getTag(edit, "e") === commentReceipt.commentId,
        );
        if (
          allEdits.length !== commentReceipt.editIds.length ||
          commentReceipt.editIds.some((id) => {
            const edit = knownEdits.get(id);
            return (
              !edit ||
              edit.pubkey !== event.pubkey ||
              getTag(edit, "e") !== commentReceipt.commentId ||
              !sameDiscussionScope(event, edit)
            );
          })
        ) {
          return reject(
            context,
            event,
            "Comment deletion must include every accepted edit of the original comment.",
          );
        }
      }
      context.acceptedDeletionReceipts.set(commentReceipt.commentId, commentReceipt);
    } else {
      if (targets.length !== 1 || !getTags(event, "k").some((tag) => tag[1] === "7")) {
        return reject(
          context,
          event,
          "Deletion may target only a comment with a complete receipt or one reaction.",
        );
      }
      const target = context.acceptedReactions.get(targets[0]!);
      if (!target && !mayAcceptOrphanedDeletion(context, event)) {
        return reject(context, event, "Reaction deletion must target a known reaction.");
      }
      if (
        target &&
        (target.pubkey !== event.pubkey ||
          hasTag(target, "t", "imported-outline") ||
          !sameDiscussionScope(event, target) ||
          context.deletedTargetIds.has(target.id))
      ) {
        return reject(context, event, "Reaction deletion does not match its target.");
      }
    }
    context.acceptedDeletions.push(event);
    for (const target of targets) context.deletedTargetIds.add(target);
    acceptActivity(context, event, "Removed authored content");
    return true;
  }
  return reject(context, event, "Unsupported collaboration event kind.");
}

function deriveComments(context: ProjectionContext): ProjectedComment[] {
  const deletedIds = deletedEventIds(context.acceptedDeletions);
  const editsByOriginal = new Map<string, NostrEvent[]>();
  for (const edit of context.acceptedEdits) {
    const originalId = getTag(edit, "e");
    if (!originalId) continue;
    const edits = editsByOriginal.get(originalId) ?? [];
    edits.push(edit);
    editsByOriginal.set(originalId, edits);
  }
  const projectedById = new Map<string, ProjectedComment>();
  for (const event of context.acceptedComments.values()) {
    const parentCommentId = replyEventId(event);
    const parent = parentCommentId ? projectedById.get(parentCommentId) : undefined;
    const parentReceipt = parentCommentId
      ? context.candidateDeletionReceipts.get(parentCommentId)
      : undefined;
    const editHistory = (editsByOriginal.get(event.id) ?? []).sort((a, b) => compareEvents(b, a));
    const latestEdit = editHistory[0];
    const threadId = getTag(event, "x") ?? parent?.threadId ?? event.id;
    projectedById.set(event.id, {
      id: event.id,
      event,
      ...(context.acceptedDeletionReceipts.get(event.id)
        ? { deletionEvent: context.acceptedDeletionReceipts.get(event.id)!.event }
        : {}),
      content: latestEdit?.content ?? event.content,
      edited: Boolean(latestEdit),
      editHistory,
      deleted: deletedIds.has(event.id),
      imported: hasTag(event, "t", "imported-outline"),
      threadId,
      rootCommentId: parent?.rootCommentId ?? parentReceipt?.rootCommentId ?? event.id,
      ...(parentCommentId ? { parentCommentId } : {}),
      target: targetForComment(event),
    });
  }
  for (const receipt of context.acceptedDeletionReceipts.values()) {
    if (projectedById.has(receipt.commentId)) continue;
    projectedById.set(receipt.commentId, {
      id: receipt.commentId,
      event: receipt.event,
      deletionEvent: receipt.event,
      content: "",
      edited: receipt.editIds.length > 0,
      editHistory: [],
      deleted: true,
      imported: false,
      threadId: receipt.threadId,
      rootCommentId: receipt.rootCommentId,
      ...(receipt.parentCommentId ? { parentCommentId: receipt.parentCommentId } : {}),
      target: receipt.target,
    });
  }
  return [...projectedById.values()].sort((a, b) => compareEvents(a.event, b.event));
}

function capabilityEventIds(context: ProjectionContext, capabilityId: string): Set<string> {
  return new Set((context.capabilities.get(capabilityId)?.history ?? []).map((event) => event.id));
}

function sameDiscussionScope(left: NostrEvent, right: NostrEvent): boolean {
  return (
    boardIdForEvent(left) === boardIdForEvent(right) &&
    getTag(left, "f") === getTag(right, "f") &&
    getTag(left, "c") === getTag(right, "c")
  );
}

function sameCommentThreadScope(left: NostrEvent, right: NostrEvent): boolean {
  return (
    sameDiscussionScope(left, right) &&
    getTag(left, "x") === getTag(right, "x") &&
    getTag(left, "s") === getTag(right, "s") &&
    targetForComment(left) === targetForComment(right)
  );
}

function parseCommentDeletionReceipt(event: NostrEvent): CommentDeletionReceipt | undefined {
  if (
    event.kind !== KINDS.deletion ||
    !hasTag(event, "t", FACET_TAG) ||
    !hasTag(event, "t", FACET_DELETION_TAG) ||
    !getTags(event, "k").some((tag) => tag[1] === String(KINDS.comment))
  ) {
    return undefined;
  }
  const commentId = singleTagValue(event, DELETED_COMMENT_TAG);
  const boardId = singleTagValue(event, "b");
  const featureAreaId = singleTagValue(event, "f");
  const capabilityId = singleTagValue(event, "c");
  const threadId = singleTagValue(event, "x");
  const rootCommentId = singleTagValue(event, COMMENT_ROOT_TAG);
  const createdAtValue = singleTagValue(event, COMMENT_CREATED_AT_TAG);
  const parentTags = getTags(event, COMMENT_PARENT_TAG);
  const targetTags = getTags(event, "t").filter((tag) => tag[1]?.startsWith("target:"));
  const target = targetTags[0]?.[1];
  const editTags = getTags(event, DELETED_EDIT_TAG);
  const editIds = uniqueTagValues(event, DELETED_EDIT_TAG);
  const originalCreatedAt = Number(createdAtValue);
  if (
    !commentId ||
    !boardId ||
    !featureAreaId ||
    !capabilityId ||
    !threadId ||
    !rootCommentId ||
    !createdAtValue ||
    parentTags.length > 1 ||
    targetTags.length !== 1 ||
    !target ||
    editIds.length !== editTags.length ||
    !Number.isSafeInteger(originalCreatedAt) ||
    originalCreatedAt < 0 ||
    originalCreatedAt > event.created_at
  ) {
    return undefined;
  }
  const parentCommentId = parentTags[0]?.[1];
  if (
    (parentCommentId && (parentCommentId !== rootCommentId || commentId === rootCommentId)) ||
    (!parentCommentId && commentId !== rootCommentId)
  ) {
    return undefined;
  }
  return {
    event,
    commentId,
    editIds,
    boardId,
    featureAreaId,
    capabilityId,
    threadId,
    rootCommentId,
    ...(parentCommentId ? { parentCommentId } : {}),
    originalCreatedAt,
    target,
  };
}

function singleTagValue(event: NostrEvent, name: string): string | undefined {
  const tags = getTags(event, name);
  return tags.length === 1 && tags[0]?.[1] ? tags[0][1] : undefined;
}

function uniqueTagValues(event: NostrEvent, name: string): string[] {
  return [
    ...new Set(
      getTags(event, name)
        .map((tag) => tag[1])
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function mayAcceptOrphanedDeletion(context: ProjectionContext, event: NostrEvent): boolean {
  return (
    context.orphanedDeletionEventIds === "all" ||
    context.orphanedDeletionEventIds?.has(event.id) === true
  );
}

function commentWasDeletedBefore(
  context: ProjectionContext,
  commentId: string,
  event: NostrEvent,
): boolean {
  const receipt = context.candidateDeletionReceipts.get(commentId);
  return Boolean(receipt && compareEvents(receipt.event, event) < 0);
}

function commentReferenceAt(
  context: ProjectionContext,
  commentId: string,
  _event: NostrEvent,
): NostrEvent | undefined {
  return (
    context.acceptedComments.get(commentId) ??
    context.candidateDeletionReceipts.get(commentId)?.event
  );
}

function isReplyReference(
  context: ProjectionContext,
  commentId: string,
  event: NostrEvent,
): boolean {
  return Boolean(
    replyEventId(event) || context.candidateDeletionReceipts.get(commentId)?.parentCommentId,
  );
}

function parseMutation(
  event: NostrEvent,
): { ok: true; value: ParsedMutation } | { ok: false; reason: string } {
  const schema =
    event.kind === KINDS.board
      ? boardMutationSchema
      : event.kind === KINDS.membership
        ? membershipMutationSchema
        : event.kind === KINDS.subject
          ? subjectMutationSchema
          : event.kind === KINDS.featureArea
            ? featureAreaMutationSchema
            : event.kind === KINDS.capability
              ? capabilityMutationSchema
              : event.kind === KINDS.assessment
                ? assessmentMutationSchema
                : threadStateMutationSchema;
  return parseJson(event, schema) as ReturnType<typeof parseMutation>;
}

function parseJson(
  event: NostrEvent,
  schema: {
    safeParse: (value: unknown) => {
      success: boolean;
      data?: unknown;
      error?: { message: string };
    };
  },
): { ok: true; value: any } | { ok: false; reason: string } {
  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    return { ok: false, reason: "Event content is not valid JSON." };
  }
  const result = schema.safeParse(content);
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        reason: `Event schema validation failed: ${result.error?.message ?? "unknown error"}`,
      };
}

function applyProjected<T>(
  previous: ProjectedEntity<T> | undefined,
  value: T,
  event: NostrEvent,
): ProjectedEntity<T> {
  const history = [...(previous?.history ?? []), event].sort((a, b) => compareEvents(b, a));
  const currentEvent =
    previous && compareEvents(previous.currentEvent, event) > 0 ? previous.currentEvent : event;
  return {
    value: currentEvent.id === event.id ? value : previous!.value,
    currentEvent,
    history,
  };
}

function validEntityBase<T>(
  mutation: ParsedMutation,
  previous: ProjectedEntity<T> | undefined,
  initialOperations: MutationOperation[],
): boolean {
  if (mutation.baseEventId === null) return initialOperations.includes(mutation.operation);
  return baseReferencesHistory(mutation.baseEventId, previous);
}

function baseReferencesHistory<T>(
  baseEventId: string | null,
  projected: ProjectedEntity<T> | undefined,
): boolean {
  return Boolean(
    baseEventId && projected?.history.some((historyEvent) => historyEvent.id === baseEventId),
  );
}

function isActiveMember(context: ProjectionContext, pubkey: string): boolean {
  if (context.superAdmin === pubkey) return true;
  return [...context.memberships.values()].some(
    ({ value }) => value.pubkey === pubkey && value.state === "active",
  );
}

function isBoardAdmin(context: ProjectionContext, pubkey: string): boolean {
  if (context.superAdmin === pubkey) return true;
  return [...context.memberships.values()].some(
    ({ value }) => value.pubkey === pubkey && value.state === "active" && value.role === "admin",
  );
}

function activeAdminCount(context: ProjectionContext): number {
  return [...context.memberships.values()].filter(
    ({ value }) => value.state === "active" && value.role === "admin",
  ).length;
}

function removesAdmin(context: ProjectionContext, next: Membership): boolean {
  const current = context.memberships.get(next.id)?.value;
  return Boolean(
    current?.state === "active" &&
      current.role === "admin" &&
      (next.state === "removed" || next.role !== "admin"),
  );
}

function membershipOperationMatches(operation: MutationOperation, value: Membership): boolean {
  if (operation === "add") return value.state === "active";
  if (operation === "remove") return value.state === "removed";
  if (operation === "promote") return value.state === "active" && value.role === "admin";
  if (operation === "demote") return value.state === "active" && value.role === "member";
  return false;
}

function operationMatchesState(operation: MutationOperation, state: Board["state"]): boolean {
  if (operation === "archive") return state === "archived";
  if (operation === "restore" || operation === "create" || operation === "update")
    return state === "active";
  return false;
}

function entityOperationMatchesState(
  operation: MutationOperation,
  state: EntityState | SubjectState,
): boolean {
  if (operation === "archive") return state === "archived";
  if (operation === "restore" || operation === "create" || operation === "update") {
    return state !== "archived";
  }
  return false;
}

function isImporter(
  event: NostrEvent,
  mutation: ParsedMutation,
  importerPubkeys: Set<string>,
): boolean {
  return Boolean(
    mutation.importMetadata &&
      importerPubkeys.has(event.pubkey) &&
      hasTag(event, "t", `imported-${mutation.importMetadata.source}`),
  );
}

function allowedImporterMutation(
  kind: number,
  operation: MutationOperation,
  source: "outline" | "flutter" | undefined,
): boolean {
  if (source === "outline") {
    if (
      kind === KINDS.subject ||
      kind === KINDS.featureArea ||
      kind === KINDS.capability ||
      kind === KINDS.assessment
    ) {
      return operation === "create";
    }
    return kind === KINDS.threadState && operation === "resolve";
  }
  if (source === "flutter") {
    return (kind === KINDS.subject || kind === KINDS.assessment) && operation === "create";
  }
  return false;
}

function isImportMarked(event: NostrEvent): boolean {
  return event.tags.some((tag) => tag[0] === "t" && tag[1]?.startsWith("imported-"));
}

function valueId(value: MutationValue): string {
  return "id" in value ? value.id : "deployment";
}

function replyEventId(event: NostrEvent): string | undefined {
  if (event.kind !== KINDS.comment || getTag(event, "k") !== String(KINDS.comment)) {
    return undefined;
  }
  return event.tags.find((tag) => tag[0] === "e" && tag[3] !== "previous")?.[1];
}

function deletedEventIds(events: NostrEvent[]): Set<string> {
  return new Set(
    events.flatMap(
      (event) =>
        getTags(event, "e")
          .map((tag) => tag[1])
          .filter(Boolean) as string[],
    ),
  );
}

function acceptActivity(context: ProjectionContext, event: NostrEvent, summary: string): void {
  const boardId = boardIdForEvent(event) ?? "deployment";
  const item: ActivityItem = {
    id: event.id,
    boardId,
    kind: event.kind,
    actor: event.pubkey,
    createdAt: event.created_at,
    event,
    summary,
  };
  context.activity.push(item);
}

function reject(context: ProjectionContext, event: NostrEvent, reason: string): false {
  context.invalidEvents.push({ event, reason });
  return false;
}

function pastTense(operation: MutationOperation): string {
  const words: Partial<Record<MutationOperation, string>> = {
    create: "Created",
    update: "Updated",
    archive: "Archived",
    restore: "Restored",
    add: "Added",
    remove: "Removed",
    promote: "Promoted",
    demote: "Demoted",
    resolve: "Resolved",
    reopen: "Reopened",
  };
  return words[operation] ?? operation;
}

function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
}

export function mutationNameForKind(kind: number): string {
  return KIND_NAMES[kind] ?? `kind ${kind}`;
}
