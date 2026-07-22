import type { BoardProjection, ComparisonSubject } from "@facet/protocol";
import {
  Activity,
  Bell,
  Columns3,
  CreditCard,
  LayoutDashboard,
  Radio,
  Settings2,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { useRuntime } from "../runtime/provider";
import { ConnectDialog } from "./ConnectDialog";
import { useBoard, useBoards, useIdentity } from "./hooks";
import { permissionsFor } from "./permissions";
import { Identity, SelectInput } from "./primitives";

export type BoardOutletContext = {
  projection: BoardProjection;
  subjects: ComparisonSubject[];
  selectedSubjectId: string;
  setSelectedSubjectId: (id: string) => void;
  permissions: ReturnType<typeof permissionsFor>;
};

const navigation = [
  { to: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "matrix", label: "Matrix", icon: Columns3 },
  { to: "cards", label: "Cards", icon: CreditCard },
  { to: "activity", label: "Activity", icon: Activity },
  { to: "inbox", label: "Inbox", icon: Bell },
  { to: "admin", label: "Administration", icon: Settings2 },
];

export function BoardShell() {
  const { boardId = "" } = useParams();
  const projection = useBoard(boardId);
  const boards = useBoards() ?? [];
  const { runtime, status } = useRuntime();
  const { pubkey } = useIdentity();
  const navigate = useNavigate();
  const [connectOpen, setConnectOpen] = useState(false);
  const [selectedSubjectId, setSelectedSubjectIdState] = useState("");

  const subjects = useMemo(
    () =>
      projection
        ? [...projection.subjects.values()]
            .map(({ value }) => value)
            .filter((subject) => subject.state !== "archived")
            .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
        : [],
    [projection],
  );

  useEffect(() => {
    void runtime.localState.preferences().then((preferences) => {
      const remembered = subjects.find((subject) => subject.id === preferences.subjectId)?.id;
      setSelectedSubjectIdState(
        remembered ??
          subjects.find((subject) => subject.state === "active")?.id ??
          subjects[0]?.id ??
          "",
      );
    });
  }, [runtime, subjects]);

  if (projection === undefined)
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="skeleton h-8 w-40" />
      </div>
    );
  if (!projection.board) return <Navigate to="/" replace />;
  const permissions = permissionsFor(projection, pubkey, status.online);
  const setSelectedSubjectId = (id: string) => {
    setSelectedSubjectIdState(id);
    void runtime.localState.savePreferences({ boardId, subjectId: id });
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_minmax(0,1fr)]">
      <aside
        aria-label="Primary navigation"
        className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-[var(--border)] bg-[var(--sidebar)] px-3 md:h-screen md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-3 md:py-4"
      >
        <div className="flex shrink-0 items-center gap-2 px-2 md:mb-3">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--accent)] text-white">
            <Radio size={17} />
          </span>
          <strong className="text-[15px] tracking-tight">Facet</strong>
        </div>
        <div className="shrink-0 md:mb-3 md:px-1">
          <SelectInput
            value={boardId}
            onValueChange={(id) => navigate(`/boards/${id}/dashboard`)}
            label="Board"
            options={boards.map((board) => ({
              value: board.boardId,
              label: board.board?.value.name ?? board.boardId,
            }))}
          />
        </div>
        <nav
          className="ml-auto flex gap-1 overflow-x-auto md:ml-0 md:grid md:gap-1"
          aria-label="Board navigation"
        >
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                `flex min-h-9 items-center gap-2 rounded-md px-2.5 text-sm font-semibold no-underline ${isActive ? "bg-[var(--panel-strong)] text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:bg-[var(--panel)]"}`
              }
            >
              <Icon size={16} />
              <span className="hidden md:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-[var(--border)] pt-3 md:block">
          <div className="flex items-center gap-2 px-2 text-xs text-[var(--muted)]">
            <span
              className={`size-2 rounded-full ${status.connected ? "bg-[var(--success)]" : "bg-[var(--critical)]"}`}
            />
            {status.online
              ? status.connected
                ? "Relay connected"
                : "Relay reconnecting"
              : "Offline cache"}
          </div>
          {status.lastSync ? (
            <p className="mb-0 mt-1 px-2 text-[10px] text-[var(--faint)]">
              Last sync {new Date(status.lastSync).toLocaleTimeString()}
            </p>
          ) : null}
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-14 z-10 flex min-h-16 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[color:var(--bg)]/95 px-4 py-2 backdrop-blur md:top-0 md:px-6">
          {!status.online ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--warning-soft)] px-2 py-1 text-xs font-bold text-[var(--warning)]">
              <WifiOff size={13} /> Read-only offline
            </span>
          ) : null}
          <div className="ml-auto">
            {pubkey ? (
              <button
                type="button"
                className="button button-ghost"
                onClick={() => void runtime.disconnect()}
                title="Disconnect signer"
              >
                <Identity pubkey={pubkey} />
              </button>
            ) : (
              <button type="button" className="button" onClick={() => setConnectOpen(true)}>
                Connect signer
              </button>
            )}
          </div>
        </header>
        <main className="p-4 md:p-6">
          <Outlet
            context={
              {
                projection,
                subjects,
                selectedSubjectId,
                setSelectedSubjectId,
                permissions,
              } satisfies BoardOutletContext
            }
          />
        </main>
      </div>
      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}

export function useBoardContext(): BoardOutletContext {
  return useOutletContext<BoardOutletContext>();
}

export function ComparisonSubjectSelector({ className = "" }: { className?: string }) {
  const { subjects, selectedSubjectId, setSelectedSubjectId } = useBoardContext();
  if (!subjects.length) return null;
  return (
    <div className={`w-full sm:w-56 ${className}`}>
      <SelectInput
        value={selectedSubjectId}
        onValueChange={setSelectedSubjectId}
        label="Selected comparison subject"
        options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
      />
    </div>
  );
}
