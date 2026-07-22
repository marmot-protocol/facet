import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type Board,
  type BoardRole,
  type ComparisonSubject,
  KINDS,
  type Membership,
  membershipId,
  newEntityId,
  orderKeyBetween,
} from "@facet/protocol";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  GripVertical,
  LockKeyhole,
  Plus,
  Shield,
  UserMinus,
  UserRoundCog,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";
import { PublishMutation } from "../../runtime/actions";
import { useBoardContext } from "../BoardShell";
import { activeFeatureAreas } from "../board-data";
import { useActionExecutor, useIdentity } from "../hooks";
import { Badge, EmptyState, Identity, Modal } from "../primitives";

export function AdminPage() {
  const { projection, subjects, permissions } = useBoardContext();
  if (!permissions.canAdmin)
    return (
      <EmptyState
        icon={<Shield className="mx-auto" />}
        title="Board administration is restricted"
        detail="A current board admin or the deployment super-admin is required."
      />
    );
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="m-0 text-2xl font-black tracking-tight">Board administration</h1>
        <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
          Metadata, ordered subjects, membership, and archive controls.
        </p>
      </div>
      <div className="grid gap-5">
        <BoardSettings />
        <SubjectSettings subjects={subjects} />
        <MembershipSettings />
        <StructureSettings />
      </div>
      {projection.invalidEvents.length ? (
        <section className="panel mt-5 border-[var(--warning)] p-4">
          <h2 className="m-0 text-sm font-extrabold text-[var(--warning)]">
            Ignored relay events ({projection.invalidEvents.length})
          </h2>
          <p className="mb-0 mt-1 text-xs text-[var(--muted)]">
            These events are cached for diagnosis but cannot affect projected state.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function BoardSettings() {
  const { projection } = useBoardContext();
  const projected = projection.board!;
  const { run, running, error } = useActionExecutor();
  const [name, setName] = useState(projected.value.name);
  const [description, setDescription] = useState(projected.value.description ?? "");
  useEffect(() => {
    setName(projected.value.name);
    setDescription(projected.value.description ?? "");
  }, [projected.value]);
  const update = async () => {
    const value: Board = {
      ...projected.value,
      name: name.trim(),
      description: description.trim(),
      visibility: "public",
    };
    await run(
      PublishMutation({
        kind: KINDS.board,
        operation: "update",
        entityId: value.id,
        baseEventId: projected.currentEvent.id,
        value,
      }),
    );
  };
  const archive = async () => {
    if (!confirm("Archive this board? All ordinary writes will stop, but history remains public."))
      return;
    const value: Board = { ...projected.value, state: "archived" };
    await run(
      PublishMutation({
        kind: KINDS.board,
        operation: "archive",
        entityId: value.id,
        baseEventId: projected.currentEvent.id,
        value,
      }),
    );
  };
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="m-0 text-base font-extrabold">Board metadata</h2>
          <p className="m-0 mt-1 text-xs text-[var(--muted)]">
            Visibility is fixed to public in v1.
          </p>
        </div>
        <Badge tone="success">Public</Badge>
      </div>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void update();
        }}
      >
        <label className="label">
          Name
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="label">
          Description
          <textarea
            className="input min-h-24"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <button
            className="button text-[var(--critical)]"
            type="button"
            disabled={running}
            onClick={() => void archive()}
          >
            <Archive size={14} /> Archive board
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={running || !name.trim()}
          >
            {running ? "Publishing…" : "Save metadata"}
          </button>
        </div>
        {error ? <p className="m-0 text-xs text-[var(--critical)]">{error}</p> : null}
      </form>
    </section>
  );
}

function SubjectSettings({ subjects }: { subjects: ComparisonSubject[] }) {
  const { projection } = useBoardContext();
  const { run, running, error } = useActionExecutor();
  const [open, setOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const publishOrder = async (
    subject: ComparisonSubject,
    before?: ComparisonSubject,
    after?: ComparisonSubject,
  ) => {
    const value = { ...subject, orderKey: orderKeyBetween(before?.orderKey, after?.orderKey) };
    await run(
      PublishMutation({
        kind: KINDS.subject,
        operation: "update",
        entityId: value.id,
        baseEventId: projection.subjects.get(value.id)?.currentEvent.id ?? null,
        value,
      }),
    );
  };
  const move = async (subject: ComparisonSubject, direction: -1 | 1) => {
    const index = subjects.findIndex((item) => item.id === subject.id);
    const target = index + direction;
    if (target < 0 || target >= subjects.length) return;
    await publishOrder(
      subject,
      direction < 0 ? subjects[index - 2] : subjects[index + 1],
      direction < 0 ? subjects[index - 1] : subjects[index + 2],
    );
  };
  const dragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || running) return;
    const oldIndex = subjects.findIndex((subject) => subject.id === active.id);
    const newIndex = subjects.findIndex((subject) => subject.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(subjects, oldIndex, newIndex);
    const subject = reordered[newIndex];
    if (!subject) return;
    await publishOrder(subject, reordered[newIndex - 1], reordered[newIndex + 1]);
  };
  const seed = async () => {
    const definitions: Array<
      Pick<ComparisonSubject, "name" | "state" | "includeInGapAnalysis" | "locked">
    > = [
      { name: "macOS", state: "active", includeInGapAnalysis: true, locked: false },
      { name: "iOS", state: "active", includeInGapAnalysis: true, locked: false },
      { name: "Android", state: "active", includeInGapAnalysis: true, locked: false },
      { name: "Linux", state: "active", includeInGapAnalysis: true, locked: false },
      { name: "Flutter", state: "historical", includeInGapAnalysis: false, locked: true },
    ];
    let previous = subjects.at(-1)?.orderKey ?? null;
    for (const definition of definitions) {
      const orderKey = orderKeyBetween(previous, null);
      previous = orderKey;
      const value: ComparisonSubject = {
        id: newEntityId(),
        boardId: projection.boardId,
        orderKey,
        ...definition,
      };
      await run(
        PublishMutation({ kind: KINDS.subject, operation: "create", entityId: value.id, value }),
      );
    }
  };
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-5">
        <div>
          <h2 className="m-0 text-base font-extrabold">Comparison subjects</h2>
          <p className="m-0 mt-1 text-xs text-[var(--muted)]">
            Ordering controls matrix columns and selected-client choices.
          </p>
        </div>
        <div className="flex gap-2">
          {subjects.length === 0 ? (
            <button type="button" className="button" disabled={running} onClick={() => void seed()}>
              Seed White Noise subjects
            </button>
          ) : null}
          <button type="button" className="button button-primary" onClick={() => setOpen(true)}>
            <Plus size={14} /> Add subject
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
        <SortableContext
          items={subjects.map((subject) => subject.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="divide-y divide-[var(--border)]">
            {subjects.map((subject, index) => (
              <SortableSubject
                key={subject.id}
                subject={subject}
                index={index}
                count={subjects.length}
                running={running}
                move={move}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {error ? <p className="m-3 text-xs text-[var(--critical)]">{error}</p> : null}
      <AddSubjectDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}

function SortableSubject({
  subject,
  index,
  count,
  running,
  move,
}: {
  subject: ComparisonSubject;
  index: number;
  count: number;
  running: boolean;
  move: (subject: ComparisonSubject, direction: -1 | 1) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: subject.id,
    disabled: running,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-3 bg-[var(--panel)] p-4 ${isDragging ? "relative z-10 shadow-[var(--shadow)]" : ""}`}
    >
      <button
        type="button"
        className="button button-ghost cursor-grab !min-h-8 !p-2 active:cursor-grabbing"
        aria-label={`Drag ${subject.name} to reorder`}
        disabled={running}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <span className="grid size-8 place-items-center rounded-md bg-[var(--sidebar)] font-black">
        {subject.name.slice(0, 2)}
      </span>
      <div className="min-w-0 flex-1">
        <strong>{subject.name}</strong>
        <div className="mt-1 flex gap-1.5">
          <Badge>{subject.state}</Badge>
          {subject.includeInGapAnalysis ? (
            <Badge tone="success">Gap analysis</Badge>
          ) : (
            <Badge>Excluded</Badge>
          )}
          {subject.locked ? (
            <Badge tone="warning">
              <LockKeyhole size={10} /> Locked
            </Badge>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="button button-ghost !min-h-8 !p-2"
        aria-label={`Move ${subject.name} up`}
        disabled={running || index === 0}
        onClick={() => void move(subject, -1)}
      >
        <ArrowUp size={14} />
      </button>
      <button
        type="button"
        className="button button-ghost !min-h-8 !p-2"
        aria-label={`Move ${subject.name} down`}
        disabled={running || index === count - 1}
        onClick={() => void move(subject, 1)}
      >
        <ArrowDown size={14} />
      </button>
    </div>
  );
}

function AddSubjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { projection, subjects } = useBoardContext();
  const { run, running, error } = useActionExecutor();
  const [name, setName] = useState("");
  const [state, setState] = useState<ComparisonSubject["state"]>("active");
  const [include, setInclude] = useState(true);
  const [locked, setLocked] = useState(false);
  const submit = async () => {
    const value: ComparisonSubject = {
      id: newEntityId(),
      boardId: projection.boardId,
      name: name.trim(),
      orderKey: orderKeyBetween(subjects.at(-1)?.orderKey, null),
      state,
      includeInGapAnalysis: state === "active" && include,
      locked,
    };
    await run(
      PublishMutation({ kind: KINDS.subject, operation: "create", entityId: value.id, value }),
    );
    setName("");
    onOpenChange(false);
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add comparison subject">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="label">
          Name
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label className="label">
          State
          <select
            className="input"
            value={state}
            onChange={(event) => setState(event.target.value as ComparisonSubject["state"])}
          >
            <option value="active">Active</option>
            <option value="historical">Historical</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={include}
            onChange={(event) => setInclude(event.target.checked)}
            disabled={state !== "active"}
          />{" "}
          Include in gap analysis
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={locked}
            onChange={(event) => setLocked(event.target.checked)}
          />{" "}
          Lock ordinary assessment edits
        </label>
        <button type="submit" className="button button-primary" disabled={running || !name.trim()}>
          {running ? "Publishing…" : "Add subject"}
        </button>
        {error ? <p className="m-0 text-xs text-[var(--critical)]">{error}</p> : null}
      </form>
    </Modal>
  );
}

function MembershipSettings() {
  const { projection } = useBoardContext();
  const { pubkey: currentPubkey } = useIdentity();
  const { run, running, error } = useActionExecutor();
  const [input, setInput] = useState("");
  const [role, setRole] = useState<BoardRole>("member");
  const members = [...projection.memberships.values()]
    .map(({ value }) => value)
    .filter((member) => member.state === "active")
    .sort((a, b) => a.role.localeCompare(b.role) || a.pubkey.localeCompare(b.pubkey));
  const add = async () => {
    const pubkey = decodePubkey(input);
    const value: Membership = {
      id: membershipId(projection.boardId, pubkey),
      boardId: projection.boardId,
      pubkey,
      role,
      state: "active",
    };
    await run(
      PublishMutation({ kind: KINDS.membership, operation: "add", entityId: value.id, value }),
    );
    setInput("");
  };
  const change = async (member: Membership, operation: "promote" | "demote" | "remove") => {
    const value: Membership = {
      ...member,
      role: operation === "promote" ? "admin" : operation === "demote" ? "member" : member.role,
      state: operation === "remove" ? "removed" : "active",
    };
    await run(
      PublishMutation({
        kind: KINDS.membership,
        operation,
        entityId: value.id,
        baseEventId: projection.memberships.get(value.id)?.currentEvent.id ?? null,
        value,
      }),
    );
  };
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] p-5">
        <h2 className="m-0 text-base font-extrabold">Members and admins</h2>
        <p className="m-0 mt-1 text-xs text-[var(--muted)]">
          The relay rejects removal or demotion of the final board admin.
        </p>
        <form
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input
            className="input font-mono text-xs"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="npub1… or 64-character pubkey"
          />
          <select
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value as BoardRole)}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            className="button button-primary"
            disabled={running || !input.trim()}
          >
            <Plus size={14} /> Add
          </button>
        </form>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {members.map((member) => (
          <div key={member.id} className="flex flex-wrap items-center gap-3 p-4">
            <Identity pubkey={member.pubkey} />
            <Badge tone={member.role === "admin" ? "info" : "neutral"}>{member.role}</Badge>
            {member.pubkey === currentPubkey ? (
              <span className="text-xs text-[var(--faint)]">You</span>
            ) : null}
            <div className="ml-auto flex gap-1">
              {member.role === "member" ? (
                <button
                  type="button"
                  className="button button-ghost !min-h-8 text-xs"
                  disabled={running}
                  onClick={() => void change(member, "promote")}
                >
                  <UserRoundCog size={13} /> Promote
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-ghost !min-h-8 text-xs"
                  disabled={running}
                  onClick={() => void change(member, "demote")}
                >
                  <UserRoundCog size={13} /> Demote
                </button>
              )}
              <button
                type="button"
                className="button button-ghost !min-h-8 text-xs text-[var(--critical)]"
                disabled={running}
                onClick={() => void change(member, "remove")}
              >
                <UserMinus size={13} /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      {error ? <p className="m-3 text-xs text-[var(--critical)]">{error}</p> : null}
    </section>
  );
}

function StructureSettings() {
  const { projection } = useBoardContext();
  const { run, running, error } = useActionExecutor();
  const areas = activeFeatureAreas(projection);
  const archive = async (areaId: string) => {
    const projected = projection.featureAreas.get(areaId)!;
    if (!confirm("Archive this feature area? Archive its active capabilities first.")) return;
    await run(
      PublishMutation({
        kind: KINDS.featureArea,
        operation: "archive",
        entityId: areaId,
        baseEventId: projected.currentEvent.id,
        value: { ...projected.value, state: "archived" },
      }),
    );
  };
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] p-5">
        <h2 className="m-0 text-base font-extrabold">Feature areas</h2>
        <p className="m-0 mt-1 text-xs text-[var(--muted)]">
          Create new areas from the matrix. Archive unused areas here.
        </p>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {areas.map((area) => (
          <div key={area.id} className="flex items-center gap-3 p-4">
            <strong className="flex-1">{area.title}</strong>
            <span className="text-xs text-[var(--faint)]">
              {
                [...projection.capabilities.values()].filter(
                  ({ value }) => value.featureAreaId === area.id && value.state === "active",
                ).length
              }{" "}
              capabilities
            </span>
            <button
              type="button"
              className="button button-ghost !min-h-8 text-xs text-[var(--critical)]"
              disabled={running}
              onClick={() => void archive(area.id)}
            >
              <Archive size={13} /> Archive
            </button>
          </div>
        ))}
        {areas.length === 0 ? (
          <p className="m-0 p-5 text-sm text-[var(--muted)]">No feature areas yet.</p>
        ) : null}
      </div>
      {error ? <p className="m-3 text-xs text-[var(--critical)]">{error}</p> : null}
    </section>
  );
}

function decodePubkey(input: string): string {
  const value = input.trim();
  if (/^[0-9a-f]{64}$/iu.test(value)) return value.toLowerCase();
  const decoded = nip19.decode(value);
  if (decoded.type !== "npub" || typeof decoded.data !== "string")
    throw new Error("Enter a valid npub or hex pubkey.");
  return decoded.data;
}
