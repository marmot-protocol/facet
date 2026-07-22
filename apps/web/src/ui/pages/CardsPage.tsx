import { ExternalLink, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ComparisonSubjectSelector, useBoardContext } from "../BoardShell";
import { activeCapabilities, assessmentFor, gapFor, unresolvedThreadCount } from "../board-data";
import {
  CapabilityFilterBar,
  type CapabilityFilters,
  EMPTY_FILTERS,
  filterCapabilities,
} from "../Filters";
import { GapBadge, PriorityBadge, StatusBadge } from "../primitives";

export function CardsPage() {
  const { projection, subjects, selectedSubjectId } = useBoardContext();
  const [filters, setFilters] = useState<CapabilityFilters>(EMPTY_FILTERS);
  const capabilities = filterCapabilities(
    activeCapabilities(projection),
    projection,
    selectedSubjectId,
    filters,
  );
  const areaById = new Map(
    [...projection.featureAreas.values()].map(({ value }) => [value.id, value]),
  );
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-black tracking-tight">Capability cards</h1>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            The same board data and filters, optimized for focused review.
          </p>
        </div>
        <ComparisonSubjectSelector />
      </div>
      <CapabilityFilterBar projection={projection} filters={filters} onChange={setFilters} />
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {capabilities.map((capability) => {
          const gap = gapFor(projection, capability, subjects);
          const assessment = assessmentFor(projection, capability.id, selectedSubjectId);
          const discussions = unresolvedThreadCount(projection, capability.id);
          return (
            <Link
              key={capability.id}
              to={`../capabilities/${capability.id}`}
              className="panel group flex min-h-48 flex-col p-4 text-inherit no-underline transition-transform hover:-translate-y-0.5 hover:shadow-[var(--shadow)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">
                    {areaById.get(capability.featureAreaId)?.title}
                  </span>
                  <h2 className="m-0 mt-1 text-base font-extrabold group-hover:text-[var(--accent)]">
                    {capability.title}
                  </h2>
                </div>
                <StatusBadge status={assessment?.status ?? "unknown"} />
              </div>
              <p className="line-clamp-3 text-sm text-[var(--muted)]">
                {capability.description || "No description yet."}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <GapBadge label={gap.label} />
                <PriorityBadge priority={capability.priority} />
                <span className="rounded-full bg-[var(--sidebar)] px-2 py-0.5 text-[11px] font-bold text-[var(--muted)]">
                  {capability.decisionStatus}
                </span>
                {discussions ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
                    <MessageSquareText size={12} />
                    {discussions}
                  </span>
                ) : null}
                {capability.links.length ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
                    <ExternalLink size={12} />
                    {capability.links.length}
                  </span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
      {capabilities.length === 0 ? (
        <div className="panel grid min-h-48 place-items-center text-sm text-[var(--muted)]">
          No capabilities match these filters.
        </div>
      ) : null}
    </div>
  );
}
