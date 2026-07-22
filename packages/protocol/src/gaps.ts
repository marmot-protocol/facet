import type {
  Assessment,
  Capability,
  ComparisonSubject,
  GapResult,
  ImplementationStatus,
  SelectedClientWork,
} from "./types";

const CONFIRMED = new Set<ImplementationStatus>([
  "implemented",
  "partial",
  "not_implemented",
  "stub_or_broken",
]);

export function targetStatusFor(capability: Capability): ImplementationStatus | undefined {
  if (capability.desiredOutcome === "add" || capability.desiredOutcome === "standardize") {
    return "implemented";
  }
  if (capability.desiredOutcome === "remove") return "not_implemented";
  return undefined;
}

export function classifyGap(
  capability: Capability,
  subjects: ComparisonSubject[],
  assessments: Assessment[],
): GapResult {
  const includedSubjects = subjects.filter(
    (subject) => subject.state === "active" && subject.includeInGapAnalysis,
  );
  const assessmentBySubject = new Map(assessments.map((item) => [item.subjectId, item]));
  const applicable = includedSubjects
    .map((subject) => ({ subject, assessment: assessmentBySubject.get(subject.id) }))
    .filter(({ assessment }) => assessment?.status !== "not_applicable");
  const confirmedStatuses = [
    ...new Set(
      applicable
        .map(({ assessment }) => assessment?.status ?? "unknown")
        .filter((status): status is ImplementationStatus => CONFIRMED.has(status)),
    ),
  ];
  const unknownSubjectIds = applicable
    .filter(({ assessment }) => !assessment || assessment.status === "unknown")
    .map(({ subject }) => subject.id);
  const targetStatus = targetStatusFor(capability);
  const mismatchedSubjectIds = targetStatus
    ? applicable
        .filter(({ assessment }) => (assessment?.status ?? "unknown") !== targetStatus)
        .map(({ subject }) => subject.id)
    : [];
  const materiallyMissingTargetSubjectIds = targetStatus
    ? applicable
        .filter(
          ({ assessment }) =>
            assessment && CONFIRMED.has(assessment.status) && assessment.status !== targetStatus,
        )
        .map(({ subject }) => subject.id)
    : [];

  const severeDivergence =
    confirmedStatuses.includes("implemented") &&
    (confirmedStatuses.includes("not_implemented") || confirmedStatuses.includes("stub_or_broken"));
  const decidedTargetMismatch =
    capability.decisionStatus === "decided" &&
    targetStatus !== undefined &&
    materiallyMissingTargetSubjectIds.length > 0;

  if ((capability.priority === "now" && severeDivergence) || decidedTargetMismatch) {
    return {
      label: "critical",
      reason:
        capability.priority === "now" && severeDivergence
          ? "Priority is now and active subjects have severe confirmed divergence."
          : "At least one active subject materially misses the decided target.",
      confirmedStatuses,
      unknownSubjectIds,
      mismatchedSubjectIds,
      ...(targetStatus ? { targetStatus } : {}),
    };
  }
  if (confirmedStatuses.length > 1) {
    return {
      label: "gap",
      reason: "Active subjects have different confirmed implementation states.",
      confirmedStatuses,
      unknownSubjectIds,
      mismatchedSubjectIds,
      ...(targetStatus ? { targetStatus } : {}),
    };
  }
  if (unknownSubjectIds.length > 0) {
    return {
      label: "needs_verification",
      reason: "No confirmed gap exists, but one or more active subjects are unknown.",
      confirmedStatuses,
      unknownSubjectIds,
      mismatchedSubjectIds,
      ...(targetStatus ? { targetStatus } : {}),
    };
  }
  return {
    label: "aligned",
    reason: "All applicable active subjects are materially aligned.",
    confirmedStatuses,
    unknownSubjectIds,
    mismatchedSubjectIds,
    ...(targetStatus ? { targetStatus } : {}),
  };
}

export function selectedClientWork(
  capability: Capability,
  assessment: Assessment | undefined,
  gap: GapResult,
): SelectedClientWork {
  const targetStatus = targetStatusFor(capability);
  if (
    capability.decisionStatus === "decided" &&
    targetStatus &&
    assessment?.status !== "not_applicable" &&
    assessment?.status !== targetStatus
  ) {
    return {
      category: "agreed_work",
      reason: `Selected subject is ${assessment?.status ?? "unknown"}; decided target is ${targetStatus}.`,
      targetStatus,
    };
  }
  if (
    (capability.decisionStatus === "open" || capability.decisionStatus === "discussing") &&
    (gap.label === "critical" || gap.label === "gap" || gap.label === "needs_verification")
  ) {
    return {
      category: "needs_decision",
      reason: "The capability has a relevant gap without a final product decision.",
      ...(targetStatus ? { targetStatus } : {}),
    };
  }
  return { category: "none", reason: "No selected-client action is implied." };
}
