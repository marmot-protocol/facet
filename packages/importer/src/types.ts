import type {
  DecisionStatus,
  DesiredOutcome,
  ImplementationStatus,
  Priority,
} from "@facet/protocol";

export type ImportedMatrix = {
  title: string;
  featureAreas: ImportedFeatureArea[];
  subjects: string[];
  warnings: ImportWarning[];
};

export type ImportedFeatureArea = {
  sourceId: string;
  title: string;
  description?: string;
  capabilities: ImportedCapability[];
};

export type ImportedCapability = {
  sourceId: string;
  title: string;
  description?: string;
  assessments: Record<string, ImplementationStatus>;
  desiredOutcome: DesiredOutcome;
  decisionStatus: DecisionStatus;
  priority: Priority;
  links: Array<{ label: string; url: string }>;
  sourceRow: number;
};

export type OutlineComment = {
  id: string;
  text: string;
  parentCommentId?: string;
  createdAt: string;
  updatedAt?: string;
  resolvedAt?: string;
  anchorText?: string;
  authorName: string;
  reactions: Array<{ emoji: string; userName?: string }>;
  attachmentOnly: boolean;
};

export type ImportWarning = {
  code:
    | "ambiguous_status"
    | "ambiguous_decision"
    | "orphan_comment"
    | "flattened_reply"
    | "attachment_omitted"
    | "source_disagreement"
    | "missing_evidence";
  sourceId: string;
  message: string;
};

export type ImportReport = {
  importerVersion: string;
  source: "outline" | "flutter";
  capturedAt: string;
  sourceDetails: Record<string, string>;
  sourceHashes: Record<string, string>;
  sourceCounts: Record<string, number>;
  importedCounts: Record<string, number>;
  skippedExisting: number;
  verification: ImportVerification;
  warnings: ImportWarning[];
  note: string;
};

export type ImportVerification = {
  expectedEvents: number;
  expectedImportKeys: number;
  pendingEvents: number;
  existingImportKeys: number;
  preflight: "not_run" | "passed";
  postPublish: "not_requested" | "passed";
  verifiedImportKeys: number;
  projectedCounts: Record<string, number>;
};
