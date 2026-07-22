import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useRuntime } from "../runtime/provider";
import { BoardShell } from "./BoardShell";
import { useBoards } from "./hooks";
import { Onboarding } from "./Onboarding";

const ActivityPage = lazy(async () => ({
  default: (await import("./pages/ActivityPage")).ActivityPage,
}));
const AdminPage = lazy(async () => ({ default: (await import("./pages/AdminPage")).AdminPage }));
const CapabilityPage = lazy(async () => ({
  default: (await import("./pages/CapabilityPage")).CapabilityPage,
}));
const CardsPage = lazy(async () => ({ default: (await import("./pages/CardsPage")).CardsPage }));
const DashboardPage = lazy(async () => ({
  default: (await import("./pages/DashboardPage")).DashboardPage,
}));
const InboxPage = lazy(async () => ({ default: (await import("./pages/InboxPage")).InboxPage }));
const MatrixPage = lazy(async () => ({ default: (await import("./pages/MatrixPage")).MatrixPage }));

export function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/boards/:boardId" element={<BoardShell />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="matrix" element={<MatrixPage />} />
          <Route path="cards" element={<CardsPage />} />
          <Route path="capabilities/:capabilityId" element={<CapabilityPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function RouteLoading() {
  return (
    <div className="grid min-h-52 place-items-center">
      <div className="skeleton h-8 w-40" />
    </div>
  );
}

function Home() {
  const boards = useBoards();
  const { status } = useRuntime();
  if (boards === undefined && status.phase === "starting") {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="skeleton h-8 w-40" />
      </div>
    );
  }
  const first = boards?.find((board) => board.board?.value.state === "active");
  return first ? <Navigate to={`/boards/${first.boardId}/dashboard`} replace /> : <Onboarding />;
}
