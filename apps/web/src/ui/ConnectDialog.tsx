import { KeyRound, PlugZap, Smartphone } from "lucide-react";
import { useState } from "react";
import { useRuntime } from "../runtime/provider";
import { Modal } from "./primitives";

export function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { runtime } = useRuntime();
  const [bunkerUri, setBunkerUri] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const connect = async (type: "extension" | "bunker" | "amber") => {
    setBusy(type);
    setError(undefined);
    try {
      if (type === "extension") await runtime.connectExtension();
      if (type === "bunker") await runtime.connectBunker(bunkerUri.trim());
      if (type === "amber") await runtime.connectAmber();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Connect a Nostr signer"
      description="Facet never receives or stores a private key. Browser extensions reconnect automatically on this device; remote signer and Amber sessions remain memory-only."
    >
      <div className="grid gap-3">
        <button
          type="button"
          className="panel flex cursor-pointer items-start gap-3 p-4 text-left"
          disabled={Boolean(busy)}
          onClick={() => void connect("extension")}
        >
          <PlugZap className="mt-0.5 text-[var(--accent)]" size={20} />
          <span>
            <strong className="block">Browser extension</strong>
            <span className="mt-0.5 block text-sm text-[var(--muted)]">
              NIP-07 extensions such as nos2x or Alby.
            </span>
          </span>
        </button>
        <div className="panel p-4">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 text-[var(--accent)]" size={20} />
            <div className="min-w-0 flex-1">
              <strong className="block">Remote signer</strong>
              <span className="mt-0.5 block text-sm text-[var(--muted)]">
                Paste a NIP-46 bunker URI. It is kept in memory only.
              </span>
              <input
                className="input mt-3"
                type="password"
                value={bunkerUri}
                onChange={(event) => setBunkerUri(event.target.value)}
                placeholder="bunker://…"
                autoComplete="off"
              />
              <button
                type="button"
                className="button mt-2"
                disabled={Boolean(busy) || !bunkerUri.startsWith("bunker://")}
                onClick={() => void connect("bunker")}
              >
                Connect bunker
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="panel flex cursor-pointer items-start gap-3 p-4 text-left"
          disabled={Boolean(busy)}
          onClick={() => void connect("amber")}
        >
          <Smartphone className="mt-0.5 text-[var(--accent)]" size={20} />
          <span>
            <strong className="block">Amber on Android</strong>
            <span className="mt-0.5 block text-sm text-[var(--muted)]">
              Uses Applesauce’s clipboard/intent signer for NIP-55-style Android signing.
            </span>
          </span>
        </button>
      </div>
      {busy ? (
        <p className="mt-3 text-sm text-[var(--muted)]">Waiting for signer approval…</p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md bg-[var(--critical-soft)] p-3 text-sm text-[var(--critical)]"
        >
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
