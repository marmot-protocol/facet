import { describe, expect, it } from "vitest";
import { mapImplementationStatus, parseOutlineMatrix } from "./markdown";

describe("Outline Markdown parser", () => {
  it("parses feature areas, capabilities, subject assessments, decisions, and links", () => {
    const result = parseOutlineMatrix(`# White Noise parity

## Messaging

| Capability | macOS | iOS | Android | Desired outcome | Decision status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| Message editing | Implemented | Partial | Missing | Standardize | Decided | Now | [Issue](https://example.com/1) |
| Typing indicators | Yes | Yes | Unknown | Keep as is | Open | Later | Current behavior |
`);
    expect(result.title).toBe("White Noise parity");
    expect(result.subjects).toEqual(["macOS", "iOS", "Android"]);
    expect(result.featureAreas).toHaveLength(1);
    expect(result.featureAreas[0]?.capabilities[0]).toMatchObject({
      title: "Message editing",
      assessments: { macOS: "implemented", iOS: "partial", Android: "not_implemented" },
      desiredOutcome: "standardize",
      decisionStatus: "decided",
      priority: "now",
    });
    expect(result.featureAreas[0]?.capabilities[0]?.links).toEqual([
      { label: "Issue", url: "https://example.com/1" },
    ]);
  });

  it("falls back to unknown and reports ambiguous statuses", () => {
    const warnings: Parameters<typeof mapImplementationStatus>[2] = [];
    expect(mapImplementationStatus("Sort of maybe", "row-1", warnings)).toBe("unknown");
    expect(warnings[0]?.code).toBe("ambiguous_status");
  });
});
