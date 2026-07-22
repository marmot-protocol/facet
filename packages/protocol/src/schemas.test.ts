import { describe, expect, it } from "vitest";
import { capabilityMutationSchema } from "./schemas";

describe("capability schema", () => {
  it("defaults existing capability events to in progress", () => {
    const parsed = capabilityMutationSchema.parse({
      schema: "facet.v1",
      operation: "create",
      entityId: "capability",
      baseEventId: null,
      value: {
        id: "capability",
        boardId: "board",
        featureAreaId: "area",
        title: "Capability",
        orderKey: "a0",
        state: "active",
        desiredOutcome: "undecided",
        decisionStatus: "open",
        priority: "none",
        links: [],
      },
    });

    expect(parsed.value.completionStatus).toBe("in_progress");
  });

  it("preserves an explicit complete state", () => {
    const parsed = capabilityMutationSchema.parse({
      schema: "facet.v1",
      operation: "update",
      entityId: "capability",
      baseEventId: "1".repeat(64),
      value: {
        id: "capability",
        boardId: "board",
        featureAreaId: "area",
        title: "Capability",
        orderKey: "a0",
        state: "active",
        desiredOutcome: "standardize",
        decisionStatus: "decided",
        priority: "none",
        completionStatus: "complete",
        links: [],
      },
    });

    expect(parsed.value.completionStatus).toBe("complete");
  });
});
