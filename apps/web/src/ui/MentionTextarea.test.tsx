// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EventStore } from "applesauce-core";
import { EventStoreProvider } from "applesauce-react/providers/store-provider";
import { nip19 } from "nostr-tools";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { encodeNostrMentions, type MentionReference, MentionTextarea } from "./MentionTextarea";
import { RichText } from "./primitives";

afterEach(cleanup);

describe("mention textarea", () => {
  it("offers board profiles and encodes the selected display token as a Nostr mention", async () => {
    const profile = {
      id: "1".repeat(64),
      pubkey: "2".repeat(64),
      sig: "3".repeat(128),
      kind: 0,
      created_at: 1,
      tags: [],
      content: JSON.stringify({ name: "jeffg", display_name: "Jeff Gardner" }),
    };
    const store = new EventStore({ verifyEvent: () => true });
    store.add(profile);

    function Harness() {
      const [value, setValue] = useState("");
      const [mentions, setMentions] = useState<MentionReference[]>([]);
      return (
        <EventStoreProvider eventStore={store}>
          <MentionTextarea
            aria-label="Comment"
            value={value}
            mentions={mentions}
            memberPubkeys={[profile.pubkey]}
            onValueChange={(nextValue, nextMentions) => {
              setValue(nextValue);
              setMentions(nextMentions);
            }}
          />
          <output data-testid="encoded">{encodeNostrMentions(value, mentions)}</output>
        </EventStoreProvider>
      );
    }

    render(<Harness />);
    const textarea = screen.getByLabelText("Comment");
    fireEvent.change(textarea, { target: { value: "Hi @", selectionStart: 4 } });
    const option = await screen.findByRole("option", { name: /Jeff Gardner/i });
    fireEvent.mouseDown(option);

    expect((textarea as HTMLTextAreaElement).value).toBe("Hi @jeffg ");
    await waitFor(() =>
      expect(screen.getByTestId("encoded").textContent).toBe(
        `Hi nostr:${nip19.npubEncode(profile.pubkey)} `,
      ),
    );
  });

  it("does not encode a selected handle embedded in a longer handle", () => {
    const pubkey = "1".repeat(64);
    expect(encodeNostrMentions("Ask @jeffgold, not @jeffg.", [{ token: "@jeffg", pubkey }])).toBe(
      `Ask @jeffgold, not nostr:${nip19.npubEncode(pubkey)}.`,
    );
  });

  it("renders a canonical Nostr mention with the profile display name", async () => {
    const profile = {
      id: "4".repeat(64),
      pubkey: "5".repeat(64),
      sig: "6".repeat(128),
      kind: 0,
      created_at: 1,
      tags: [],
      content: JSON.stringify({ name: "jeffg", display_name: "Jeff Gardner" }),
    };
    const store = new EventStore({ verifyEvent: () => true });
    store.add(profile);

    render(
      <EventStoreProvider eventStore={store}>
        <RichText content={`Ask nostr:${nip19.npubEncode(profile.pubkey)} about this.`} />
      </EventStoreProvider>,
    );

    expect((await screen.findByText("@Jeff Gardner")).textContent).toBe("@Jeff Gardner");
    expect(screen.queryByText(/nostr:npub/u)).toBeNull();
  });
});
