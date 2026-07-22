import {
  type Assessment,
  assessmentId,
  type Capability,
  type FeatureArea,
  type ImplementationStatus,
  KINDS,
  newEntityId,
  orderKeyBetween,
} from "@facet/protocol";
import { LockKeyhole, MessageSquareText, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublishMutation } from "../../runtime/actions";
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
import { GapBadge, Modal, PriorityBadge, StatusBadge } from "../primitives";

const STATUSES: ImplementationStatus[] = [
  "unknown",
  "not_implemented",
  "partial",
  "implemented",
  "stub_or_broken",
  "not_applicable",
];

export function MatrixPage() {
  const context = useBoardContext();
  const { projection, subjects, selectedSubjectId, permissions } = context;
  const [filters, setFilters] = useState<CapabilityFilters>(EMPTY_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
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
        <table className="w-full min-w-[900px] border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-[var(--panel-strong)]">
            <tr>
              <th className="sticky left-0 z-[2] min-w-[300px] border-b border-r border-[var(--border)] bg-[var(--panel-strong)] p-3 text-[11px] uppercase tracking-wider text-[var(--faint)]">
                Capability
              </th>
              {subjects.map((subject) => (
                <th
                  key={subject.id}
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
                context={context}
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

function MatrixGroup({
  area,
  capabilities,
  context,
}: {
  area: FeatureArea;
  capabilities: Capability[];
  context: ReturnType<typeof useBoardContext>;
}) {
  const { projection, subjects, selectedSubjectId } = context;
  if (capabilities.length === 0) return null;
  return (
    <>
      <tr>
        <th
          colSpan={subjects.length + 1}
          className="border-b border-[var(--border)] bg-[var(--sidebar)] px-3 py-2 text-xs font-extrabold"
        >
          {area.title}
          <span className="ml-2 font-normal text-[var(--faint)]">{capabilities.length}</span>
        </th>
      </tr>
      {capabilities.map((capability) => {
        const gap = gapFor(projection, capability, subjects);
        const discussions = unresolvedThreadCount(projection, capability.id);
        return (
          <tr key={capability.id} className="group hover:bg-[color:var(--accent-soft)]/30">
            <td className="sticky left-0 z-[1] border-b border-r border-[var(--border)] bg-[var(--panel)] p-3 group-hover:bg-[var(--panel-strong)]">
              <Link
                to={`../capabilities/${capability.id}`}
                className="font-bold text-inherit no-underline hover:text-[var(--accent)]"
              >
                {capability.title}
              </Link>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <GapBadge label={gap.label} />
                <PriorityBadge priority={capability.priority} />
                {discussions ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)]">
                    <MessageSquareText size={11} />
                    {discussions}
                  </span>
                ) : null}
              </div>
            </td>
            {subjects.map((subject) => (
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
        );
      })}
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
      <select
        aria-label={`Set ${capability.title} status`}
        className="input !min-h-8 !py-1 text-xs"
        value={status}
        disabled={running}
        onChange={(event) => void update(event.target.value as ImplementationStatus)}
      >
        {STATUSES.map((item) => (
          <option key={item} value={item}>
            {item.replaceAll("_", " ")}
          </option>
        ))}
      </select>
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
