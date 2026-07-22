import { Activity } from "lucide-react";
import { useState } from "react";
import { useBoardContext } from "../BoardShell";
import { Badge, formatRelative, Identity, SelectInput } from "../primitives";

export function ActivityPage() {
  const { projection } = useBoardContext();
  const [filter, setFilter] = useState("all");
  const activities = projection.activity.filter(
    (item) => filter === "all" || groupForKind(item.kind) === filter,
  );
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-black tracking-tight">Activity</h1>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            Accepted mutations, discussion, membership, and reactions.
          </p>
        </div>
        <SelectInput
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "all", label: "All activity" },
            { value: "structure", label: "Structure & status" },
            { value: "discussion", label: "Discussion" },
            { value: "membership", label: "Membership" },
          ]}
        />
      </div>
      <section className="panel divide-y divide-[var(--border)]">
        {activities.map((item) => (
          <article key={item.id} className="flex gap-3 p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--sidebar)] text-[var(--muted)]">
              <Activity size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Identity pubkey={item.actor} />
                <Badge>{groupForKind(item.kind)}</Badge>
                <span className="text-xs text-[var(--faint)]">
                  {formatRelative(item.createdAt)}
                </span>
              </div>
              <p className="m-0 mt-1.5 font-semibold">{item.summary}</p>
              <code className="mt-1 block truncate text-[10px] text-[var(--faint)]">{item.id}</code>
            </div>
          </article>
        ))}
        {activities.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">No matching activity.</div>
        ) : null}
      </section>
    </div>
  );
}

function groupForKind(kind: number): "structure" | "discussion" | "membership" {
  if (kind === 3501 || kind === 3499) return "membership";
  if (kind === 1111 || kind === 1009 || kind === 7 || kind === 5 || kind === 3506)
    return "discussion";
  return "structure";
}
