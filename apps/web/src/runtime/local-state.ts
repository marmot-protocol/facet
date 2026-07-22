import { type DBSchema, type IDBPDatabase, openDB } from "idb";

interface FacetLocalSchema extends DBSchema {
  state: {
    key: string;
    value: unknown;
  };
}

export type Preferences = {
  boardId?: string;
  subjectId?: string;
  view?: "dashboard" | "matrix" | "cards";
  filters?: Record<string, string>;
  theme?: "system" | "light" | "dark";
};

export type ReconnectableSigner = "extension";

export class LocalState {
  private dbPromise: Promise<IDBPDatabase<FacetLocalSchema>>;

  constructor() {
    this.dbPromise = openDB<FacetLocalSchema>("facet-local", 1, {
      upgrade(db) {
        db.createObjectStore("state");
      },
    });
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const value = await (await this.dbPromise).get("state", key);
    return (value as T | undefined) ?? fallback;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await (await this.dbPromise).put("state", value, key);
  }

  async remove(key: string): Promise<void> {
    await (await this.dbPromise).delete("state", key);
  }

  async reconnectableSigner(): Promise<ReconnectableSigner | undefined> {
    return this.get<ReconnectableSigner | undefined>("reconnectable-signer", undefined);
  }

  async saveReconnectableSigner(signer: ReconnectableSigner): Promise<void> {
    await this.set("reconnectable-signer", signer);
  }

  async clearReconnectableSigner(): Promise<void> {
    await this.remove("reconnectable-signer");
  }

  async preferences(): Promise<Preferences> {
    return this.get("preferences", {});
  }

  async savePreferences(patch: Partial<Preferences>): Promise<Preferences> {
    const next = { ...(await this.preferences()), ...patch };
    await this.set("preferences", next);
    return next;
  }

  async followedCapabilities(): Promise<string[]> {
    return this.get("followed-capabilities", []);
  }

  async follow(capabilityId: string): Promise<void> {
    const ids = new Set(await this.followedCapabilities());
    ids.add(capabilityId);
    await this.set("followed-capabilities", [...ids]);
  }

  async readActivityIds(): Promise<string[]> {
    return this.get("read-activity", []);
  }

  async markRead(ids: string[]): Promise<void> {
    const read = new Set(await this.readActivityIds());
    for (const id of ids) read.add(id);
    await this.set("read-activity", [...read].slice(-5000));
  }

  async clear(): Promise<void> {
    await (await this.dbPromise).clear("state");
  }
}
