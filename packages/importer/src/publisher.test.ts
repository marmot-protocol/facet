import type { NostrEvent } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { expectedImportFilters, importKey } from "./publisher";

describe("import publication lookup", () => {
  it("splits large imports into bounded stable-key queries", () => {
    const pubkey = "a".repeat(64);
    const events = Array.from({ length: 650 }, (_, index) => importedEvent(index, pubkey));
    const filters = expectedImportFilters(events, pubkey, "outline");

    expect(filters).toHaveLength(7);
    expect(filters.every((filter) => filter.limit === 100)).toBe(true);
    expect(filters.every((filter) => filter.authors?.[0] === pubkey)).toBe(true);
    expect(filters.every((filter) => filter["#b"]?.[0] === "white-noise")).toBe(true);
    expect(filters.flatMap((filter) => filter["#i"] ?? [])).toEqual(
      events.map((event) => event.tags.find((tag) => tag[0] === "i")![1]),
    );
    expect(new Set(events.map(importKey)).size).toBe(events.length);
  });
});

function importedEvent(index: number, pubkey: string): NostrEvent {
  const value = index.toString(16).padStart(64, "0");
  return {
    id: value,
    pubkey,
    created_at: 1_700_000_000,
    kind: 3505,
    tags: [
      ["b", "white-noise"],
      ["i", `capability-${index}:iOS`],
      ["t", "imported-outline"],
    ],
    content: "{}",
    sig: "b".repeat(128),
  };
}
