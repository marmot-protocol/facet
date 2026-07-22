import { projectBoard } from "@facet/protocol";
import type { NostrEvent } from "nostr-tools";
import { importKey } from "./publisher";

export type ImportProjectionVerification = {
  expectedEvents: number;
  expectedImportKeys: number;
  projectedCounts: Record<string, number>;
};

export function verifyImportProjection(input: {
  boardEvents: NostrEvent[];
  importEvents: NostrEvent[];
  boardId: string;
  importerPubkey: string;
}): ImportProjectionVerification {
  const keys = input.importEvents.map(importKey);
  const duplicateKeys = duplicates(keys);
  if (duplicateKeys.length > 0) {
    throw new Error(`Import contains duplicate stable keys: ${duplicateKeys.join(", ")}`);
  }

  const events = deduplicateEvents([...input.boardEvents, ...input.importEvents]);
  const projection = projectBoard(events, input.boardId, {
    importerPubkeys: [input.importerPubkey],
  });
  if (!projection.board) throw new Error(`Board ${input.boardId} was not found or is not valid.`);
  if (projection.invalidEvents.length > 0) {
    const details = projection.invalidEvents
      .slice(0, 10)
      .map(({ event, reason }) => `${event.id} (kind ${event.kind}): ${reason}`)
      .join("\n");
    const remaining =
      projection.invalidEvents.length - Math.min(projection.invalidEvents.length, 10);
    throw new Error(
      `Import preflight found ${projection.invalidEvents.length} invalid event(s):\n${details}${remaining > 0 ? `\n...and ${remaining} more` : ""}`,
    );
  }

  return {
    expectedEvents: input.importEvents.length,
    expectedImportKeys: keys.length,
    projectedCounts: {
      subjects: projection.subjects.size,
      featureAreas: projection.featureAreas.size,
      capabilities: projection.capabilities.size,
      assessments: projection.assessments.size,
      comments: projection.comments.length,
      reactions: projection.reactions.length,
      threadStates: projection.threadStates.size,
    },
  };
}

export function deduplicateEvents(events: NostrEvent[]): NostrEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}
