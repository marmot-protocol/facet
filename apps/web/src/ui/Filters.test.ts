import type { Assessment, BoardProjection, Capability, ProjectedEntity } from "@facet/protocol";
import type { NostrEvent } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, filterCapabilities } from "./Filters";
import { permissionsFor } from "./permissions";

const event: NostrEvent = {
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  created_at: 1,
  kind: 3505,
  tags: [],
  content: "",
  sig: "3".repeat(128),
};

const linkedCapability: Capability = {
  id: "linked",
  boardId: "board",
  featureAreaId: "messaging",
  title: "Message editing",
  description: "Edit an already sent message",
  orderKey: "a0",
  state: "active",
  desiredOutcome: "standardize",
  decisionStatus: "decided",
  priority: "now",
  completionStatus: "in_progress",
  links: [{ label: "Specification", url: "https://example.com/spec" }],
};

const otherCapability: Capability = {
  ...linkedCapability,
  id: "other",
  title: "Read receipts",
  description: "",
  desiredOutcome: "keep_as_is",
  decisionStatus: "open",
  priority: "later",
  completionStatus: "complete",
  links: [],
};

const assessment: Assessment = {
  id: "assessment",
  boardId: "board",
  featureAreaId: "messaging",
  capabilityId: linkedCapability.id,
  subjectId: "ios",
  status: "partial",
  state: "active",
};

const projection: BoardProjection = {
  boardId: "board",
  memberships: new Map(),
  subjects: new Map(),
  featureAreas: new Map(),
  capabilities: new Map(),
  assessments: new Map([[assessment.id, projected(assessment)]]),
  threadStates: new Map(),
  comments: [],
  reactions: [],
  activity: [],
  invalidEvents: [],
};

describe("capability filters", () => {
  it("combines query, selected-client assessment, decision, priority, and link filters", () => {
    const result = filterCapabilities([linkedCapability, otherCapability], projection, "ios", {
      ...EMPTY_FILTERS,
      query: "sent message",
      implementation: "partial",
      desiredOutcome: "standardize",
      decisionStatus: "decided",
      priority: "now",
      links: "linked",
    });

    expect(result).toEqual([linkedCapability]);
  });

  it("treats an absent assessment as unknown", () => {
    expect(
      filterCapabilities([otherCapability], projection, "ios", {
        ...EMPTY_FILTERS,
        implementation: "unknown",
      }),
    ).toEqual([otherCapability]);
  });

  it("filters and sorts by explicit capability completion", () => {
    expect(
      filterCapabilities([linkedCapability, otherCapability], projection, "ios", {
        ...EMPTY_FILTERS,
        completion: "complete",
      }),
    ).toEqual([otherCapability]);
    expect(
      filterCapabilities([linkedCapability, otherCapability], projection, "ios", {
        ...EMPTY_FILTERS,
        sort: "complete_first",
      }),
    ).toEqual([otherCapability, linkedCapability]);
    expect(
      filterCapabilities([otherCapability, linkedCapability], projection, "ios", {
        ...EMPTY_FILTERS,
        sort: "in_progress_first",
      }),
    ).toEqual([linkedCapability, otherCapability]);
  });
});

describe("board permissions", () => {
  it("disables every write capability while the browser is offline", () => {
    const superAdminProjection = { ...projection, superAdminPubkey: event.pubkey };
    expect(permissionsFor(superAdminProjection, event.pubkey, false)).toMatchObject({
      superAdmin: true,
      canWrite: false,
      canAdmin: false,
    });
  });
});

function projected<T>(value: T): ProjectedEntity<T> {
  return { value, currentEvent: event, history: [event] };
}
