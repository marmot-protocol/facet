import { BOARD_EVENT_KINDS, boardIdForEvent, getTag, hasTag, KINDS } from "@facet/protocol";
import type { EventSigner } from "applesauce-core/factories";
import { AuthRequiredError, type PublishResponse, Relay } from "applesauce-relay";
import type { Filter, NostrEvent } from "nostr-tools";

const LOOKUP_CHUNK_SIZE = 100;

export type ImportPublicationPlan = {
  expectedKeys: string[];
  existingEvents: NostrEvent[];
  pendingEvents: NostrEvent[];
  skipped: number;
};

export async function loadBoardEvents(relayUrl: string, boardId: string): Promise<NostrEvent[]> {
  const relay = new Relay(relayUrl);
  try {
    return await collect(
      relay.request([
        { kinds: [KINDS.deployment] },
        { kinds: [...BOARD_EVENT_KINDS], "#b": [boardId] },
      ]),
    );
  } finally {
    relay.close();
  }
}

export async function publishImportEvents(input: {
  relayUrl: string;
  signer: EventSigner;
  events: NostrEvent[];
  source: "outline" | "flutter";
  plan?: ImportPublicationPlan;
}): Promise<{
  published: number;
  skipped: number;
  verifiedEvents: NostrEvent[];
}> {
  const relay = new Relay(input.relayUrl);
  try {
    const pubkey = await input.signer.getPublicKey();
    const plan =
      input.plan ??
      (await createImportPublicationPlanWithRelay(relay, {
        pubkey,
        events: input.events,
        source: input.source,
      }));
    let published = 0;
    for (const event of plan.pendingEvents) {
      const key = importKey(event);
      let response: PublishResponse;
      try {
        response = await relay.publish(event, { retries: 0, timeout: 30_000 });
      } catch (error) {
        if (!(error instanceof AuthRequiredError)) throw error;
        const auth = await relay.authenticate(input.signer);
        if (!auth.ok) throw new Error(auth.message || `Could not authenticate importer ${pubkey}`);
        response = await relay.publish(event, { retries: 2, timeout: 30_000 });
      }
      if (!response.ok)
        throw new Error(`Relay rejected ${key}: ${response.message ?? "unknown reason"}`);
      published += 1;
    }

    const verifiedEvents = await loadExpectedImportEvents(relay, {
      pubkey,
      events: input.events,
      source: input.source,
    });
    const verifiedKeys = new Set(verifiedEvents.map(importKey));
    const missing = plan.expectedKeys.filter((key) => !verifiedKeys.has(key));
    if (missing.length > 0) {
      throw new Error(
        `Post-publish verification could not find ${missing.length} expected import key(s): ${missing.slice(0, 10).join(", ")}`,
      );
    }
    return { published, skipped: plan.skipped, verifiedEvents };
  } finally {
    relay.close();
  }
}

export async function createImportPublicationPlan(input: {
  relayUrl: string;
  signer: EventSigner;
  events: NostrEvent[];
  source: "outline" | "flutter";
}): Promise<ImportPublicationPlan> {
  const relay = new Relay(input.relayUrl);
  try {
    return await createImportPublicationPlanWithRelay(relay, {
      pubkey: await input.signer.getPublicKey(),
      events: input.events,
      source: input.source,
    });
  } finally {
    relay.close();
  }
}

async function createImportPublicationPlanWithRelay(
  relay: Relay,
  input: { pubkey: string; events: NostrEvent[]; source: "outline" | "flutter" },
): Promise<ImportPublicationPlan> {
  const expectedKeys = input.events.map(importKey);
  const duplicateKeys = duplicateValues(expectedKeys);
  if (duplicateKeys.length > 0) {
    throw new Error(`Import contains duplicate stable keys: ${duplicateKeys.join(", ")}`);
  }
  const existingEvents = await loadExpectedImportEvents(relay, input);
  const existingKeys = new Set(existingEvents.map(importKey));
  const pendingEvents = input.events.filter((event) => !existingKeys.has(importKey(event)));
  return {
    expectedKeys,
    existingEvents,
    pendingEvents,
    skipped: input.events.length - pendingEvents.length,
  };
}

async function loadExpectedImportEvents(
  relay: Relay,
  input: { pubkey: string; events: NostrEvent[]; source: "outline" | "flutter" },
): Promise<NostrEvent[]> {
  const expectedKeys = new Set(input.events.map(importKey));
  const found = new Map<string, NostrEvent>();
  for (const filter of expectedImportFilters(input.events, input.pubkey, input.source)) {
    for (const event of await collect(relay.request(filter))) {
      if (expectedKeys.has(importKey(event))) found.set(event.id, event);
    }
  }
  return [...found.values()];
}

export function expectedImportFilters(
  events: NostrEvent[],
  pubkey: string,
  source: "outline" | "flutter",
): Filter[] {
  const groups = new Map<
    string,
    { kind: number; board?: string; tag: "#i" | "#x" | "ids"; values: Set<string> }
  >();
  for (const event of events) {
    const board = boardIdForEvent(event);
    const sourceId = getTag(event, "i");
    const entityId = getTag(event, "x");
    const tag = sourceId ? "#i" : entityId ? "#x" : "ids";
    const value = sourceId ?? entityId ?? event.id;
    const groupKey = `${event.kind}:${board ?? "deployment"}:${tag}`;
    const group = groups.get(groupKey) ?? {
      kind: event.kind,
      ...(board ? { board } : {}),
      tag,
      values: new Set<string>(),
    };
    group.values.add(value);
    groups.set(groupKey, group);
  }

  const filters: Filter[] = [];
  for (const group of groups.values()) {
    for (const values of chunks([...group.values], LOOKUP_CHUNK_SIZE)) {
      const filter: Filter = {
        kinds: [group.kind],
        authors: [pubkey],
        "#t": [`imported-${source}`],
        limit: LOOKUP_CHUNK_SIZE,
        ...(group.board ? { "#b": [group.board] } : {}),
      };
      if (group.tag === "ids") filter.ids = values;
      else filter[group.tag] = values;
      filters.push(filter);
    }
  }
  return filters;
}

export function importKey(event: NostrEvent): string {
  const board = boardIdForEvent(event) ?? "deployment";
  const sourceId = getTag(event, "i");
  if (sourceId) return `source:${board}:${event.kind}:${sourceId}`;
  const entityId = getTag(event, "x");
  if (entityId) return `entity:${board}:${event.kind}:${entityId}`;
  return `event:${event.id}`;
}

export function isImportedForBoard(event: NostrEvent, boardId: string, source: string): boolean {
  return boardIdForEvent(event) === boardId && hasTag(event, "t", `imported-${source}`);
}

function collect(observable: ReturnType<Relay["request"]>): Promise<NostrEvent[]> {
  return new Promise((resolve, reject) => {
    const events: NostrEvent[] = [];
    observable.subscribe({
      next: (event) => events.push(event),
      complete: () => resolve(events),
      error: reject,
    });
  });
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}
