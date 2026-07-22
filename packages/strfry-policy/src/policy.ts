import {
  type AdmissionResult,
  admitEvent,
  BOARD_EVENT_KINDS,
  boardIdForEvent,
  CUSTOM_KINDS,
  createPolicyReplayState,
  DEFAULT_CLOCK_SKEW_SECONDS,
  getTag,
  hasTag,
  KINDS,
  type PolicyReplayState,
  projectBoard,
} from "@facet/protocol";
import type { NostrEvent } from "nostr-tools";

export type StrfryPluginRequest = {
  type: "new";
  event: NostrEvent;
  receivedAt: number;
  sourceType: "IP4" | "IP6" | "Import" | "Stream" | "Sync" | "Stored";
  sourceInfo?: string;
  authed?: string;
};

export type StrfryPluginResponse = {
  id: string;
  action: "accept" | "reject" | "shadowReject";
  msg?: string;
};

export type PolicyOptions = {
  /** Importer keys whose historical events remain valid during replay. */
  importerPubkeys?: string[];
  /** Importer keys currently allowed to publish new import-marked events. */
  activeImporterPubkeys?: string[];
  maxClockSkewSeconds?: number;
  requireNip42?: boolean;
  allowOtherEvents?: boolean;
};

const FACET_KINDS = new Set<number>([KINDS.deployment, ...BOARD_EVENT_KINDS]);
const CUSTOM_KIND_SET = new Set<number>(CUSTOM_KINDS);

export class FacetWritePolicy {
  state: PolicyReplayState;
  readonly options: Required<PolicyOptions>;

  constructor(options: PolicyOptions = {}) {
    this.state = createPolicyReplayState();
    this.options = {
      importerPubkeys: options.importerPubkeys ?? [],
      activeImporterPubkeys: options.activeImporterPubkeys ?? options.importerPubkeys ?? [],
      maxClockSkewSeconds: options.maxClockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS,
      requireNip42: options.requireNip42 ?? true,
      allowOtherEvents: options.allowOtherEvents ?? false,
    };
  }

  replay(events: NostrEvent[]): void {
    const sorted = [...events].sort(
      (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
    );
    const boardIds = new Set(
      sorted.map((event) => boardIdForEvent(event)).filter((id): id is string => Boolean(id)),
    );
    const projectionOptions = {
      importerPubkeys: this.options.importerPubkeys,
      orphanedDeletionEventIds: "all" as const,
    };
    const projections = [
      projectBoard(sorted, "", projectionOptions),
      ...[...boardIds].map((boardId) => projectBoard(sorted, boardId, projectionOptions)),
    ];
    const invalid = projections.flatMap((projection) => projection.invalidEvents)[0];
    if (invalid) {
      throw new Error(
        `Refusing to start with invalid stored event ${invalid.event.id}: ${invalid.reason}`,
      );
    }
    this.state = createPolicyReplayState(sorted);
  }

  evaluate(request: StrfryPluginRequest): StrfryPluginResponse {
    const { event } = request;
    if (request.type !== "new") return reject(event.id, "invalid: unsupported plugin request");

    const isFacet = FACET_KINDS.has(event.kind) || hasTag(event, "t", "facet");
    if (!isFacet) {
      return this.options.allowOtherEvents
        ? { id: event.id, action: "accept" }
        : reject(event.id, "restricted: relay accepts Facet events only");
    }

    if (this.options.requireNip42 && request.authed !== event.pubkey) {
      return reject(event.id, "auth-required: authenticate as the event author");
    }

    if (!this.validClock(request)) {
      return reject(event.id, "invalid: created_at exceeds the accepted clock-skew window");
    }

    if (CUSTOM_KIND_SET.has(event.kind) && request.sourceType === "Import") {
      return reject(
        event.id,
        "restricted: custom mutations must be published through an authenticated connection",
      );
    }

    if (isImportMarked(event) && !this.options.activeImporterPubkeys.includes(event.pubkey)) {
      return reject(event.id, "restricted: importer key is not active for this migration window");
    }
    if (isImportMarked(event) && !allowedImporterEvent(event)) {
      return reject(event.id, "restricted: importer operation is not allowed for its source");
    }

    const result: AdmissionResult = admitEvent(this.state, event, {
      importerPubkeys: this.options.importerPubkeys,
      orphanedDeletionEventIds: new Set(
        this.state.acceptedEvents
          .filter((accepted) => accepted.kind === KINDS.deletion)
          .map((accepted) => accepted.id),
      ),
    });
    return result.accepted
      ? { id: event.id, action: "accept" }
      : reject(event.id, `restricted: ${result.reason}`);
  }

  private validClock(request: StrfryPluginRequest): boolean {
    return (
      Math.abs(request.receivedAt - request.event.created_at) <= this.options.maxClockSkewSeconds
    );
  }
}

function isImportMarked(event: NostrEvent): boolean {
  return event.tags.some((tag) => tag[0] === "t" && tag[1]?.startsWith("imported-"));
}

function allowedImporterEvent(event: NostrEvent): boolean {
  if (hasTag(event, "t", "imported-outline")) {
    if (event.kind === KINDS.comment || event.kind === KINDS.reaction) return true;
    if (
      event.kind === KINDS.subject ||
      event.kind === KINDS.featureArea ||
      event.kind === KINDS.capability ||
      event.kind === KINDS.assessment
    ) {
      return getTag(event, "o") === "create";
    }
    return event.kind === KINDS.threadState && getTag(event, "o") === "resolve";
  }
  if (hasTag(event, "t", "imported-flutter")) {
    return (
      (event.kind === KINDS.subject || event.kind === KINDS.assessment) &&
      getTag(event, "o") === "create"
    );
  }
  return false;
}

function reject(id: string, msg: string): StrfryPluginResponse {
  return { id, action: "reject", msg };
}
