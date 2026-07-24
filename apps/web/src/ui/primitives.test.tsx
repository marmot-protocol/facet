// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { EventStore } from "applesauce-core";
import { EventStoreProvider } from "applesauce-react/providers/store-provider";
import { afterEach, describe, expect, it } from "vitest";
import { Identity } from "./primitives";

afterEach(cleanup);

describe("identity", () => {
  it("can render a profile name without repeating its avatar", async () => {
    const profile = {
      id: "1".repeat(64),
      pubkey: "2".repeat(64),
      sig: "3".repeat(128),
      kind: 0,
      created_at: 1,
      tags: [],
      content: JSON.stringify({
        display_name: "JeffG",
        picture: "https://example.com/avatar.jpg",
      }),
    };
    const store = new EventStore({ verifyEvent: () => true });
    store.add(profile);

    const { container } = render(
      <EventStoreProvider eventStore={store}>
        <Identity pubkey={profile.pubkey} showAvatar={false} />
      </EventStoreProvider>,
    );

    expect((await screen.findByText("JeffG")).textContent).toBe("JeffG");
    expect(container.querySelector("img")).toBeNull();
  });
});
