import {
  type Assessment,
  assessmentId,
  type Capability,
  type CompletionStatus,
  type DecisionStatus,
  type DesiredOutcome,
  getTag,
  type ImplementationStatus,
  KINDS,
  newEntityId,
  type Priority,
  type ProjectedComment,
  type ThreadStateValue,
} from "@facet/protocol";
import {
  Archive,
  ArrowLeft,
  Check,
  ExternalLink,
  History,
  Link2,
  MessageSquareText,
  Pencil,
  Plus,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  CreateFacetComment,
  DeleteFacetComment,
  DeleteFacetReaction,
  EditFacetComment,
  PublishMutation,
  ReactToFacetComment,
} from "../../runtime/actions";
import { useRuntime } from "../../runtime/provider";
import { useBoardContext } from "../BoardShell";
import { assessmentFor, gapFor } from "../board-data";
import { useActionExecutor, useIdentity } from "../hooks";
import { encodeNostrMentions, type MentionReference, MentionTextarea } from "../MentionTextarea";
import {
  Badge,
  CompletionBadge,
  formatRelative,
  GapBadge,
  Identity,
  Modal,
  PriorityBadge,
  RichText,
  StatusBadge,
} from "../primitives";

const IMPLEMENTATION_STATUSES: ImplementationStatus[] = [
  "unknown",
  "not_implemented",
  "partial",
  "implemented",
  "stub_or_broken",
  "not_applicable",
];

export function CapabilityPage() {
  const { capabilityId = "" } = useParams();
  const context = useBoardContext();
  const { projection, subjects, permissions } = context;
  const projected = projection.capabilities.get(capabilityId);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!projected) return <Navigate to="../matrix" replace />;
  const capability = projected.value;
  const gap = gapFor(projection, capability, subjects);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="../matrix"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--muted)] no-underline hover:text-[var(--accent)]"
      >
        <ArrowLeft size={15} /> Back to matrix
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-3xl font-black tracking-tight">{capability.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <GapBadge label={gap.label} />
            <PriorityBadge priority={capability.priority} />
            <CompletionBadge status={capability.completionStatus} />
            <Badge>{capability.decisionStatus}</Badge>
            <span className="text-xs text-[var(--muted)]">{gap.reason}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="button" onClick={() => setHistoryOpen(true)}>
            <History size={15} /> History ({projected.history.length})
          </button>
          {permissions.canWrite ? (
            <button
              type="button"
              className="button button-primary"
              onClick={() => setEditing(true)}
            >
              <Pencil size={15} /> Edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-5">
          <section className="panel p-5">
            <h2 className="m-0 text-sm font-extrabold">Description</h2>
            <div className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              {capability.description ? (
                <RichText content={capability.description} />
              ) : (
                "No description yet."
              )}
            </div>
            {capability.links.length ? (
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-wider text-[var(--faint)]">
                  References
                </h3>
                <div className="flex flex-wrap gap-2">
                  {capability.links.map((link) => (
                    <a
                      key={`${link.label}:${link.url}`}
                      className="button !min-h-8 text-xs no-underline"
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={13} />
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <AssessmentsPanel capability={capability} />
          <DiscussionPanel capability={capability} />
        </div>
        <aside aria-label="Capability metadata" className="grid content-start gap-5">
          <section className="panel p-4">
            <h2 className="m-0 text-sm font-extrabold">Product decision</h2>
            <dl className="mt-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-3 text-sm">
              <dt className="text-[var(--muted)]">Desired outcome</dt>
              <dd className="m-0 font-bold">{humanize(capability.desiredOutcome)}</dd>
              <dt className="text-[var(--muted)]">Decision status</dt>
              <dd className="m-0 font-bold">{humanize(capability.decisionStatus)}</dd>
              <dt className="text-[var(--muted)]">Priority</dt>
              <dd className="m-0">
                <PriorityBadge priority={capability.priority} />
              </dd>
              <dt className="text-[var(--muted)]">Completion</dt>
              <dd className="m-0">
                <CompletionBadge status={capability.completionStatus} />
              </dd>
              <dt className="text-[var(--muted)]">Rationale</dt>
              <dd className="m-0 text-xs">
                {capability.rationaleCommentId ? "Linked to discussion" : "Not selected"}
              </dd>
            </dl>
          </section>
          <section className="panel p-4">
            <h2 className="m-0 text-sm font-extrabold">Record</h2>
            <dl className="mt-3 grid gap-2 text-xs text-[var(--muted)]">
              <div className="flex justify-between gap-3">
                <dt>Capability ID</dt>
                <dd
                  className="m-0 max-w-44 truncate font-mono text-[var(--text)]"
                  title={capability.id}
                >
                  {capability.id}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Current event</dt>
                <dd
                  className="m-0 max-w-44 truncate font-mono text-[var(--text)]"
                  title={projected.currentEvent.id}
                >
                  {projected.currentEvent.id}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Last actor</dt>
                <dd className="m-0">
                  <Identity pubkey={projected.currentEvent.pubkey} compact />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Updated</dt>
                <dd className="m-0 text-[var(--text)]">
                  {formatRelative(projected.currentEvent.created_at)}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
      <EditCapabilityDialog
        capability={capability}
        baseEventId={projected.currentEvent.id}
        open={editing}
        onOpenChange={setEditing}
      />
      <HistoryDialog capability={capability} open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

function AssessmentsPanel({ capability }: { capability: Capability }) {
  const { projection, subjects, permissions } = useBoardContext();
  const { runtime } = useRuntime();
  const { run, running, error } = useActionExecutor();
  const update = async (subjectId: string, nextStatus: ImplementationStatus, note: string) => {
    const current = assessmentFor(projection, capability.id, subjectId);
    const value: Assessment = {
      id: current?.id ?? assessmentId(capability.boardId, capability.id, subjectId),
      boardId: capability.boardId,
      featureAreaId: capability.featureAreaId,
      capabilityId: capability.id,
      subjectId,
      status: nextStatus,
      note,
      state: "active",
    };
    await run(
      PublishMutation({
        kind: KINDS.assessment,
        operation: current ? "update" : "create",
        entityId: value.id,
        baseEventId: current
          ? (projection.assessments.get(current.id)?.currentEvent.id ?? null)
          : null,
        value,
      }),
    );
    await runtime.localState.follow(capability.id);
  };
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] p-4">
        <h2 className="m-0 text-sm font-extrabold">Subject assessments</h2>
        <p className="m-0 mt-1 text-xs text-[var(--muted)]">
          Historical subjects remain visible but locked.
        </p>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {subjects.map((subject) => {
          const assessment = assessmentFor(projection, capability.id, subject.id);
          return (
            <AssessmentRow
              key={subject.id}
              subjectName={subject.name}
              status={assessment?.status ?? "unknown"}
              note={assessment?.note ?? ""}
              editable={permissions.canWrite && !subject.locked}
              busy={running}
              onSave={(status, note) => void update(subject.id, status, note)}
            />
          );
        })}
      </div>
      {error ? <p className="m-3 text-xs text-[var(--critical)]">{error}</p> : null}
    </section>
  );
}

function AssessmentRow({
  subjectName,
  status,
  note,
  editable,
  busy,
  onSave,
}: {
  subjectName: string;
  status: ImplementationStatus;
  note: string;
  editable: boolean;
  busy: boolean;
  onSave: (status: ImplementationStatus, note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nextStatus, setNextStatus] = useState(status);
  const [nextNote, setNextNote] = useState(note);
  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <strong className="min-w-28">{subjectName}</strong>
        <StatusBadge status={status} />
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
          {note || "No assessment note"}
        </span>
        {editable ? (
          <button
            type="button"
            className="button button-ghost !min-h-7 text-xs"
            onClick={() => setEditing(!editing)}
          >
            Edit
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto]">
          <select
            className="input"
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value as ImplementationStatus)}
          >
            {IMPLEMENTATION_STATUSES.map((item) => (
              <option key={item} value={item}>
                {humanize(item)}
              </option>
            ))}
          </select>
          <input
            className="input"
            value={nextNote}
            onChange={(event) => setNextNote(event.target.value)}
            placeholder="Evidence or implementation note"
          />
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => {
              onSave(nextStatus, nextNote);
              setEditing(false);
            }}
          >
            Save
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DiscussionPanel({ capability }: { capability: Capability }) {
  const { projection, permissions } = useBoardContext();
  const { runtime } = useRuntime();
  const { pubkey } = useIdentity();
  const { run, running, error } = useActionExecutor();
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<MentionReference[]>([]);
  const memberPubkeys = mentionableMemberPubkeys(projection, pubkey);
  const comments = projection.comments.filter((comment) =>
    comment.event.tags.some((tag) => tag[0] === "c" && tag[1] === capability.id),
  );
  const roots = comments.filter((comment) => !comment.parentCommentId);
  const capabilityEvent = projection.capabilities.get(capability.id)?.currentEvent;
  const add = async () => {
    if (!capabilityEvent || !content.trim()) return;
    await run(
      CreateFacetComment({
        parent: capabilityEvent,
        content: encodeNostrMentions(content.trim(), mentions),
        boardId: capability.boardId,
        featureAreaId: capability.featureAreaId,
        capabilityId: capability.id,
        target: "target:capability",
        threadId: newEntityId(),
      }),
    );
    await runtime.localState.follow(capability.id);
    setContent("");
    setMentions([]);
  };
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
        <div>
          <h2 className="m-0 text-sm font-extrabold">Discussion</h2>
          <p className="m-0 mt-1 text-xs text-[var(--muted)]">
            Comments and one reply level about this capability.
          </p>
        </div>
        <MessageSquareText size={18} className="text-[var(--faint)]" />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {roots.map((root) => (
          <CommentThread
            key={root.id}
            root={root}
            replies={comments.filter((comment) => comment.parentCommentId === root.id)}
            capability={capability}
            currentPubkey={pubkey}
            memberPubkeys={memberPubkeys}
          />
        ))}
        {roots.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--muted)]">No discussion yet.</div>
        ) : null}
      </div>
      {permissions.canWrite ? (
        <form
          className="border-t border-[var(--border)] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <MentionTextarea
            className="input min-h-24 resize-y"
            value={content}
            mentions={mentions}
            memberPubkeys={memberPubkeys}
            onValueChange={(value, nextMentions) => {
              setContent(value);
              setMentions(nextMentions);
            }}
            placeholder="Add a comment. Type @ to mention a board member."
          />
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              className="button button-primary"
              disabled={running || !content.trim()}
            >
              {running ? "Publishing…" : "Comment"}
            </button>
          </div>
          {error ? <p className="m-0 mt-2 text-xs text-[var(--critical)]">{error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}

function CommentThread({
  root,
  replies,
  capability,
  currentPubkey,
  memberPubkeys,
}: {
  root: ProjectedComment;
  replies: ProjectedComment[];
  capability: Capability;
  currentPubkey?: string | undefined;
  memberPubkeys: string[];
}) {
  const { projection, permissions } = useBoardContext();
  const { runtime } = useRuntime();
  const { run, running } = useActionExecutor();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [replyMentions, setReplyMentions] = useState<MentionReference[]>([]);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(root.content);
  const thread = projection.threadStates.get(root.threadId);
  const resolved = thread?.value.state === "resolved";
  const discussionFeatureAreaId = getTag(root.event, "f") ?? capability.featureAreaId;
  const reactions = projection.reactions.filter((event) =>
    event.tags.some((tag) => tag[0] === "e" && tag[1] === root.id),
  );
  const ownReaction = reactions.find(
    (event) => event.pubkey === currentPubkey && event.content === "👍",
  );
  const canOwn = permissions.canWrite && root.event.pubkey === currentPubkey && !root.imported;
  const sendReply = async () => {
    if (!reply.trim()) return;
    await run(
      CreateFacetComment({
        parent: root.event,
        content: encodeNostrMentions(reply.trim(), replyMentions),
        boardId: capability.boardId,
        featureAreaId: discussionFeatureAreaId,
        capabilityId: capability.id,
        target: root.target,
        threadId: root.threadId,
      }),
    );
    await runtime.localState.follow(capability.id);
    setReply("");
    setReplyMentions([]);
    setReplying(false);
  };
  const toggleResolved = async () => {
    const value: ThreadStateValue = {
      id: root.threadId,
      boardId: capability.boardId,
      capabilityId: capability.id,
      rootCommentId: root.id,
      state: resolved ? "open" : "resolved",
    };
    await run(
      PublishMutation({
        kind: KINDS.threadState,
        operation: resolved ? "reopen" : "resolve",
        entityId: value.id,
        baseEventId: thread?.currentEvent.id ?? null,
        value,
      }),
    );
  };
  const selectRationale = async () => {
    const current = projection.capabilities.get(capability.id)!;
    await run(
      PublishMutation({
        kind: KINDS.capability,
        operation: "update",
        entityId: capability.id,
        baseEventId: current.currentEvent.id,
        value: { ...capability, rationaleCommentId: root.id },
      }),
    );
  };
  return (
    <article className={`p-4 ${resolved ? "opacity-65" : ""}`}>
      <div className="flex items-start gap-3">
        <Identity pubkey={root.event.pubkey} compact />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Identity pubkey={root.event.pubkey} showAvatar={false} />
            <span className="text-[11px] text-[var(--faint)]">
              {formatRelative(root.event.created_at)}
            </span>
            {root.imported ? <ImportedAttribution event={root.event} /> : null}
            {root.edited ? <span className="text-[10px] text-[var(--faint)]">edited</span> : null}
            {resolved ? <Badge tone="success">Resolved</Badge> : null}
          </div>
          <div className="mt-2 text-sm">
            {root.deleted ? (
              <em className="text-[var(--faint)]">Comment deleted by author.</em>
            ) : editing ? (
              <div className="flex gap-2">
                <input
                  className="input"
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                />
                <button
                  type="button"
                  className="button"
                  disabled={running || !editText.trim()}
                  onClick={() => {
                    void run(
                      EditFacetComment({
                        original: root.event,
                        content: editText.trim(),
                        boardId: capability.boardId,
                        featureAreaId: discussionFeatureAreaId,
                        capabilityId: capability.id,
                        target: root.target,
                      }),
                    ).then(() => setEditing(false));
                  }}
                >
                  Save
                </button>
              </div>
            ) : (
              <RichText content={root.content} />
            )}
          </div>
          {!root.deleted ? (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="button button-ghost !min-h-7 text-xs"
                disabled={!permissions.canWrite || running}
                onClick={() => setReplying(!replying)}
              >
                <Reply size={12} /> Reply
              </button>
              <button
                type="button"
                className="button button-ghost !min-h-7 text-xs"
                disabled={!permissions.canWrite || running}
                onClick={() =>
                  void run(
                    ownReaction
                      ? DeleteFacetReaction({
                          event: ownReaction,
                          boardId: capability.boardId,
                          featureAreaId: discussionFeatureAreaId,
                          capabilityId: capability.id,
                          reason: "Reaction removed by author",
                        })
                      : ReactToFacetComment({
                          comment: root.event,
                          emoji: "👍",
                          boardId: capability.boardId,
                          featureAreaId: discussionFeatureAreaId,
                          capabilityId: capability.id,
                        }),
                  ).then(() => runtime.localState.follow(capability.id))
                }
              >
                <SmilePlus size={12} />{" "}
                {ownReaction ? `Unlike (${reactions.length})` : reactions.length || "React"}
              </button>
              {permissions.canWrite ? (
                <button
                  type="button"
                  className="button button-ghost !min-h-7 text-xs"
                  disabled={running}
                  onClick={() => void toggleResolved()}
                >
                  <Check size={12} />
                  {resolved ? "Reopen" : "Resolve"}
                </button>
              ) : null}
              {permissions.canWrite ? (
                <button
                  type="button"
                  className="button button-ghost !min-h-7 text-xs"
                  disabled={running}
                  onClick={() => void selectRationale()}
                >
                  <Link2 size={12} /> Rationale
                </button>
              ) : null}
              {canOwn ? (
                <>
                  <button
                    type="button"
                    className="button button-ghost !min-h-7 text-xs"
                    onClick={() => setEditing(!editing)}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    type="button"
                    className="button button-ghost !min-h-7 text-xs text-[var(--critical)]"
                    onClick={() => {
                      if (
                        confirm(
                          "Delete this comment? Its content and edit history will stop being served by this relay.",
                        )
                      )
                        void run(
                          DeleteFacetComment({
                            comment: root,
                            boardId: capability.boardId,
                            featureAreaId: discussionFeatureAreaId,
                            capabilityId: capability.id,
                            reason: "Deleted by author",
                          }),
                        );
                    }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {replying ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <MentionTextarea
                id={`reply-${root.id}`}
                className="input min-h-20 resize-y"
                value={reply}
                mentions={replyMentions}
                memberPubkeys={memberPubkeys}
                onValueChange={(value, nextMentions) => {
                  setReply(value);
                  setReplyMentions(nextMentions);
                }}
                placeholder="Write a reply. Type @ to mention a board member."
              />
              <button
                type="button"
                className="button button-primary"
                disabled={!permissions.canWrite || running || !reply.trim()}
                onClick={() => void sendReply()}
              >
                Reply
              </button>
            </div>
          ) : null}
          <div className="mt-2 grid gap-2 border-l-2 border-[var(--border)] pl-3">
            {replies.map((item) => (
              <ReplyItem
                key={item.id}
                item={item}
                capability={capability}
                currentPubkey={currentPubkey}
              />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function ReplyItem({
  item,
  capability,
  currentPubkey,
}: {
  item: ProjectedComment;
  capability: Capability;
  currentPubkey?: string | undefined;
}) {
  const { projection, permissions } = useBoardContext();
  const { runtime } = useRuntime();
  const { run, running } = useActionExecutor();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.content);
  const discussionFeatureAreaId = getTag(item.event, "f") ?? capability.featureAreaId;
  const reactions = projection.reactions.filter((event) =>
    event.tags.some((tag) => tag[0] === "e" && tag[1] === item.id),
  );
  const ownReaction = reactions.find(
    (event) => event.pubkey === currentPubkey && event.content === "👍",
  );
  const canOwn = permissions.canWrite && item.event.pubkey === currentPubkey && !item.imported;

  const toggleReaction = async () => {
    await run(
      ownReaction
        ? DeleteFacetReaction({
            event: ownReaction,
            boardId: capability.boardId,
            featureAreaId: discussionFeatureAreaId,
            capabilityId: capability.id,
            reason: "Reaction removed by author",
          })
        : ReactToFacetComment({
            comment: item.event,
            emoji: "👍",
            boardId: capability.boardId,
            featureAreaId: discussionFeatureAreaId,
            capabilityId: capability.id,
          }),
    );
    await runtime.localState.follow(capability.id);
  };

  return (
    <div className="py-1">
      <div className="flex flex-wrap items-center gap-2">
        <Identity pubkey={item.event.pubkey} />
        <span className="text-[10px] text-[var(--faint)]">
          {formatRelative(item.event.created_at)}
        </span>
        {item.imported ? <ImportedAttribution event={item.event} /> : null}
        {item.edited ? <span className="text-[10px] text-[var(--faint)]">edited</span> : null}
      </div>
      <div className="mt-1 text-sm">
        {item.deleted ? (
          <em className="text-[var(--faint)]">Reply deleted by author.</em>
        ) : editing ? (
          <div className="flex gap-2">
            <input
              className="input"
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
            />
            <button
              type="button"
              className="button"
              disabled={running || !editText.trim()}
              onClick={() => {
                void run(
                  EditFacetComment({
                    original: item.event,
                    content: editText.trim(),
                    boardId: capability.boardId,
                    featureAreaId: discussionFeatureAreaId,
                    capabilityId: capability.id,
                    target: item.target,
                  }),
                ).then(() => setEditing(false));
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <RichText content={item.content} />
        )}
      </div>
      {!item.deleted ? (
        <div className="mt-1 flex flex-wrap gap-1">
          <button
            type="button"
            className="button button-ghost !min-h-7 text-xs"
            disabled={!permissions.canWrite || running}
            onClick={() => void toggleReaction()}
          >
            <SmilePlus size={12} />{" "}
            {ownReaction ? `Unlike (${reactions.length})` : reactions.length || "React"}
          </button>
          {canOwn ? (
            <>
              <button
                type="button"
                className="button button-ghost !min-h-7 text-xs"
                onClick={() => setEditing(!editing)}
              >
                <Pencil size={12} /> Edit
              </button>
              <button
                type="button"
                className="button button-ghost !min-h-7 text-xs text-[var(--critical)]"
                onClick={() => {
                  if (
                    confirm(
                      "Delete this reply? Its content and edit history will stop being served by this relay.",
                    )
                  )
                    void run(
                      DeleteFacetComment({
                        comment: item,
                        boardId: capability.boardId,
                        featureAreaId: discussionFeatureAreaId,
                        capabilityId: capability.id,
                        reason: "Deleted by author",
                      }),
                    );
                }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ImportedAttribution({ event }: { event: ProjectedComment["event"] }) {
  const source = event.tags.find((tag) => tag[0] === "source" && tag[1] === "outline");
  const originalName = source?.[3] ?? "Unknown Outline author";
  const originalTime = source?.[4];
  return (
    <>
      <Badge tone="info">Outline import</Badge>
      <span
        className="text-[10px] text-[var(--faint)]"
        title="Original attribution metadata; this Nostr event was signed by the dedicated importer key."
      >
        {originalName}
        {originalTime ? ` · ${new Date(originalTime).toLocaleString()}` : ""} · importer-signed
      </span>
    </>
  );
}

function mentionableMemberPubkeys(
  projection: ReturnType<typeof useBoardContext>["projection"],
  currentPubkey: string | undefined,
): string[] {
  return [...projection.memberships.values()]
    .map(({ value }) => value)
    .filter((membership) => membership.state === "active" && membership.pubkey !== currentPubkey)
    .map((membership) => membership.pubkey);
}

function EditCapabilityDialog({
  capability,
  baseEventId,
  open,
  onOpenChange,
}: {
  capability: Capability;
  baseEventId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { projection } = useBoardContext();
  const { runtime } = useRuntime();
  const { run, running, error } = useActionExecutor();
  const [draft, setDraft] = useState(capability);
  useEffect(() => setDraft(capability), [capability]);
  const areas = [...projection.featureAreas.values()]
    .map(({ value }) => value)
    .filter((area) => area.state === "active");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const save = async () => {
    const current = projection.capabilities.get(capability.id);
    const currentId = current?.currentEvent.id;
    const interveningChanges = current ? capabilityDiff(capability, current.value) : [];
    if (
      currentId !== baseEventId &&
      !confirm(
        [
          "This capability changed since editing began.",
          "",
          "Intervening changes:",
          ...(interveningChanges.length
            ? interveningChanges.map((change) => `• ${change}`)
            : ["• A newer signed event has the same visible values."]),
          "",
          "Publish your full snapshot over the newer version?",
        ].join("\n"),
      )
    )
      return;
    await run(
      PublishMutation({
        kind: KINDS.capability,
        operation: "update",
        entityId: draft.id,
        baseEventId,
        value: draft,
      }),
    );
    await runtime.localState.follow(capability.id);
    onOpenChange(false);
  };
  const addLink = () => {
    try {
      new URL(linkUrl);
      setDraft({
        ...draft,
        links: [...draft.links, { label: linkLabel.trim(), url: linkUrl.trim() }],
      });
      setLinkLabel("");
      setLinkUrl("");
    } catch {
      /* native field validation provides feedback */
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit capability"
      description="The published event is a complete immutable snapshot."
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="label">
          Title
          <input
            className="input"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            required
          />
        </label>
        <label className="label">
          Description
          <textarea
            className="input min-h-28"
            value={draft.description ?? ""}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <label className="label">
          Feature area
          <select
            className="input"
            value={draft.featureAreaId}
            onChange={(event) => setDraft({ ...draft, featureAreaId: event.target.value })}
          >
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.title}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="label">
            Desired outcome
            <select
              className="input"
              value={draft.desiredOutcome}
              onChange={(event) =>
                setDraft({ ...draft, desiredOutcome: event.target.value as DesiredOutcome })
              }
            >
              {["keep_as_is", "add", "remove", "standardize", "platform_specific", "undecided"].map(
                (value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="label">
            Decision status
            <select
              className="input"
              value={draft.decisionStatus}
              onChange={(event) =>
                setDraft({ ...draft, decisionStatus: event.target.value as DecisionStatus })
              }
            >
              {["open", "discussing", "decided", "superseded"].map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Priority
            <select
              className="input"
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
            >
              {["now", "next", "later", "none"].map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Completion
            <select
              className="input"
              value={draft.completionStatus}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  completionStatus: event.target.value as CompletionStatus,
                })
              }
            >
              {(["in_progress", "complete"] as CompletionStatus[]).map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="label">
          References
          <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
            <input
              className="input"
              value={linkLabel}
              onChange={(event) => setLinkLabel(event.target.value)}
              placeholder="Label"
            />
            <input
              className="input"
              type="url"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://…"
            />
            <button
              className="button"
              type="button"
              disabled={!linkLabel.trim() || !linkUrl.trim()}
              onClick={addLink}
            >
              <Plus size={14} /> Add
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.links.map((link, index) => (
              <button
                key={`${link.url}:${index}`}
                className="button !min-h-7 text-xs"
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    links: draft.links.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                {link.label} <Trash2 size={11} />
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex justify-between gap-3">
          <button
            className="button text-[var(--critical)]"
            type="button"
            onClick={() => {
              if (confirm("Archive this capability? It remains in signed history.")) {
                setDraft({ ...draft, state: "archived" });
                void run(
                  PublishMutation({
                    kind: KINDS.capability,
                    operation: "archive",
                    entityId: draft.id,
                    baseEventId,
                    value: { ...draft, state: "archived" },
                  }),
                ).then(() => onOpenChange(false));
              }
            }}
          >
            <Archive size={14} /> Archive
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={running || !draft.title.trim()}
          >
            {running ? "Publishing…" : "Publish update"}
          </button>
        </div>
        {error ? <p className="m-0 text-sm text-[var(--critical)]">{error}</p> : null}
      </form>
    </Modal>
  );
}

function HistoryDialog({
  capability,
  open,
  onOpenChange,
}: {
  capability: Capability;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { projection } = useBoardContext();
  const history = projection.capabilities.get(capability.id)?.history ?? [];
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Capability history"
      description="Every valid signed snapshot is retained, including losing concurrent updates."
    >
      <div className="grid gap-2">
        {history.map((event, index) => {
          let operation = "mutation";
          try {
            operation = JSON.parse(event.content).operation;
          } catch {
            /* display fallback */
          }
          return (
            <div key={event.id} className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone={index === 0 ? "success" : "neutral"}>
                    {index === 0 ? "Current" : operation}
                  </Badge>
                  <Identity pubkey={event.pubkey} />
                </div>
                <span className="text-xs text-[var(--faint)]">
                  {new Date(event.created_at * 1000).toLocaleString()}
                </span>
              </div>
              <code
                className="mt-2 block truncate text-[10px] text-[var(--faint)]"
                title={event.id}
              >
                {event.id}
              </code>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function capabilityDiff(previous: Capability, current: Capability): string[] {
  const fields: Array<keyof Capability> = [
    "title",
    "description",
    "featureAreaId",
    "orderKey",
    "state",
    "desiredOutcome",
    "decisionStatus",
    "priority",
    "completionStatus",
    "rationaleCommentId",
    "links",
  ];
  return fields.flatMap((field) => {
    if (JSON.stringify(previous[field]) === JSON.stringify(current[field])) return [];
    return [`${humanize(field)}: ${summarize(previous[field])} → ${summarize(current[field])}`];
  });
}

function summarize(value: unknown): string {
  if (value === undefined || value === "") return "none";
  if (Array.isArray(value)) {
    return value.length === 0
      ? "none"
      : value
          .map((item) =>
            typeof item === "object" && item && "label" in item ? String(item.label) : String(item),
          )
          .join(", ");
  }
  const text = String(value).replaceAll("\n", " ");
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}
