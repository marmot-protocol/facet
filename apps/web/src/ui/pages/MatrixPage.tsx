import {
  type Assessment,
  assessmentId,
  type Capability,
  type CompletionStatus,
  type DecisionStatus,
  type DesiredOutcome,
  type FeatureArea,
  type ImplementationStatus,
  KINDS,
  newEntityId,
  orderKeyBetween,
  type Priority,
} from "@facet/protocol";
import * as Popover from "@radix-ui/react-popover";
import { Columns3, ExternalLink, LockKeyhole, MessageSquareText, Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublishMutation } from "../../runtime/actions";
import { useRuntime } from "../../runtime/provider";
import { ComparisonSubjectSelector, useBoardContext } from "../BoardShell";
import {
  activeCapabilities,
  activeFeatureAreas,
  assessmentFor,
  gapFor,
  unresolvedThreadCount,
} from "../board-data";
import {
  CapabilityFilterBar,
  type CapabilityFilters,
  EMPTY_FILTERS,
  filterCapabilities,
} from "../Filters";
import { useActionExecutor } from "../hooks";
import {
  CompletionBadge,
  GapBadge,
  Modal,
  PriorityBadge,
  StatusBadge,
  StatusIcon,
  statusColor,
  statusLabel,
} from "../primitives";

const STATUSES: ImplementationStatus[] = [
  "unknown",
  "not_implemented",
  "partial",
  "implemented",
  "stub_or_broken",
  "not_applicable",
];

const DESIRED_OUTCOMES: DesiredOutcome[] = [
  "keep_as_is",
  "add",
  "remove",
  "standardize",
  "platform_specific",
  "undecided",
];

const DECISION_STATUSES: DecisionStatus[] = ["open", "discussing", "decided", "superseded"];

const PRIORITIES: Priority[] = ["now", "next", "later", "none"];

const COMPLETION_STATUSES: CompletionStatus[] = ["in_progress", "complete"];

export function MatrixPage() {
  const context = useBoardContext();
  const { projection, subjects, selectedSubjectId, permissions } = context;
  const { runtime } = useRuntime();
  const [filters, setFilters] = useState<CapabilityFilters>(EMPTY_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [hiddenSubjectIds, setHiddenSubjectIds] = useState<string[]>([]);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const boardId = projection.boardId;
  useEffect(() => {
    let active = true;
    setHiddenSubjectIds([]);
    void runtime.localState.matrixHiddenSubjectIds(boardId).then((ids) => {
      if (!active) return;
      setHiddenSubjectIds(ids);
    });
    return () => {
      active = false;
    };
  }, [runtime, boardId]);
  const hiddenSubjectSet = useMemo(() => new Set(hiddenSubjectIds), [hiddenSubjectIds]);
  const visibleSubjects = useMemo(
    () => subjects.filter((subject) => !hiddenSubjectSet.has(subject.id)),
    [subjects, hiddenSubjectSet],
  );
  const toggleSubject = async (subjectId: string) => {
    const next = new Set(hiddenSubjectSet);
    if (next.has(subjectId)) {
      next.delete(subjectId);
    } else {
      next.add(subjectId);
    }
    const ids = [...next];
    setHiddenSubjectIds(ids);
    setVisibilitySaving(true);
    try {
      await runtime.localState.saveMatrixHiddenSubjectIds(boardId, ids);
    } finally {
      setVisibilitySaving(false);
    }
  };
  const showAllSubjects = async () => {
    setHiddenSubjectIds([]);
    setVisibilitySaving(true);
    try {
      await runtime.localState.saveMatrixHiddenSubjectIds(boardId, []);
    } finally {
      setVisibilitySaving(false);
    }
  };
  const areas = activeFeatureAreas(projection);
  const capabilities = filterCapabilities(
    activeCapabilities(projection),
    projection,
    selectedSubjectId,
    filters,
  );
  const grouped = useMemo(
    () =>
      areas.map((area) => ({
        area,
        capabilities: capabilities.filter((capability) => capability.featureAreaId === area.id),
      })),
    [areas, capabilities],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-black tracking-tight">Capability matrix</h1>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            Inline status editing across active and historical subjects.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <ComparisonSubjectSelector />
          <SubjectColumnPicker
            subjects={subjects}
            visibleSubjectIds={new Set(visibleSubjects.map((subject) => subject.id))}
            saving={visibilitySaving}
            onToggle={toggleSubject}
            onShowAll={showAllSubjects}
          />
          {permissions.canWrite ? (
            <button
              type="button"
              className="button button-primary"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={15} /> Add structure
            </button>
          ) : null}
        </div>
      </div>
      <CapabilityFilterBar projection={projection} filters={filters} onChange={setFilters} />

      <div className="panel overflow-x-auto">
        <table
          className="w-full border-collapse text-left text-xs"
          style={{ minWidth: 300 + visibleSubjects.length * 144 }}
        >
          <thead className="sticky top-0 bg-[var(--panel-strong)]">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-[2] min-w-[300px] border-b border-r border-[var(--border)] bg-[var(--panel-strong)] p-3 text-[11px] uppercase tracking-wider text-[var(--faint)]"
              >
                Capability
              </th>
              {visibleSubjects.map((subject) => (
                <th
                  key={subject.id}
                  scope="col"
                  className={`min-w-36 border-b border-[var(--border)] p-3 ${subject.id === selectedSubjectId ? "bg-[var(--accent-soft)]" : ""}`}
                >
                  <span className="flex items-center gap-1.5">
                    {subject.name}
                    {subject.locked ? <LockKeyhole size={12} /> : null}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-normal text-[var(--faint)]">
                    {subject.state}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ area, capabilities: areaCapabilities }) => (
              <MatrixGroup
                key={area.id}
                area={area}
                capabilities={areaCapabilities}
                visibleSubjects={visibleSubjects}
              />
            ))}
          </tbody>
        </table>
        {capabilities.length === 0 ? (
          <div className="grid min-h-44 place-items-center text-sm text-[var(--muted)]">
            No capabilities match these filters.
          </div>
        ) : null}
      </div>
      <CreateStructureDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function SubjectColumnPicker({
  subjects,
  visibleSubjectIds,
  saving,
  onToggle,
  onShowAll,
}: {
  subjects: ReturnType<typeof useBoardContext>["subjects"];
  visibleSubjectIds: ReadonlySet<string>;
  saving: boolean;
  onToggle: (subjectId: string) => Promise<void>;
  onShowAll: () => Promise<void>;
}) {
  if (subjects.length === 0) return null;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="button"
          aria-label="Choose visible subject columns"
          aria-busy={saving}
          disabled={saving}
        >
          <Columns3 size={15} /> Columns {visibleSubjectIds.size}/{subjects.length}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="panel z-[70] w-64 p-3 shadow-[var(--shadow)]"
        >
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm">Visible subjects</strong>
            <button
              type="button"
              className="button button-ghost !min-h-7 !px-2 text-xs"
              disabled={saving || visibleSubjectIds.size === subjects.length}
              onClick={() => void onShowAll()}
            >
              Show all
            </button>
          </div>
          <div className="mt-2 grid gap-1">
            {subjects.map((subject) => {
              const visible = visibleSubjectIds.has(subject.id);
              return (
                <label
                  key={subject.id}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-[var(--accent-soft)]"
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={saving}
                    aria-label={`Show ${subject.name} column`}
                    onChange={() => void onToggle(subject.id)}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {subject.name}
                  </span>
                  <span className="text-[10px] text-[var(--faint)]">{subject.state}</span>
                </label>
              );
            })}
          </div>
          <Popover.Arrow className="fill-[var(--panel)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MatrixGroup({
  area,
  capabilities,
  visibleSubjects,
}: {
  area: FeatureArea;
  capabilities: Capability[];
  visibleSubjects: ReturnType<typeof useBoardContext>["subjects"];
}) {
  if (capabilities.length === 0) return null;
  const completeCount = capabilities.filter(
    (capability) => capability.completionStatus === "complete",
  ).length;
  return (
    <>
      <tr>
        <th
          colSpan={visibleSubjects.length + 1}
          className="border-b border-[var(--border)] bg-[var(--sidebar)] px-3 py-2 text-xs font-extrabold"
        >
          {area.title}
          <span className="ml-2 font-normal text-[var(--faint)]">{capabilities.length}</span>
          {completeCount ? (
            <span className="ml-2 font-normal text-[var(--success)]">{completeCount} complete</span>
          ) : null}
        </th>
      </tr>
      {capabilities.map((capability) => (
        <MatrixCapabilityRows
          key={capability.id}
          capability={capability}
          visibleSubjects={visibleSubjects}
        />
      ))}
    </>
  );
}

function MatrixCapabilityRows({
  capability,
  visibleSubjects,
}: {
  capability: Capability;
  visibleSubjects: ReturnType<typeof useBoardContext>["subjects"];
}) {
  const { projection, subjects, selectedSubjectId, permissions } = useBoardContext();
  const { runtime } = useRuntime();
  const { run, running, error, clearError } = useActionExecutor();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(capability);
  const [baseEventId, setBaseEventId] = useState("");
  const projected = projection.capabilities.get(capability.id);
  const gap = gapFor(projection, capability, subjects);
  const discussions = unresolvedThreadCount(projection, capability.id);
  const editorId = `matrix-capability-editor-${capability.id}`;
  const changed =
    draft.title !== capability.title ||
    draft.desiredOutcome !== capability.desiredOutcome ||
    draft.decisionStatus !== capability.decisionStatus ||
    draft.priority !== capability.priority ||
    draft.completionStatus !== capability.completionStatus;
  const complete = capability.completionStatus === "complete";

  const openEditor = () => {
    if (editing) {
      setEditing(false);
      return;
    }
    clearError();
    setDraft(capability);
    setBaseEventId(projected?.currentEvent.id ?? "");
    setEditing(true);
  };

  const save = async () => {
    const current = projection.capabilities.get(capability.id);
    if (!current || !baseEventId) return;
    if (
      current.currentEvent.id !== baseEventId &&
      !confirm(
        "This capability changed while the inline editor was open. Apply your inline changes to the newer version?",
      )
    )
      return;
    const value: Capability = {
      ...current.value,
      title: draft.title,
      desiredOutcome: draft.desiredOutcome,
      decisionStatus: draft.decisionStatus,
      priority: draft.priority,
      completionStatus: draft.completionStatus,
    };
    await run(
      PublishMutation({
        kind: KINDS.capability,
        operation: "update",
        entityId: value.id,
        baseEventId: current.currentEvent.id,
        value,
      }),
    );
    await runtime.localState.follow(capability.id);
    setEditing(false);
  };

  return (
    <>
      <tr
        className={`group ${complete ? "bg-[color:var(--success-soft)]/20" : "hover:bg-[color:var(--accent-soft)]/30"}`}
      >
        <td
          className={`sticky left-0 z-[1] border-b border-r border-[var(--border)] p-3 ${complete ? "bg-[var(--success-soft)]" : "bg-[var(--panel)] group-hover:bg-[var(--panel-strong)]"}`}
        >
          {permissions.canWrite ? (
            <button
              type="button"
              className="flex w-full cursor-pointer items-start justify-between gap-2 border-0 bg-transparent p-0 text-left font-bold text-inherit hover:text-[var(--accent)]"
              aria-expanded={editing}
              aria-controls={editorId}
              onClick={openEditor}
            >
              <span>{capability.title}</span>
              <Pencil className="mt-0.5 shrink-0 opacity-50" size={13} aria-hidden="true" />
            </button>
          ) : (
            <Link
              to={`../capabilities/${capability.id}`}
              className="font-bold text-inherit no-underline hover:text-[var(--accent)]"
            >
              {capability.title}
            </Link>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <GapBadge label={gap.label} />
            <PriorityBadge priority={capability.priority} />
            {complete ? <CompletionBadge status="complete" /> : null}
            {discussions ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)]">
                <MessageSquareText size={11} />
                {discussions}
              </span>
            ) : null}
          </div>
        </td>
        {visibleSubjects.map((subject) => (
          <td
            key={subject.id}
            className={`border-b border-[var(--border)] p-2 ${subject.id === selectedSubjectId ? "bg-[color:var(--accent-soft)]/35" : ""}`}
          >
            <AssessmentCell
              capability={capability}
              subjectId={subject.id}
              locked={subject.locked}
            />
          </td>
        ))}
      </tr>
      {editing ? (
        <tr>
          <td
            id={editorId}
            colSpan={visibleSubjects.length + 1}
            className="border-b border-[var(--border)] bg-[var(--sidebar)] p-3"
          >
            <form
              aria-label={`Edit ${capability.title} inline`}
              className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.7fr)_repeat(4,minmax(130px,1fr))]">
                <label className="label">
                  Title
                  <input
                    className="input !min-h-9"
                    value={draft.title}
                    required
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </label>
                <label className="label">
                  Desired outcome
                  <select
                    className="input !min-h-9"
                    value={draft.desiredOutcome}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        desiredOutcome: event.target.value as DesiredOutcome,
                      })
                    }
                  >
                    {DESIRED_OUTCOMES.map((value) => (
                      <option key={value} value={value}>
                        {humanize(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Decision status
                  <select
                    className="input !min-h-9"
                    value={draft.decisionStatus}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        decisionStatus: event.target.value as DecisionStatus,
                      })
                    }
                  >
                    {DECISION_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {humanize(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Priority
                  <select
                    className="input !min-h-9"
                    value={draft.priority}
                    onChange={(event) =>
                      setDraft({ ...draft, priority: event.target.value as Priority })
                    }
                  >
                    {PRIORITIES.map((value) => (
                      <option key={value} value={value}>
                        {humanize(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Completion
                  <select
                    className="input !min-h-9"
                    value={draft.completionStatus}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        completionStatus: event.target.value as CompletionStatus,
                      })
                    }
                  >
                    {COMPLETION_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {humanize(value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-[11px] text-[var(--faint)]">
                  Saving publishes a complete signed capability snapshot.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="button button-ghost !min-h-8 text-xs no-underline"
                    to={`../capabilities/${capability.id}`}
                  >
                    Open full details <ExternalLink size={12} />
                  </Link>
                  <button
                    type="button"
                    className="button !min-h-8 text-xs"
                    disabled={running}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="button button-primary !min-h-8 text-xs"
                    disabled={running || !changed || !draft.title.trim()}
                  >
                    {running ? "Publishing…" : "Save & publish"}
                  </button>
                </div>
              </div>
              {error ? <p className="m-0 text-xs text-[var(--critical)]">{error}</p> : null}
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AssessmentCell({
  capability,
  subjectId,
  locked,
}: {
  capability: Capability;
  subjectId: string;
  locked: boolean;
}) {
  const { projection, permissions } = useBoardContext();
  const { run, running, error } = useActionExecutor();
  const assessment = assessmentFor(projection, capability.id, subjectId);
  const status = assessment?.status ?? "unknown";
  const update = async (nextStatus: ImplementationStatus) => {
    const value: Assessment = {
      id: assessment?.id ?? assessmentId(capability.boardId, capability.id, subjectId),
      boardId: capability.boardId,
      featureAreaId: capability.featureAreaId,
      capabilityId: capability.id,
      subjectId,
      status: nextStatus,
      state: "active",
      ...(assessment?.note ? { note: assessment.note } : {}),
    };
    await run(
      PublishMutation({
        kind: KINDS.assessment,
        operation: assessment ? "update" : "create",
        entityId: value.id,
        baseEventId: assessment
          ? (projection.assessments.get(assessment.id)?.currentEvent.id ?? null)
          : null,
        value,
      }),
    );
  };
  if (!permissions.canWrite || locked)
    return (
      <div title={locked ? "Historical subject is locked" : undefined}>
        <StatusBadge status={status} />
        {assessment?.note ? (
          <p className="mb-0 mt-1 line-clamp-2 text-[10px] text-[var(--muted)]">
            {assessment.note}
          </p>
        ) : null}
      </div>
    );
  return (
    <div>
      <div className="relative" data-assessment-status={status}>
        <StatusIcon
          status={status}
          className={`pointer-events-none absolute left-2.5 top-1/2 z-[1] -translate-y-1/2 ${statusColor(status)}`}
        />
        <select
          aria-label={`Set ${capability.title} status`}
          className="input !min-h-8 !py-1 !pl-8 text-xs"
          value={status}
          disabled={running}
          onChange={(event) => void update(event.target.value as ImplementationStatus)}
        >
          {STATUSES.map((item) => (
            <option key={item} value={item}>
              {statusLabel(item)}
            </option>
          ))}
        </select>
      </div>
      {assessment?.note ? (
        <p className="mb-0 mt-1 line-clamp-2 text-[10px] text-[var(--muted)]">{assessment.note}</p>
      ) : null}
      {error ? (
        <span className="mt-1 block text-[10px] text-[var(--critical)]" title={error}>
          Write failed
        </span>
      ) : null}
    </div>
  );
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function CreateStructureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { projection, permissions } = useBoardContext();
  const { run, running, error } = useActionExecutor();
  const areas = activeFeatureAreas(projection);
  const [mode, setMode] = useState<"area" | "capability">("capability");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  useEffect(() => {
    if (!areas.some((area) => area.id === areaId)) setAreaId(areas[0]?.id ?? "");
  }, [areas, areaId]);
  const submit = async () => {
    if (!permissions.canWrite || !projection.board) return;
    if (mode === "area") {
      const value: FeatureArea = {
        id: newEntityId(),
        boardId: projection.boardId,
        title: title.trim(),
        description: description.trim(),
        orderKey: orderKeyBetween(areas.at(-1)?.orderKey, null),
        state: "active",
      };
      await run(
        PublishMutation({
          kind: KINDS.featureArea,
          operation: "create",
          entityId: value.id,
          value,
        }),
      );
    } else {
      const siblings = activeCapabilities(projection).filter(
        (capability) => capability.featureAreaId === areaId,
      );
      const value: Capability = {
        id: newEntityId(),
        boardId: projection.boardId,
        featureAreaId: areaId,
        title: title.trim(),
        description: description.trim(),
        orderKey: orderKeyBetween(siblings.at(-1)?.orderKey, null),
        state: "active",
        desiredOutcome: "undecided",
        decisionStatus: "open",
        priority: "none",
        completionStatus: "in_progress",
        links: [],
      };
      await run(
        PublishMutation({ kind: KINDS.capability, operation: "create", entityId: value.id, value }),
      );
    }
    setTitle("");
    setDescription("");
    onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add board structure"
      description="Facet supports exactly two levels: feature areas and capabilities."
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`button ${mode === "capability" ? "button-primary" : ""}`}
            onClick={() => setMode("capability")}
          >
            Capability
          </button>
          <button
            type="button"
            className={`button ${mode === "area" ? "button-primary" : ""}`}
            onClick={() => setMode("area")}
          >
            Feature area
          </button>
        </div>
        {mode === "capability" ? (
          <label className="label">
            Feature area
            <select
              className="input"
              value={areaId}
              onChange={(event) => setAreaId(event.target.value)}
              required
            >
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="label">
          Title
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <label className="label">
          Description
          <textarea
            className="input min-h-24"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={running || !title.trim() || (mode === "capability" && !areaId)}
        >
          {running ? "Publishing…" : `Create ${mode}`}
        </button>
        {error ? <p className="m-0 text-sm text-[var(--critical)]">{error}</p> : null}
      </form>
    </Modal>
  );
}
