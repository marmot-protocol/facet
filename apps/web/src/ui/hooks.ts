import {
  type BoardProjection,
  FacetBoardModel,
  FacetBoardsModel,
  FacetDeploymentModel,
} from "@facet/protocol";
import type { Action } from "applesauce-actions";
import { useActiveAccount } from "applesauce-react/hooks/use-active-account";
import { useEventModel } from "applesauce-react/hooks/use-event-model";
import { useCallback, useState } from "react";
import { appConfig } from "../config";
import { useRuntime } from "../runtime/provider";

const projectionOptions = {
  importerPubkeys: appConfig.importerPubkeys,
  orphanedDeletionEventIds: "all" as const,
};
const AppBoardsModel = () => FacetBoardsModel(projectionOptions);
const AppBoardModel = (boardId: string) => FacetBoardModel(boardId, projectionOptions);

export function useBoards(): BoardProjection[] | undefined {
  return useEventModel(AppBoardsModel, []);
}

export function useBoard(boardId: string): BoardProjection | undefined {
  return useEventModel(AppBoardModel, [boardId]);
}

export function useSuperAdmin(): string | undefined {
  return useEventModel(FacetDeploymentModel, []);
}

export function useIdentity() {
  const account = useActiveAccount();
  return {
    account,
    pubkey: account?.pubkey,
  };
}

export function useActionExecutor() {
  const { actionRunner, status } = useRuntime();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  const run = useCallback(
    async (action: Action) => {
      if (!actionRunner) throw new Error("Connect a signer before writing.");
      if (!status.online) throw new Error("Writes are unavailable while offline.");
      setRunning(true);
      setError(undefined);
      try {
        await actionRunner.run(() => action);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        throw cause;
      } finally {
        setRunning(false);
      }
    },
    [actionRunner, status.online],
  );

  return {
    run,
    running,
    error,
    clearError: () => setError(undefined),
    canRun: Boolean(actionRunner && status.online),
  };
}
