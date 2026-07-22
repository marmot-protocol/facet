import { Bell, CheckCheck } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useRuntime } from "../../runtime/provider";
import { useBoardContext } from "../BoardShell";
import { useIdentity } from "../hooks";
import { Badge, EmptyState, formatRelative, Identity } from "../primitives";

type InboxItem = {
  id: string;
  capabilityId: string;
  actor: string;
  createdAt: number;
  reason: string;
  summary: string;
};

export function InboxPage() {
  const { projection } = useBoardContext();
  const { runtime } = useRuntime();
  const { pubkey } = useIdentity();
  const [followed, setFollowed] = useState<string[]>([]);
  const [read, setRead] = useState<string[]>([]);
  useEffect(() => {
    void Promise.all([
      runtime.localState.followedCapabilities(),
      runtime.localState.readActivityIds(),
    ]).then(([nextFollowed, nextRead]) => {
      setFollowed(nextFollowed);
      setRead(nextRead);
    });
  }, [runtime]);
  const items = useMemo(
    () => deriveInbox(projection, pubkey, new Set(followed)),
    [projection, pubkey, followed],
  );
  if (!pubkey)
    return (
      <EmptyState
        icon={<Bell className="mx-auto" />}
        title="Connect a signer to view your inbox"
        detail="Inbox items are derived from your comments, mentions, implicit follows, and decision-rationale references."
      />
    );
  const unread = items.filter((item) => !read.includes(item.id));
  const markAll = async () => {
    await runtime.localState.markRead(items.map((item) => item.id));
    setRead(items.map((item) => item.id));
  };
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-black tracking-tight">Notifications</h1>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            {unread.length} unread · read state stays on this device.
          </p>
        </div>
        <button
          type="button"
          className="button"
          disabled={!unread.length}
          onClick={() => void markAll()}
        >
          <CheckCheck size={15} /> Mark all read
        </button>
      </div>
      <section className="panel divide-y divide-[var(--border)]">
        {items.map((item) => (
          <Link
            key={item.id}
            to={`../capabilities/${item.capabilityId}`}
            onClick={() => {
              void runtime.localState.markRead([item.id]);
              setRead((current) => [...new Set([...current, item.id])]);
            }}
            className={`flex gap-3 p-4 text-inherit no-underline ${read.includes(item.id) ? "opacity-60" : "bg-[color:var(--accent-soft)]/20"}`}
          >
            <span
              className={`mt-2 size-2 shrink-0 rounded-full ${read.includes(item.id) ? "bg-[var(--border)]" : "bg-[var(--accent)]"}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Identity pubkey={item.actor} />
                <Badge tone="info">{item.reason}</Badge>
                <span className="text-xs text-[var(--faint)]">
                  {formatRelative(item.createdAt)}
                </span>
              </div>
              <p className="m-0 mt-1.5 text-sm font-semibold">{item.summary}</p>
            </div>
          </Link>
        ))}
        {items.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--muted)]">
            No notifications yet. Comment, react, edit, or get mentioned to implicitly follow a
            capability.
          </div>
        ) : null}
      </section>
    </div>
  );
}

function deriveInbox(
  projection: ReturnType<typeof useBoardContext>["projection"],
  pubkey: string | undefined,
  followed: Set<string>,
): InboxItem[] {
  if (!pubkey) return [];
  const npub = nip19.npubEncode(pubkey);
  const ownComments = new Set(
    projection.comments
      .filter((comment) => comment.event.pubkey === pubkey)
      .map((comment) => comment.id),
  );
  const items: InboxItem[] = [];
  for (const comment of projection.comments) {
    if (comment.deleted) continue;
    if (comment.event.pubkey === pubkey) continue;
    const capabilityId = comment.event.tags.find((tag) => tag[0] === "c")?.[1];
    if (!capabilityId) continue;
    const mentioned =
      comment.content.includes(npub) ||
      comment.event.tags.some((tag) => tag[0] === "p" && tag[1] === pubkey);
    const replied = Boolean(comment.parentCommentId && ownComments.has(comment.parentCommentId));
    const followedComment = followed.has(capabilityId);
    if (mentioned || replied || followedComment)
      items.push({
        id: comment.id,
        capabilityId,
        actor: comment.event.pubkey,
        createdAt: comment.event.created_at,
        reason: mentioned ? "mention" : replied ? "reply" : "followed",
        summary: comment.content.slice(0, 180),
      });
  }
  for (const projected of projection.capabilities.values()) {
    const rationale = projected.value.rationaleCommentId;
    if (!rationale || projected.currentEvent.pubkey === pubkey) continue;
    const comment = projection.comments.find(
      (item) => item.id === rationale && item.event.pubkey === pubkey,
    );
    if (comment)
      items.push({
        id: projected.currentEvent.id,
        capabilityId: projected.value.id,
        actor: projected.currentEvent.pubkey,
        createdAt: projected.currentEvent.created_at,
        reason: "rationale",
        summary: `Your comment was selected as rationale for ${projected.value.title}.`,
      });
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}
