export const FACET_SCHEMA = "facet.v1" as const;
export const FACET_TAG = "facet" as const;
export const FACET_DEPLOYMENT_TAG = "facet-deployment" as const;
export const FACET_DELETION_TAG = "facet-deletion" as const;
export const DELETED_COMMENT_TAG = "deleted-comment" as const;
export const DELETED_EDIT_TAG = "deleted-edit" as const;
export const COMMENT_ROOT_TAG = "comment-root" as const;
export const COMMENT_PARENT_TAG = "comment-parent" as const;
export const COMMENT_CREATED_AT_TAG = "comment-created-at" as const;

export const KINDS = {
  deployment: 3499,
  board: 3500,
  membership: 3501,
  subject: 3502,
  featureArea: 3503,
  capability: 3504,
  assessment: 3505,
  threadState: 3506,
  comment: 1111,
  commentEdit: 1009,
  reaction: 7,
  deletion: 5,
  relayAuth: 22242,
} as const;

export const CUSTOM_KINDS = [
  KINDS.deployment,
  KINDS.board,
  KINDS.membership,
  KINDS.subject,
  KINDS.featureArea,
  KINDS.capability,
  KINDS.assessment,
  KINDS.threadState,
] as const;

export const BOARD_EVENT_KINDS = [
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
] as const;

// UUIDv5(URL, "https://facet.ipf.dev/protocol/facet.v1")
export const FACET_UUID_NAMESPACE = "4daa4a88-ad88-549d-bcd2-627549958627";

export const DEFAULT_CLOCK_SKEW_SECONDS = 300;

export type CustomKind = (typeof CUSTOM_KINDS)[number];
export type BoardEventKind = (typeof BOARD_EVENT_KINDS)[number];
