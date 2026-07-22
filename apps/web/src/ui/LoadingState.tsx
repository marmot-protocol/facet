import { LoaderCircle } from "lucide-react";

export function LoadingState({
  label,
  fullScreen = false,
}: {
  label: string;
  fullScreen?: boolean;
}) {
  return (
    <div className={`grid place-items-center px-6 ${fullScreen ? "min-h-screen" : "min-h-52"}`}>
      <output
        className="flex max-w-xs flex-col items-center text-center"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="relative grid size-14 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
          <span className="text-[30px] leading-none" aria-hidden="true">
            💠
          </span>
          <span className="absolute -bottom-1.5 -right-1.5 grid size-6 place-items-center rounded-full border border-[var(--border)] bg-[var(--sidebar)] text-[var(--muted)]">
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              size={14}
              aria-hidden="true"
            />
          </span>
        </div>
        <strong className="mt-4 text-sm tracking-tight">Facet</strong>
        <span className="mt-1 text-xs text-[var(--muted)]">{label}</span>
      </output>
    </div>
  );
}
