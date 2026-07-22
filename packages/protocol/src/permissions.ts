import type { NostrEvent } from "nostr-tools";
import { KINDS } from "./constants";
import { type ProjectionOptions, projectBoard } from "./projection";
import { boardIdForEvent, compareEvents } from "./tags";

export type AdmissionResult = { accepted: true } | { accepted: false; reason: string };

export type PolicyReplayState = {
  acceptedEvents: NostrEvent[];
  authorityHighWater: Map<string, Pick<NostrEvent, "created_at" | "id">>;
};

export function createPolicyReplayState(seedEvents: NostrEvent[] = []): PolicyReplayState {
  const authorityHighWater = new Map<string, Pick<NostrEvent, "created_at" | "id">>();
  for (const event of seedEvents.filter(isAuthorityEvent).sort(compareEvents)) {
    authorityHighWater.set(authorityScope(event), event);
  }
  return { acceptedEvents: [...seedEvents], authorityHighWater };
}

export function admitEvent(
  state: PolicyReplayState,
  event: NostrEvent,
  options: ProjectionOptions = {},
): AdmissionResult {
  const boardId = boardIdForEvent(event) ?? "";
  if (isAuthorityEvent(event)) {
    const highWater = state.authorityHighWater.get(authorityScope(event));
    if (highWater && compareEvents(event, highWater) <= 0) {
      return { accepted: false, reason: "Authority event does not advance the high-water mark." };
    }
  }

  const projection = projectBoard([...state.acceptedEvents, event], boardId, options);
  const rejection = projection.invalidEvents.find(({ event: invalid }) => invalid.id === event.id);
  if (rejection) return { accepted: false, reason: rejection.reason };

  state.acceptedEvents.push(event);
  if (isAuthorityEvent(event)) state.authorityHighWater.set(authorityScope(event), event);
  return { accepted: true };
}

function isAuthorityEvent(event: NostrEvent): boolean {
  return (
    event.kind === KINDS.deployment || event.kind === KINDS.board || event.kind === KINDS.membership
  );
}

function authorityScope(event: NostrEvent): string {
  return event.kind === KINDS.deployment ? "deployment" : (boardIdForEvent(event) ?? "unknown");
}
