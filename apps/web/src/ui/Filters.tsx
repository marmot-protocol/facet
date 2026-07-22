import type {
  BoardProjection,
  Capability,
  CompletionStatus,
  DecisionStatus,
  DesiredOutcome,
  ImplementationStatus,
  Priority,
} from "@facet/protocol";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { assessmentFor, unresolvedThreadCount } from "./board-data";
import { SelectInput } from "./primitives";

export type CapabilityFilters = {
  query: string;
  featureAreaId: string;
  implementation: "all" | ImplementationStatus;
  desiredOutcome: "all" | DesiredOutcome;
  decisionStatus: "all" | DecisionStatus;
  priority: "all" | Priority;
  completion: "all" | CompletionStatus;
  discussion: "all" | "unresolved";
  links: "all" | "linked";
  sort: "board_order" | "in_progress_first" | "complete_first";
};

export const EMPTY_FILTERS: CapabilityFilters = {
  query: "",
  featureAreaId: "all",
  implementation: "all",
  desiredOutcome: "all",
  decisionStatus: "all",
  priority: "all",
  completion: "all",
  discussion: "all",
  links: "all",
  sort: "board_order",
};

export function CapabilityFilterBar({
  projection,
  filters,
  onChange,
}: {
  projection: BoardProjection;
  filters: CapabilityFilters;
  onChange: (filters: CapabilityFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const filtersId = useId();
  const areas = [...projection.featureAreas.values()]
    .map(({ value }) => value)
    .filter((area) => area.state === "active")
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  const update = <K extends keyof CapabilityFilters>(key: K, value: CapabilityFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const activeFilters = [
    filters.featureAreaId !== "all"
      ? {
          key: "featureAreaId" as const,
          label: `Area: ${areas.find((area) => area.id === filters.featureAreaId)?.title ?? filters.featureAreaId}`,
        }
      : null,
    filters.implementation !== "all"
      ? { key: "implementation" as const, label: `Status: ${humanize(filters.implementation)}` }
      : null,
    filters.desiredOutcome !== "all"
      ? { key: "desiredOutcome" as const, label: `Outcome: ${humanize(filters.desiredOutcome)}` }
      : null,
    filters.decisionStatus !== "all"
      ? { key: "decisionStatus" as const, label: `Decision: ${humanize(filters.decisionStatus)}` }
      : null,
    filters.priority !== "all"
      ? { key: "priority" as const, label: `Priority: ${humanize(filters.priority)}` }
      : null,
    filters.completion !== "all"
      ? { key: "completion" as const, label: `Completion: ${humanize(filters.completion)}` }
      : null,
    filters.discussion !== "all"
      ? { key: "discussion" as const, label: "Discussion: Unresolved" }
      : null,
    filters.links !== "all" ? { key: "links" as const, label: "References: Has reference" } : null,
    filters.sort !== "board_order"
      ? { key: "sort" as const, label: `Sort: ${humanize(filters.sort)}` }
      : null,
  ].filter((filter) => filter !== null);
  const activeCount = activeFilters.length + (filters.query.trim() ? 1 : 0);
  const clearFilter = (key: (typeof activeFilters)[number]["key"]) =>
    onChange({ ...filters, [key]: EMPTY_FILTERS[key] });

  return (
    <div className="panel mb-4 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[210px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--faint)]"
            size={15}
          />
          <input
            className="input !pl-8"
            value={filters.query}
            onChange={(event) => update("query", event.target.value)}
            placeholder="Search capabilities…"
            aria-label="Search capabilities"
          />
        </div>
        <button
          type="button"
          className="button shrink-0"
          aria-expanded={expanded}
          aria-controls={filtersId}
          onClick={() => setExpanded((value) => !value)}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeFilters.length ? (
            <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] text-white">
              {activeFilters.length}
            </span>
          ) : null}
          <ChevronDown
            size={14}
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {activeCount ? (
          <button
            type="button"
            className="button button-ghost shrink-0"
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            <X size={14} /> Clear all
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div id={filtersId} className="mt-2.5 border-t border-[var(--border)] px-0.5 pt-3">
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <FilterField label="Feature area">
              <SelectInput
                value={filters.featureAreaId}
                onValueChange={(value) => update("featureAreaId", value)}
                label="Feature area filter"
                options={[
                  { value: "all", label: "All areas" },
                  ...areas.map((area) => ({ value: area.id, label: area.title })),
                ]}
              />
            </FilterField>
            <FilterField label="Implementation">
              <SelectInput
                value={filters.implementation}
                onValueChange={(value) =>
                  update("implementation", value as CapabilityFilters["implementation"])
                }
                label="Implementation filter"
                options={enumOptions("All statuses", [
                  "unknown",
                  "not_implemented",
                  "partial",
                  "implemented",
                  "stub_or_broken",
                  "not_applicable",
                ])}
              />
            </FilterField>
            <FilterField label="Desired outcome">
              <SelectInput
                value={filters.desiredOutcome}
                onValueChange={(value) =>
                  update("desiredOutcome", value as CapabilityFilters["desiredOutcome"])
                }
                label="Desired outcome filter"
                options={enumOptions("All outcomes", [
                  "keep_as_is",
                  "add",
                  "remove",
                  "standardize",
                  "platform_specific",
                  "undecided",
                ])}
              />
            </FilterField>
            <FilterField label="Decision">
              <SelectInput
                value={filters.decisionStatus}
                onValueChange={(value) =>
                  update("decisionStatus", value as CapabilityFilters["decisionStatus"])
                }
                label="Decision filter"
                options={enumOptions("All decisions", [
                  "open",
                  "discussing",
                  "decided",
                  "superseded",
                ])}
              />
            </FilterField>
            <FilterField label="Priority">
              <SelectInput
                value={filters.priority}
                onValueChange={(value) =>
                  update("priority", value as CapabilityFilters["priority"])
                }
                label="Priority filter"
                options={enumOptions("All priorities", ["now", "next", "later", "none"])}
              />
            </FilterField>
            <FilterField label="Completion">
              <SelectInput
                value={filters.completion}
                onValueChange={(value) =>
                  update("completion", value as CapabilityFilters["completion"])
                }
                label="Completion filter"
                options={enumOptions("All completion states", ["in_progress", "complete"])}
              />
            </FilterField>
            <FilterField label="Discussion">
              <SelectInput
                value={filters.discussion}
                onValueChange={(value) =>
                  update("discussion", value as CapabilityFilters["discussion"])
                }
                label="Discussion filter"
                options={[
                  { value: "all", label: "All discussions" },
                  { value: "unresolved", label: "Unresolved only" },
                ]}
              />
            </FilterField>
            <FilterField label="References">
              <SelectInput
                value={filters.links}
                onValueChange={(value) => update("links", value as CapabilityFilters["links"])}
                label="Link filter"
                options={[
                  { value: "all", label: "All references" },
                  { value: "linked", label: "Has reference" },
                ]}
              />
            </FilterField>
            <FilterField label="Sort">
              <SelectInput
                value={filters.sort}
                onValueChange={(value) => update("sort", value as CapabilityFilters["sort"])}
                label="Capability sort"
                options={[
                  { value: "board_order", label: "Board order" },
                  { value: "in_progress_first", label: "In progress first" },
                  { value: "complete_first", label: "Complete first" },
                ]}
              />
            </FilterField>
          </div>
          <p className="mb-0 mt-2.5 inline-flex items-center gap-1 text-xs text-[var(--faint)]">
            <SlidersHorizontal size={13} /> Filters are temporary and reset when you leave this
            view.
          </p>
        </div>
      ) : activeFilters.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-[var(--border)] px-0.5 pt-2.5">
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--text)]"
              aria-label={`Remove ${filter.label} filter`}
              onClick={() => clearFilter(filter.key)}
            >
              {filter.label} <X size={12} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="px-0.5 text-[11px] font-bold text-[var(--muted)]">{label}</span>
      {children}
    </div>
  );
}

export function filterCapabilities(
  capabilities: Capability[],
  projection: BoardProjection,
  selectedSubjectId: string,
  filters: CapabilityFilters,
): Capability[] {
  const query = filters.query.trim().toLowerCase();
  const filtered = capabilities.filter((capability) => {
    if (
      query &&
      !`${capability.title} ${capability.description ?? ""}`.toLowerCase().includes(query)
    )
      return false;
    if (filters.featureAreaId !== "all" && capability.featureAreaId !== filters.featureAreaId)
      return false;
    if (
      filters.implementation !== "all" &&
      (assessmentFor(projection, capability.id, selectedSubjectId)?.status ?? "unknown") !==
        filters.implementation
    )
      return false;
    if (filters.desiredOutcome !== "all" && capability.desiredOutcome !== filters.desiredOutcome)
      return false;
    if (filters.decisionStatus !== "all" && capability.decisionStatus !== filters.decisionStatus)
      return false;
    if (filters.priority !== "all" && capability.priority !== filters.priority) return false;
    if (filters.completion !== "all" && capability.completionStatus !== filters.completion)
      return false;
    if (
      filters.discussion === "unresolved" &&
      unresolvedThreadCount(projection, capability.id) === 0
    )
      return false;
    if (filters.links === "linked" && capability.links.length === 0) return false;
    return true;
  });
  if (filters.sort === "board_order") return filtered;
  const completedFirst = filters.sort === "complete_first";
  return [...filtered].sort((left, right) => {
    const leftComplete = left.completionStatus === "complete";
    const rightComplete = right.completionStatus === "complete";
    if (leftComplete === rightComplete) return 0;
    return leftComplete === completedFirst ? -1 : 1;
  });
}

function enumOptions(allLabel: string, values: string[]) {
  return [
    { value: "all", label: allLabel },
    ...values.map((value) => ({ value, label: humanize(value) })),
  ];
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}
