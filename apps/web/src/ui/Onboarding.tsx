import { type Board, KINDS, type Membership, membershipId, newEntityId } from "@facet/protocol";
import { ArrowRight, Database, Radio, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { PublishMutation } from "../runtime/actions";
import { useRuntime } from "../runtime/provider";
import { ConnectDialog } from "./ConnectDialog";
import { useActionExecutor, useIdentity, useSuperAdmin } from "./hooks";
import { Identity } from "./primitives";

export function Onboarding() {
  const { runtime, status } = useRuntime();
  const { account, pubkey } = useIdentity();
  const superAdmin = useSuperAdmin();
  const { run, running, error } = useActionExecutor();
  const [connectOpen, setConnectOpen] = useState(false);
  const [boardName, setBoardName] = useState("White Noise");
  const [boardDescription, setBoardDescription] = useState(
    "Cross-client capability parity, product decisions, and implementation evidence.",
  );

  const bootstrap = async () => {
    if (!pubkey) return;
    await run(
      PublishMutation({
        kind: KINDS.deployment,
        operation: "bootstrap",
        entityId: "deployment",
        value: { superAdminPubkey: pubkey },
      }),
    );
  };

  const createBoard = async () => {
    if (!pubkey) return;
    const board: Board = {
      id: newEntityId(),
      name: boardName.trim(),
      description: boardDescription.trim(),
      visibility: "public",
      state: "active",
    };
    await run(
      PublishMutation({
        kind: KINDS.board,
        operation: "create",
        entityId: board.id,
        value: board,
      }),
    );
    const membership: Membership = {
      id: membershipId(board.id, pubkey),
      boardId: board.id,
      pubkey,
      role: "admin",
      state: "active",
    };
    await run(
      PublishMutation({
        kind: KINDS.membership,
        operation: "add",
        entityId: membership.id,
        value: membership,
      }),
    );
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-5 py-12">
      <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="self-center">
          <div className="mb-6 flex items-center gap-3">
            <span
              className="grid size-10 place-items-center text-[30px] leading-none"
              aria-hidden="true"
            >
              💠
            </span>
            <span className="text-lg font-extrabold tracking-tight">Facet</span>
          </div>
          <h1 className="m-0 max-w-2xl text-4xl font-black leading-[1.05] tracking-[-0.035em] md:text-6xl">
            Make cross-client decisions from signed, shared evidence.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--muted)]">
            A focused Nostr-native tracker for implementation parity, product decisions, and the
            discussion behind both.
          </p>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            <Feature
              icon={<ShieldCheck size={18} />}
              title="Signed history"
              detail="Every accepted change keeps its author and prior versions."
            />
            <Feature
              icon={<Database size={18} />}
              title="Portable data"
              detail="Ordinary Nostr events cached locally for fast reads."
            />
            <Feature
              icon={<Radio size={18} />}
              title="Direct relay"
              detail="No gateway, app server, passwords, or custody."
            />
          </div>
        </section>

        <section className="panel self-center p-6 shadow-[var(--shadow)]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--faint)]">
                Deployment setup
              </span>
              <h2 className="m-0 mt-1 text-xl font-extrabold">Start the first board</h2>
            </div>
            <span
              className={`size-2.5 rounded-full ${status.connected ? "bg-[var(--success)]" : "bg-[var(--critical)]"}`}
              title={status.connected ? "Relay connected" : "Relay disconnected"}
            />
          </div>

          {!account ? (
            <div>
              <p className="text-sm text-[var(--muted)]">
                Connect a signer. The first authenticated pubkey to bootstrap this empty deployment
                becomes its super-admin.
              </p>
              <button
                type="button"
                className="button button-primary mt-3 w-full"
                onClick={() => setConnectOpen(true)}
              >
                Connect a signer <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex items-center justify-between rounded-lg bg-[var(--sidebar)] p-3">
                <Identity pubkey={account.pubkey} />
                <button
                  type="button"
                  className="button button-ghost !min-h-7 text-xs"
                  onClick={() => void runtime.disconnect()}
                >
                  Disconnect
                </button>
              </div>

              {!superAdmin ? (
                <div>
                  <p className="text-sm text-[var(--muted)]">
                    The deployment has no super-admin yet. Bootstrap is one-time and cannot be
                    changed from the UI.
                  </p>
                  <button
                    type="button"
                    className="button button-primary mt-2 w-full"
                    disabled={running || !status.online}
                    onClick={() => void bootstrap()}
                  >
                    {running ? "Publishing…" : "Bootstrap deployment"}
                  </button>
                </div>
              ) : superAdmin !== pubkey ? (
                <p className="rounded-md bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning)]">
                  This deployment is already controlled by another pubkey. Connect the super-admin
                  to create its first board.
                </p>
              ) : (
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createBoard();
                  }}
                >
                  <label className="label">
                    Board name
                    <input
                      className="input"
                      value={boardName}
                      onChange={(event) => setBoardName(event.target.value)}
                      required
                      maxLength={160}
                    />
                  </label>
                  <label className="label">
                    Description
                    <textarea
                      className="input min-h-24 resize-y"
                      value={boardDescription}
                      onChange={(event) => setBoardDescription(event.target.value)}
                      maxLength={10_000}
                    />
                  </label>
                  <div className="rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
                    <strong className="text-[var(--text)]">Visibility: public.</strong> Private
                    boards are rejected until strfry supports board-aware authenticated reads.
                  </div>
                  <button
                    className="button button-primary"
                    disabled={running || !boardName.trim()}
                    type="submit"
                  >
                    {running ? "Creating…" : "Create White Noise board"}
                  </button>
                </form>
              )}
            </div>
          )}
          {status.error || error ? (
            <p
              role="alert"
              className="mt-4 rounded-md bg-[var(--critical-soft)] p-3 text-sm text-[var(--critical)]"
            >
              {error ?? status.error}
            </p>
          ) : null}
          <p className="mb-0 mt-5 text-center text-xs text-[var(--faint)]">
            Relay: {status.connected ? "connected" : "waiting"} · cache: {status.cachedEvents}{" "}
            events
          </p>
        </section>
      </div>
      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </main>
  );
}

function Feature({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="border-l-2 border-[var(--border)] pl-3">
      <span className="text-[var(--accent)]">{icon}</span>
      <strong className="mt-2 block text-sm">{title}</strong>
      <span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">{detail}</span>
    </div>
  );
}
