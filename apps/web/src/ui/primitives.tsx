import type { CompletionStatus, GapLabel, ImplementationStatus, Priority } from "@facet/protocol";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import { getParsedContent } from "applesauce-content/text";
import { ProfileModel } from "applesauce-core/models/profile";
import { useEventModel } from "applesauce-react/hooks/use-event-model";
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleMinus,
  CircleX,
  TriangleAlert,
  X,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import type { PropsWithChildren, ReactNode } from "react";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
}>) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content className="panel fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,calc(100vw-28px))] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5 shadow-[var(--shadow)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="m-0 text-[17px] font-bold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-[var(--muted)]">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close className="button button-ghost !min-h-8 !p-1.5" aria-label="Close">
              <X size={17} />
            </Dialog.Close>
          </div>
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SelectInput({
  value,
  onValueChange,
  options,
  disabled,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={onValueChange}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      <Select.Trigger
        className="input flex min-w-[140px] items-center justify-between gap-3 text-left"
        aria-label={label}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="panel z-[70] min-w-[180px] overflow-hidden p-1 shadow-[var(--shadow)]">
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-3 outline-none data-[highlighted]:bg-[var(--accent-soft)]"
              >
                <Select.ItemIndicator className="absolute left-2">
                  <Check size={14} />
                </Select.ItemIndicator>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function GapBadge({ label }: { label: GapLabel }) {
  const names: Record<GapLabel, string> = {
    critical: "Critical gap",
    gap: "Gap",
    needs_verification: "Needs verification",
    aligned: "Aligned",
  };
  return (
    <Badge
      tone={
        label === "critical"
          ? "critical"
          : label === "gap"
            ? "warning"
            : label === "needs_verification"
              ? "info"
              : "success"
      }
    >
      {names[label]}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: ImplementationStatus }) {
  const tone =
    status === "implemented"
      ? "success"
      : status === "unknown"
        ? "neutral"
        : status === "not_applicable"
          ? "neutral"
          : status === "partial"
            ? "warning"
            : "critical";
  return (
    <Badge tone={tone}>
      <StatusIcon status={status} size={12} />
      {statusLabel(status)}
    </Badge>
  );
}

export function StatusIcon({
  status,
  size = 14,
  className = "",
}: {
  status: ImplementationStatus;
  size?: number;
  className?: string;
}) {
  const Icon = {
    unknown: CircleHelp,
    not_implemented: CircleX,
    partial: CircleDot,
    implemented: CircleCheck,
    stub_or_broken: TriangleAlert,
    not_applicable: CircleMinus,
  }[status];
  return (
    <Icon
      aria-hidden="true"
      className={className}
      data-status-icon={status}
      size={size}
      strokeWidth={2.25}
    />
  );
}

export function statusLabel(status: ImplementationStatus): string {
  return {
    unknown: "Unknown",
    not_implemented: "Not implemented",
    partial: "Partial",
    implemented: "Implemented",
    stub_or_broken: "Stub / broken",
    not_applicable: "N/A",
  }[status];
}

export function statusColor(status: ImplementationStatus): string {
  return {
    unknown: "text-[var(--faint)]",
    not_implemented: "text-[var(--critical)]",
    partial: "text-[var(--warning)]",
    implemented: "text-[var(--success)]",
    stub_or_broken: "text-[var(--critical)]",
    not_applicable: "text-[var(--faint)]",
  }[status];
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge tone={priority === "now" ? "critical" : priority === "next" ? "warning" : "neutral"}>
      {priority}
    </Badge>
  );
}

export function CompletionBadge({ status }: { status: CompletionStatus }) {
  return (
    <Badge tone={status === "complete" ? "success" : "neutral"}>
      {status === "complete" ? <CircleCheck size={12} /> : <CircleDot size={12} />}
      {status === "complete" ? "Complete" : "In progress"}
    </Badge>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "critical" | "warning" | "info" | "success" }>) {
  const style = {
    neutral: "bg-[var(--sidebar)] text-[var(--muted)]",
    critical: "bg-[var(--critical-soft)] text-[var(--critical)]",
    warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
    info: "bg-[var(--info-soft)] text-[var(--info)]",
    success: "bg-[var(--success-soft)] text-[var(--success)]",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${style}`}
    >
      {children}
    </span>
  );
}

export function Identity({
  pubkey,
  compact = false,
  showAvatar = true,
}: {
  pubkey: string;
  compact?: boolean;
  showAvatar?: boolean;
}) {
  const profile = useEventModel(ProfileModel, [pubkey]);
  const label = profile?.display_name || profile?.name || shortNpub(pubkey);
  return (
    <span className="inline-flex min-w-0 items-center gap-2" title={nip19.npubEncode(pubkey)}>
      {showAvatar ? (
        profile?.picture ? (
          <img
            className="size-6 rounded-full object-cover"
            src={profile.picture}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">
            {label.slice(0, 2).toUpperCase()}
          </span>
        )
      ) : null}
      {!compact ? <span className="truncate">{label}</span> : null}
    </span>
  );
}

export function RichText({ content }: { content: string }) {
  const parsed = getParsedContent(content);
  const keyOccurrences = new Map<string, number>();
  return (
    <span className="whitespace-pre-wrap break-words">
      {parsed.children.map((node) => {
        const fingerprint = JSON.stringify(node);
        const occurrence = keyOccurrences.get(fingerprint) ?? 0;
        keyOccurrences.set(fingerprint, occurrence + 1);
        const key = `${fingerprint}:${occurrence}`;
        if (node.type === "text") return <span key={key}>{node.value}</span>;
        if (node.type === "link") {
          return (
            <a
              key={key}
              href={node.href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              {node.value}
            </a>
          );
        }
        if (node.type === "mention")
          return <NostrProfileMention key={key} encoded={node.encoded} />;
        if (node.type === "hashtag")
          return (
            <span key={key} className="text-[var(--accent)]">
              #{node.name}
            </span>
          );
        if (node.type === "emoji")
          return <img key={key} src={node.url} alt={node.raw} className="inline size-5" />;
        return <span key={key}>{"raw" in node ? String(node.raw) : ""}</span>;
      })}
    </span>
  );
}

function NostrProfileMention({ encoded }: { encoded: string }) {
  const pubkey = pubkeyForMention(encoded);
  const profile = useEventModel(ProfileModel, pubkey ? [pubkey] : null);
  const label =
    profile?.display_name ||
    profile?.name ||
    `${encoded.slice(0, 12)}${encoded.length > 12 ? "…" : ""}`;
  return (
    <span
      className="font-semibold text-[var(--accent)]"
      title={`nostr:${encoded}`}
      data-pubkey={pubkey}
    >
      @{label}
    </span>
  );
}

function pubkeyForMention(encoded: string): string | undefined {
  try {
    const decoded = nip19.decode(encoded);
    if (decoded.type === "npub") return decoded.data;
    if (decoded.type === "nprofile") return decoded.data.pubkey;
  } catch {
    // Keep malformed or unsupported Nostr pointers readable as their encoded fallback.
  }
  return undefined;
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel grid min-h-52 place-items-center p-8 text-center">
      <div className="max-w-sm">
        {icon ? <div className="mx-auto mb-3 text-[var(--faint)]">{icon}</div> : null}
        <h2 className="m-0 text-base font-bold">{title}</h2>
        <p className="mb-0 mt-1.5 text-sm text-[var(--muted)]">{detail}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

export function formatRelative(timestamp: number): string {
  const seconds = Math.round(Date.now() / 1000 - timestamp);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

export function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
}
