import { describe, expect, it } from "vitest";
import { classifyGap, selectedClientWork, targetStatusFor } from "./gaps";
import type { Assessment, Capability, ComparisonSubject } from "./types";

const capability: Capability = {
  id: "cap",
  boardId: "board",
  featureAreaId: "area",
  title: "Capability",
  orderKey: "a0",
  state: "active",
  desiredOutcome: "undecided",
  decisionStatus: "open",
  priority: "none",
  links: [],
};

const subjects: ComparisonSubject[] = [
  subject("mac", "active", true),
  subject("ios", "active", true),
  subject("flutter", "historical", false),
];

describe("gap classification", () => {
  it("treats every distinct confirmed status as a gap", () => {
    const result = classifyGap(capability, subjects, [
      assessment("mac", "partial"),
      assessment("ios", "not_implemented"),
    ]);
    expect(result.label).toBe("gap");
  });

  it("makes severe now-priority divergence critical", () => {
    const result = classifyGap({ ...capability, priority: "now" }, subjects, [
      assessment("mac", "implemented"),
      assessment("ios", "stub_or_broken"),
    ]);
    expect(result.label).toBe("critical");
  });

  it("makes decided-target misses critical only when priority is now", () => {
    const decided = {
      ...capability,
      desiredOutcome: "standardize" as const,
      decisionStatus: "decided" as const,
      priority: "later" as const,
    };
    expect(
      classifyGap(decided, subjects, [assessment("mac", "partial"), assessment("ios", "partial")])
        .label,
    ).toBe("gap");
    expect(
      classifyGap({ ...decided, priority: "now" }, subjects, [
        assessment("mac", "partial"),
        assessment("ios", "implemented"),
      ]).label,
    ).toBe("critical");
    expect(
      classifyGap(decided, subjects, [
        assessment("mac", "unknown"),
        assessment("ios", "implemented"),
      ]).label,
    ).toBe("needs_verification");
  });

  it("makes one lower-priority decided mismatch a gap when the other subjects match", () => {
    const activeSubjects = ["ios", "mac", "android", "linux"].map((id) =>
      subject(id, "active", true),
    );
    const result = classifyGap(
      {
        ...capability,
        desiredOutcome: "remove",
        decisionStatus: "decided",
        priority: "none",
      },
      activeSubjects,
      [
        assessment("ios", "not_implemented"),
        assessment("mac", "not_implemented"),
        assessment("android", "implemented"),
        assessment("linux", "not_implemented"),
      ],
    );

    expect(result.label).toBe("gap");
    expect(result.targetStatus).toBe("not_implemented");
    expect(result.mismatchedSubjectIds).toEqual(["android"]);
  });

  it("ignores historical subjects and not-applicable cells", () => {
    const result = classifyGap(capability, subjects, [
      assessment("mac", "implemented"),
      assessment("ios", "not_applicable"),
      assessment("flutter", "not_implemented"),
    ]);
    expect(result.label).toBe("aligned");
  });

  it("uses unknown only when no confirmed gap exists", () => {
    const result = classifyGap(capability, subjects, [
      assessment("mac", "implemented"),
      assessment("ios", "unknown"),
    ]);
    expect(result.label).toBe("needs_verification");
  });

  it("maps desired outcomes to their exact target", () => {
    expect(targetStatusFor({ ...capability, desiredOutcome: "add" })).toBe("implemented");
    expect(targetStatusFor({ ...capability, desiredOutcome: "standardize" })).toBe("implemented");
    expect(targetStatusFor({ ...capability, desiredOutcome: "remove" })).toBe("not_implemented");
    expect(targetStatusFor({ ...capability, desiredOutcome: "platform_specific" })).toBeUndefined();
  });

  it("separates agreed work from needs-decision work", () => {
    const decided: Capability = { ...capability, desiredOutcome: "add", decisionStatus: "decided" };
    const gap = classifyGap(decided, subjects, [
      assessment("mac", "partial"),
      assessment("ios", "implemented"),
    ]);
    expect(selectedClientWork(decided, assessment("mac", "partial"), gap).category).toBe(
      "agreed_work",
    );
    expect(selectedClientWork(capability, assessment("mac", "partial"), gap).category).toBe(
      "needs_decision",
    );
  });
});

function subject(
  id: string,
  state: ComparisonSubject["state"],
  include: boolean,
): ComparisonSubject {
  return {
    id,
    boardId: "board",
    name: id,
    orderKey: id,
    state,
    includeInGapAnalysis: include,
    locked: state === "historical",
  };
}

function assessment(subjectId: string, status: Assessment["status"]): Assessment {
  return {
    id: `assessment-${subjectId}`,
    boardId: "board",
    featureAreaId: "area",
    capabilityId: "cap",
    subjectId,
    status,
    state: "active",
  };
}
