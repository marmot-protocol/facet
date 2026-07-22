import { BOARD_EVENT_KINDS, KINDS } from "@facet/protocol";
import { AccountManager } from "applesauce-accounts";
import { AmberClipboardAccount } from "applesauce-accounts/accounts/amber-clipboard-account";
import { ExtensionAccount } from "applesauce-accounts/accounts/extension-account";
import { NostrConnectAccount } from "applesauce-accounts/accounts/nostr-connect-account";
import { ActionRunner } from "applesauce-actions";
import { EventStore } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { AuthRequiredError, type PublishResponse, RelayPool } from "applesauce-relay";
import { AmberClipboardSigner } from "applesauce-signers/signers/amber-clipboard-signer";
import { NostrConnectSigner } from "applesauce-signers/signers/nostr-connect-signer";
import { NostrIDB, openDB as openNostrDatabase } from "nostr-idb";
import { verifyEvent } from "nostr-tools";
import { BehaviorSubject, type Subscription } from "rxjs";
import type { AppConfig } from "../config";
import { observeFacetTimestamp } from "./actions";
import { LocalState } from "./local-state";

export type RuntimePhase = "starting" | "ready" | "error";

export type RuntimeStatus = {
  phase: RuntimePhase;
  online: boolean;
  connected: boolean;
  authenticated: boolean;
  authenticatedAs?: string | undefined;
  cachedEvents: number;
  lastSync?: number | undefined;
  error?: string | undefined;
};

const EVENT_FILTER = {
  kinds: [KINDS.deployment, ...BOARD_EVENT_KINDS],
};

const facetEventDatabase = await openNostrDatabase("facet-events-v1");

export class FacetRuntime {
  readonly eventStore = new EventStore({
    verifyEvent,
    keepDeleted: true,
    keepOldVersions: true,
  });
  readonly relayPool = new RelayPool({
    enablePing: true,
    subscriptionReconnect: 3,
    requestReconnect: 3,
  });
  readonly accounts = new AccountManager();
  readonly database = new NostrIDB<NostrEvent>(facetEventDatabase, {
    maxEvents: 100_000,
    cacheIndexes: 2000,
  });
  readonly localState = new LocalState();
  readonly status$ = new BehaviorSubject<RuntimeStatus>({
    phase: "starting",
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    connected: false,
    authenticated: false,
    cachedEvents: 0,
  });
  readonly relay;

  private subscriptions: Subscription[] = [];
  private initialized = false;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.relay = this.relayPool.relay(config.relayUrl);
    NostrConnectSigner.pool = {
      subscription: (relays, filters) => this.relayPool.subscription(relays, filters),
      publish: (relays, event) => this.relayPool.publish(relays, event),
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      await this.database.start();
      const cached = await this.database.query(EVENT_FILTER);
      for (const event of cached) {
        observeFacetTimestamp(event.created_at);
        this.eventStore.add(event);
      }
      this.patchStatus({ cachedEvents: cached.length });

      this.subscriptions.push(
        this.eventStore.insert$.subscribe((event) => {
          void this.database.add(event);
        }),
      );

      createEventLoaderForStore(this.eventStore, this.relayPool, {
        bufferTime: 100,
        followRelayHints: false,
        extraRelays: [this.config.relayUrl],
        lookupRelays: this.config.profileRelays,
        cacheRequest: (filters) => this.database.query(filters),
      });

      this.subscriptions.push(
        this.relay.status$.subscribe((status) => {
          this.patchStatus({
            connected: status.connected,
            authenticated: status.authenticated,
            ...(status.authenticatedAs ? { authenticatedAs: status.authenticatedAs } : {}),
          });
        }),
        this.relay.subscription(EVENT_FILTER, { reconnect: true, resubscribe: true }).subscribe({
          next: (value) => {
            if (value === "EOSE") {
              const lastSync = Date.now();
              this.patchStatus({ lastSync });
              void this.localState.set("last-sync", lastSync);
              return;
            }
            observeFacetTimestamp(value.created_at);
            this.eventStore.add(value, this.config.relayUrl);
          },
          error: (error) => this.patchStatus({ error: readableError(error) }),
        }),
      );

      if (typeof window !== "undefined") {
        const online = () => this.patchStatus({ online: true });
        const offline = () => this.patchStatus({ online: false });
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
      }
      const lastSync = await this.localState.get<number | undefined>("last-sync", undefined);
      this.patchStatus({ phase: "ready", ...(lastSync ? { lastSync } : {}) });
      if ((await this.localState.reconnectableSigner()) === "extension") {
        void this.restoreExtensionAccount();
      }
    } catch (error) {
      this.patchStatus({ phase: "error", error: readableError(error) });
      throw error;
    }
  }

  createActionRunner(): ActionRunner | undefined {
    const account = this.accounts.active;
    if (!account) return undefined;
    const runner = new ActionRunner(this.eventStore, account, async (event) => {
      await this.publishAccepted(event);
    });
    runner.saveToStore = false;
    return runner;
  }

  async connectExtension(): Promise<void> {
    const account = await ExtensionAccount.fromExtension();
    await this.activateAccount(account);
    await this.localState.saveReconnectableSigner("extension");
  }

  async connectBunker(uri: string): Promise<void> {
    const permissions = NostrConnectSigner.buildSigningPermissions([
      KINDS.deployment,
      ...BOARD_EVENT_KINDS,
      KINDS.relayAuth,
    ]);
    const signer = await NostrConnectSigner.fromBunkerURI(uri, { permissions });
    const pubkey = await signer.getPublicKey();
    await this.activateAccount(new NostrConnectAccount(pubkey, signer));
  }

  async connectAmber(): Promise<void> {
    const signer = new AmberClipboardSigner();
    const pubkey = await signer.getPublicKey();
    await this.activateAccount(new AmberClipboardAccount(pubkey, signer));
  }

  async disconnect(): Promise<void> {
    const account = this.accounts.active;
    this.accounts.clearActive();
    await this.localState.clearReconnectableSigner();
    if (account instanceof NostrConnectAccount)
      await account.signer.logout().catch(() => undefined);
    if (account instanceof AmberClipboardAccount) account.signer.destroy();
    if (account) this.accounts.removeAccount(account);
    this.patchStatus({ authenticated: false, authenticatedAs: undefined });
    if (typeof window !== "undefined" && this.relay.authenticatedAs) window.location.reload();
  }

  async authenticate(): Promise<void> {
    const account = this.accounts.active;
    if (!account) throw new Error("Connect a signer before authenticating.");
    const response = await this.relay.authenticate(account);
    if (!response.ok) throw new Error(response.message || "Relay authentication failed.");
  }

  async clearLocalData(): Promise<void> {
    await Promise.all([this.database.deleteAllEvents(), this.localState.clear()]);
    if (typeof window !== "undefined") window.location.reload();
  }

  async publishAccepted(event: NostrEvent): Promise<void> {
    if (!this.status$.value.online) throw new Error("Writes are unavailable while offline.");
    const account = this.accounts.active;
    if (!account) throw new Error("Connect a signer before writing.");
    let response: PublishResponse;
    try {
      response = await this.relay.publish(event, { retries: 0, timeout: 30_000 });
    } catch (error) {
      if (!(error instanceof AuthRequiredError)) throw error;
      await this.authenticate();
      response = await this.relay.publish(event, { retries: 2, timeout: 30_000 });
    }
    if (!response.ok) throw new Error(response.message || "The relay rejected this event.");
    observeFacetTimestamp(event.created_at);
    this.eventStore.add(event, this.config.relayUrl);
    await this.database.add(event);
  }

  async dispose(): Promise<void> {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.eventStore.dispose();
    this.relayPool.close();
    await this.database.stop();
  }

  private async activateAccount(
    account: ExtensionAccount | NostrConnectAccount | AmberClipboardAccount,
  ): Promise<void> {
    // Applesauce's published account types predate exactOptionalPropertyTypes and are structurally
    // compatible at runtime despite the optional encryption helper declaration mismatch.
    this.accounts.addAccount(account as any);
    this.accounts.setActive(account as any);
  }

  private async restoreExtensionAccount(): Promise<void> {
    try {
      const account = await ExtensionAccount.fromExtension();
      await this.activateAccount(account);
    } catch {
      // The extension may be disabled, locked, or injected after startup. Keep the harmless
      // preference so a later reload can try again; manual connection remains available.
    }
  }

  private patchStatus(patch: Partial<RuntimeStatus>): void {
    const next = { ...this.status$.value, ...patch };
    if (patch.authenticatedAs === undefined && "authenticatedAs" in patch)
      delete next.authenticatedAs;
    if (patch.error === undefined && "error" in patch) delete next.error;
    this.status$.next(next);
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
