import type { ActionRunner } from "applesauce-actions";
import { AccountsProvider } from "applesauce-react/providers/accounts-provider";
import { ActionsProvider } from "applesauce-react/providers/actions-provider";
import { EventStoreProvider } from "applesauce-react/providers/store-provider";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { appConfig } from "../config";
import type { RuntimeStatus } from "./runtime";
import { FacetRuntime } from "./runtime";

const runtime = new FacetRuntime(appConfig);

type RuntimeContextValue = {
  runtime: FacetRuntime;
  status: RuntimeStatus;
  actionRunner?: ActionRunner;
};

const RuntimeContext = createContext<RuntimeContextValue | undefined>(undefined);

export function RuntimeProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState(runtime.status$.value);
  const [accountVersion, setAccountVersion] = useState(0);

  useEffect(() => {
    const statusSubscription = runtime.status$.subscribe(setStatus);
    const accountSubscription = runtime.accounts.active$.subscribe(() =>
      setAccountVersion((value) => value + 1),
    );
    void runtime.initialize().catch(() => undefined);
    return () => {
      statusSubscription.unsubscribe();
      accountSubscription.unsubscribe();
    };
  }, []);

  const actionRunner = useMemo(() => {
    void accountVersion;
    return runtime.createActionRunner();
  }, [accountVersion]);
  const value = useMemo(
    () => ({ runtime, status, ...(actionRunner ? { actionRunner } : {}) }),
    [status, actionRunner],
  );

  return (
    <RuntimeContext.Provider value={value}>
      <EventStoreProvider eventStore={runtime.eventStore}>
        <AccountsProvider manager={runtime.accounts}>
          <ActionsProvider {...(actionRunner ? { runner: actionRunner } : {})}>
            {children}
          </ActionsProvider>
        </AccountsProvider>
      </EventStoreProvider>
    </RuntimeContext.Provider>
  );
}

export function useRuntime(): RuntimeContextValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("useRuntime must be used inside RuntimeProvider");
  return value;
}
