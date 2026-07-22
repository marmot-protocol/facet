import type { NostrEvent } from "nostr-tools";

export function getTag(event: Pick<NostrEvent, "tags">, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

export function getTags(event: Pick<NostrEvent, "tags">, name: string): string[][] {
  return event.tags.filter((tag) => tag[0] === name);
}

export function hasTag(event: Pick<NostrEvent, "tags">, name: string, value?: string): boolean {
  return event.tags.some((tag) => tag[0] === name && (value === undefined || tag[1] === value));
}

export function boardIdForEvent(event: Pick<NostrEvent, "tags">): string | undefined {
  return getTag(event, "b");
}

export function targetForComment(event: Pick<NostrEvent, "tags">): string {
  return (
    event.tags.find((tag) => tag[0] === "t" && tag[1]?.startsWith("target:"))?.[1] ??
    "target:capability"
  );
}

export function previousEventId(event: Pick<NostrEvent, "tags">): string | undefined {
  return event.tags.find((tag) => tag[0] === "e" && tag[3] === "previous")?.[1];
}

export function compareEvents(
  a: Pick<NostrEvent, "created_at" | "id">,
  b: Pick<NostrEvent, "created_at" | "id">,
): number {
  return a.created_at - b.created_at || a.id.localeCompare(b.id);
}

export function latestEvent<T extends NostrEvent>(events: T[]): T | undefined {
  return [...events].sort(compareEvents).at(-1);
}

export function scopeTags(scope: {
  boardId: string;
  entityId?: string;
  featureAreaId?: string;
  capabilityId?: string;
  subjectId?: string;
  operation?: string;
}): string[][] {
  const tags: string[][] = [["b", scope.boardId]];
  if (scope.entityId) tags.push(["x", scope.entityId]);
  if (scope.featureAreaId) tags.push(["f", scope.featureAreaId]);
  if (scope.capabilityId) tags.push(["c", scope.capabilityId]);
  if (scope.subjectId) tags.push(["s", scope.subjectId]);
  if (scope.operation) tags.push(["o", scope.operation]);
  return tags;
}
