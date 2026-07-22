import type { NostrEvent } from "nostr-tools";

export type EntityState = "active" | "archived";
export type SubjectState = "active" | "historical" | "archived";
export type Visibility = "public" | "private";
export type BoardRole = "member" | "admin";
export type MembershipState = "active" | "removed";
export type ImplementationStatus =
  | "unknown"
  | "not_implemented"
  | "partial"
  | "implemented"
  | "stub_or_broken"
  | "not_applicable";
export type DesiredOutcome =
  | "keep_as_is"
  | "add"
  | "remove"
  | "standardize"
  | "platform_specific"
  | "undecided";
export type DecisionStatus = "open" | "discussing" | "decided" | "superseded";
export type Priority = "now" | "next" | "later" | "none";
export type CompletionStatus = "in_progress" | "complete";
export type ThreadState = "open" | "resolved";
export type GapLabel = "critical" | "gap" | "needs_verification" | "aligned";

export type Link = {
  label: string;
  url: string;
};

export type Board = {
  id: string;
  name: string;
  description?: string;
  visibility: Visibility;
  state: EntityState;
};

export type Membership = {
  id: string;
  boardId: string;
  pubkey: string;
  role: BoardRole;
  state: MembershipState;
};

export type ComparisonSubject = {
  id: string;
  boardId: string;
  name: string;
  description?: string;
  icon?: string;
  orderKey: string;
  state: SubjectState;
  includeInGapAnalysis: boolean;
  locked: boolean;
};

export type FeatureArea = {
  id: string;
  boardId: string;
  title: string;
  description?: string;
  orderKey: string;
  state: EntityState;
};

export type Capability = {
  id: string;
  boardId: string;
  featureAreaId: string;
  title: string;
  description?: string;
  orderKey: string;
  state: EntityState;
  desiredOutcome: DesiredOutcome;
  decisionStatus: DecisionStatus;
  priority: Priority;
  completionStatus: CompletionStatus;
  rationaleCommentId?: string;
  links: Link[];
};

export type Assessment = {
  id: string;
  boardId: string;
  featureAreaId: string;
  capabilityId: string;
  subjectId: string;
  status: ImplementationStatus;
  note?: string;
  state: EntityState;
};

export type ThreadStateValue = {
  id: string;
  boardId: string;
  capabilityId: string;
  rootCommentId: string;
  state: ThreadState;
};

export type DeploymentControl = {
  superAdminPubkey: string;
};

export type MutationOperation =
  | "bootstrap"
  | "rotate"
  | "create"
  | "update"
  | "archive"
  | "restore"
  | "add"
  | "remove"
  | "promote"
  | "demote"
  | "resolve"
  | "reopen";

export type Mutation<T> = {
  schema: "facet.v1";
  operation: MutationOperation;
  entityId: string;
  baseEventId: string | null;
  value: T;
  importMetadata?: ImportMetadata;
};

export type ImportMetadata = {
  source: "outline" | "flutter";
  sourceId: string;
  originalAuthorName?: string;
  originalCreatedAt?: string;
  originalParentId?: string;
  flattenedFromDepth?: number;
  attachmentOmitted?: boolean;
};

export type EntityKindName =
  | "deployment"
  | "board"
  | "membership"
  | "subject"
  | "featureArea"
  | "capability"
  | "assessment"
  | "threadState";

export type ProjectedEntity<T> = {
  value: T;
  currentEvent: NostrEvent;
  history: NostrEvent[];
};

export type ProjectedComment = {
  /** Stable ID of the original kind 1111 comment, including for a synthetic tombstone. */
  id: string;
  /** Original comment when available; otherwise the signed kind 5 deletion receipt. */
  event: NostrEvent;
  deletionEvent?: NostrEvent;
  content: string;
  edited: boolean;
  editHistory: NostrEvent[];
  deleted: boolean;
  imported: boolean;
  threadId: string;
  rootCommentId: string;
  parentCommentId?: string;
  target: string;
};

export type ActivityItem = {
  id: string;
  boardId: string;
  kind: number;
  actor: string;
  createdAt: number;
  event: NostrEvent;
  summary: string;
};

export type BoardProjection = {
  boardId: string;
  superAdminPubkey?: string;
  board?: ProjectedEntity<Board>;
  memberships: Map<string, ProjectedEntity<Membership>>;
  subjects: Map<string, ProjectedEntity<ComparisonSubject>>;
  featureAreas: Map<string, ProjectedEntity<FeatureArea>>;
  capabilities: Map<string, ProjectedEntity<Capability>>;
  assessments: Map<string, ProjectedEntity<Assessment>>;
  threadStates: Map<string, ProjectedEntity<ThreadStateValue>>;
  comments: ProjectedComment[];
  reactions: NostrEvent[];
  activity: ActivityItem[];
  invalidEvents: Array<{ event: NostrEvent; reason: string }>;
};

export type GapResult = {
  label: GapLabel;
  reason: string;
  confirmedStatuses: ImplementationStatus[];
  unknownSubjectIds: string[];
  mismatchedSubjectIds: string[];
  targetStatus?: ImplementationStatus;
};

export type SelectedClientWork = {
  category: "agreed_work" | "needs_decision" | "none";
  reason: string;
  targetStatus?: ImplementationStatus;
};
