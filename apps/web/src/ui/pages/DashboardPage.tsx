import {
  type Assessment,
  type Capability,
  type GapResult,
  type SelectedClientWork,
  selectedClientWork,
} from "@facet/protocol";
import { ArrowRight, CircleAlert, MessageSquareText, RadioTower } from "lucide-react";
import { Link } from "react-router-dom";
import { ComparisonSubjectSelector, useBoardContext } from "../BoardShell";
import { activeCapabilities, assessmentFor, gapFor, unresolvedThreadCount } from "../board-data";
import {
  CompletionBadge,
  EmptyState,
  formatRelative,
  GapBadge,
  PriorityBadge,
  StatusBadge,
} from "../primitives";

export function DashboardPage() {
  const { projection, subjects, selectedSubjectId } = useBoardContext();
  const capabilities = activeCapabilities(projection);
  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId);
  const records = capabilities.map((capability) => {
    const gap = gapFor(projection, capability, subjects);
    const assessment = assessmentFor(projection, capability.id, selectedSubjectId);
    return {
      capability,
      gap,
      assessment,
      work: selectedClientWork(capability, assessment, gap),
      unresolved: unresolvedThreadCount(projection, capability.id),
    } satisfies WorkRecord;
  });
  const gapCounts = {
    critical: records.filter((record) => record.gap.label === "critical").length,
    gap: records.filter((record) => record.gap.label === "gap").length,
    needs_verification: records.filter((record) => record.gap.label === "needs_verification")
      .length,
    aligned: records.filter((record) => record.gap.label === "aligned").length,
  };
  const agreed = records.filter((record) => record.work.category === "agreed_work");
  const decisions = records.filter((record) => record.work.category === "needs_decision");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-black tracking-tight">Parity overview</h1>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            Work and unresolved decisions for {selectedSubject?.name ?? "the selected subject"}.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <ComparisonSubjectSelector />
          <Link className="button no-underline" to="../matrix">
            Open matrix <ArrowRight size={15} />
          </Link>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Critical gaps"
          value={gapCounts.critical}
          tone="critical"
          detail="Now-priority confirmed gaps"
        />
        <SummaryCard
          label="Gaps"
          value={gapCounts.gap}
          tone="warning"
          detail="Confirmed status or target differences"
        />
        <SummaryCard
          label="Needs verification"
          value={gapCounts.needs_verification}
          tone="info"
          detail="Unknown active assessments"
        />
        <SummaryCard
          label="Aligned"
          value={gapCounts.aligned}
          tone="success"
          detail="No material active difference"
        />
      </div>

      {capabilities.length === 0 ? (
        <EmptyState
          icon={<RadioTower className="mx-auto" />}
          title="This board has no capabilities yet"
          detail="Create feature areas and capabilities from the matrix view, or run the White Noise importer."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr_0.8fr]">
          <WorkList
            title="Agreed work"
            subtitle={`${agreed.length} decided change${agreed.length === 1 ? "" : "s"}`}
            rows={agreed}
            empty="No decided work for this subject."
          />
          <WorkList
            title="Needs decision"
            subtitle={`${decisions.length} unresolved item${decisions.length === 1 ? "" : "s"}`}
            rows={decisions}
            empty="No relevant open decisions."
          />
          <section className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="m-0 text-base font-extrabold">Recent activity</h2>
                <p className="m-0 text-xs text-[var(--muted)]">Signed board changes</p>
              </div>
              <Link className="text-xs font-bold text-[var(--accent)]" to="../activity">
                View all
              </Link>
            </div>
            <div className="grid gap-1">
              {projection.activity.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="border-t border-[var(--border)] py-2.5 first:border-t-0"
                >
                  <p className="m-0 text-sm font-semibold">{item.summary}</p>
                  <p className="m-0 mt-0.5 text-[11px] text-[var(--faint)]">
                    {formatRelative(item.createdAt)} · {item.actor.slice(0, 8)}…
                  </p>
                </div>
              ))}
              {projection.activity.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No accepted activity yet.</p>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: number;
  tone: string;
  detail: string;
}) {
  const toneClass =
    {
      critical: "border-t-[3px] border-t-[var(--critical)]",
      warning: "border-t-[3px] border-t-[var(--warning)]",
      info: "border-t-[3px] border-t-[var(--info)]",
      success: "border-t-[3px] border-t-[var(--success)]",
    }[tone] ?? "";
  return (
    <div className={`panel p-4 ${toneClass}`}>
      <span className="text-xs font-bold text-[var(--muted)]">{label}</span>
      <div className="mt-1 text-3xl font-black tracking-tight">{value}</div>
      <span className="text-[11px] text-[var(--faint)]">{detail}</span>
    </div>
  );
}

function WorkList({
  title,
  subtitle,
  rows,
  empty,
}: {
  title: string;
  subtitle: string;
  rows: WorkRecord[];
  empty: string;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-2">
        <h2 className="m-0 text-base font-extrabold">{title}</h2>
        <p className="m-0 text-xs text-[var(--muted)]">{subtitle}</p>
      </div>
      <div>
        {rows.slice(0, 12).map(({ capability, gap, assessment, unresolved }) => (
          <Link
            key={capability.id}
            to={`../capabilities/${capability.id}`}
            className="group flex items-center gap-3 border-t border-[var(--border)] py-3 text-inherit no-underline first:border-t-0"
          >
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate font-bold group-hover:text-[var(--accent)]">
                {capability.title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <GapBadge label={gap.label} />
                <PriorityBadge priority={capability.priority} />
                {capability.completionStatus === "complete" ? (
                  <CompletionBadge status="complete" />
                ) : null}
                {unresolved > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
                    <MessageSquareText size={11} /> {unresolved} open
                  </span>
                ) : null}
              </div>
            </div>
            <StatusBadge status={assessment?.status ?? "unknown"} />
          </Link>
        ))}
        {rows.length === 0 ? (
          <div className="grid min-h-32 place-items-center text-center text-sm text-[var(--muted)]">
            <span>
              <CircleAlert className="mx-auto mb-2" size={19} />
              {empty}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type WorkRecord = {
  capability: Capability;
  gap: GapResult;
  assessment: Assessment | undefined;
  work: SelectedClientWork;
  unresolved: number;
};
