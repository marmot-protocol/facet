import {
  type Assessment,
  type BoardProjection,
  type Capability,
  type ComparisonSubject,
  classifyGap,
  type FeatureArea,
} from "@facet/protocol";

export function activeCapabilities(projection: BoardProjection): Capability[] {
  return [...projection.capabilities.values()]
    .map(({ value }) => value)
    .filter((capability) => capability.state === "active")
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

export function activeFeatureAreas(projection: BoardProjection): FeatureArea[] {
  return [...projection.featureAreas.values()]
    .map(({ value }) => value)
    .filter((area) => area.state === "active")
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

export function assessmentsFor(projection: BoardProjection, capabilityId: string): Assessment[] {
  return [...projection.assessments.values()]
    .map(({ value }) => value)
    .filter(
      (assessment) => assessment.capabilityId === capabilityId && assessment.state === "active",
    );
}

export function assessmentFor(
  projection: BoardProjection,
  capabilityId: string,
  subjectId: string,
): Assessment | undefined {
  return assessmentsFor(projection, capabilityId).find(
    (assessment) => assessment.subjectId === subjectId,
  );
}

export function gapFor(
  projection: BoardProjection,
  capability: Capability,
  subjects: ComparisonSubject[],
) {
  return classifyGap(capability, subjects, assessmentsFor(projection, capability.id));
}

export function unresolvedThreadCount(projection: BoardProjection, capabilityId: string): number {
  const threadStates = new Map(
    [...projection.threadStates.values()].map(({ value }) => [value.id, value.state]),
  );
  const roots = projection.comments.filter(
    (comment) =>
      !comment.parentCommentId &&
      comment.event.tags.some((tag) => tag[0] === "c" && tag[1] === capabilityId),
  );
  return roots.filter((comment) => threadStates.get(comment.threadId) !== "resolved").length;
}
