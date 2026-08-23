import type { SQLiteDatabase } from "expo-sqlite";
import {
  type IStateEventWithRoomId,
  type IStoredClientOpts,
  type ISyncData,
  type ISyncResponse,
  MemoryStore,
  SyncAccumulator,
} from "matrix-js-sdk";

export type KeyValueBackend = {
  open(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
};

const SCHEMA_VERSION = "1";
const SCHEMA_VERSION_KEY = "schemaVersion";
const SYNC_KEY = "sync";
const CLIENT_OPTIONS_KEY = "clientOptions";
const OUT_OF_BAND_MEMBERS_KEY_PREFIX = "outOfBandMembers:";
const WRITE_DELAY_MS = 5 * 60 * 1000;

const DATABASE_NAME_PREFIX = "kazimo-matrix-";
const DATABASE_NAME_SUFFIX = ".db";
const UNSAFE_DATABASE_NAME_CHARACTERS = /[^a-zA-Z0-9._-]/g;
const DATABASE_NAME_REPLACEMENT = "_";

const CREATE_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`;
const SELECT_VALUE_SQL = "SELECT value FROM kv WHERE key = ?";
const UPSERT_VALUE_SQL = "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?";
const DELETE_VALUE_SQL = "DELETE FROM kv WHERE key = ?";
const DELETE_ALL_VALUES_SQL = "DELETE FROM kv";

const DEGRADED_MESSAGE = "SqliteStore falling back to memory only";

export const databaseNameForUser = (userId: string): string =>
  `${DATABASE_NAME_PREFIX}${userId.replace(UNSAFE_DATABASE_NAME_CHARACTERS, DATABASE_NAME_REPLACEMENT)}${DATABASE_NAME_SUFFIX}`;

const outOfBandMembersKey = (roomId: string): string => `${OUT_OF_BAND_MEMBERS_KEY_PREFIX}${roomId}`;

const parseJson = <T>(serialized: string): T | null => {
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return null;
  }
};

export const memoryBackend = (): KeyValueBackend => {
  const entries = new Map<string, string>();
  return {
    open: () => Promise.resolve(),
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      entries.clear();
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
};

export const expoSqliteBackend = (dbName: string): KeyValueBackend => {
  let database: SQLiteDatabase | null = null;

  const opened = (): SQLiteDatabase => {
    if (!database) throw new Error(`sqlite store ${dbName} is not open`);
    return database;
  };

  return {
    open: async () => {
      if (database) return;
      const { openDatabaseAsync } = await import("expo-sqlite");
      const connection = await openDatabaseAsync(dbName);
      await connection.execAsync(CREATE_SCHEMA_SQL);
      database = connection;
    },
    get: async (key) => {
      const row = await opened().getFirstAsync<{ value: string }>(SELECT_VALUE_SQL, key);
      return row?.value ?? null;
    },
    set: async (key, value) => {
      await opened().runAsync(UPSERT_VALUE_SQL, key, value, value);
    },
    delete: async (key) => {
      await opened().runAsync(DELETE_VALUE_SQL, key);
    },
    clear: async () => {
      await opened().runAsync(DELETE_ALL_VALUES_SQL);
    },
    close: async () => {
      const connection = database;
      database = null;
      await connection?.closeAsync();
    },
  };
};

export class SqliteStore extends MemoryStore {
  private syncAccumulator = new SyncAccumulator();
  private newlyCreated = true;
  private startupPromise: Promise<void> | null = null;
  private degraded = false;
  private lastSaveTs = 0;
  private saveInFlight: Promise<void> | null = null;

  public constructor(private readonly backend: KeyValueBackend) {
    super();
  }

  public startup(): Promise<void> {
    this.startupPromise ??= this.load();
    return this.startupPromise;
  }

  private async load(): Promise<void> {
    try {
      await this.backend.open();
      const schemaVersion = await this.backend.get(SCHEMA_VERSION_KEY);
      this.newlyCreated = schemaVersion !== SCHEMA_VERSION;
      if (this.newlyCreated) {
        await this.backend.clear();
        await this.backend.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
        return;
      }
      const saved = await this.readSyncData();
      if (!saved?.nextBatch) return;
      this.syncAccumulator.accumulate(
        {
          next_batch: saved.nextBatch,
          rooms: saved.roomsData,
          account_data: { events: saved.accountData ?? [] },
        },
        true,
      );
    } catch (error) {
      this.degrade(error);
    }
  }

  public isNewlyCreated(): Promise<boolean> {
    return Promise.resolve(this.newlyCreated);
  }

  public isDegraded(): boolean {
    return this.degraded;
  }

  public getSavedSync(): Promise<ISyncData | null> {
    const data = this.syncAccumulator.getJSON();
    if (!data.nextBatch) return Promise.resolve(null);
    return Promise.resolve(JSON.parse(JSON.stringify(data)) as ISyncData);
  }

  public getSavedSyncToken(): Promise<string | null> {
    return Promise.resolve(this.syncAccumulator.getJSON().nextBatch || null);
  }

  public setSyncData(syncData: ISyncResponse): Promise<void> {
    this.syncAccumulator.accumulate(syncData);
    return Promise.resolve();
  }

  public wantsSave(): boolean {
    return Date.now() - this.lastSaveTs > WRITE_DELAY_MS;
  }

  public save(force = false): Promise<void> {
    if (!force && !this.wantsSave()) return Promise.resolve();
    if (this.saveInFlight) return this.saveInFlight;
    this.lastSaveTs = Date.now();
    this.saveInFlight = this.persistSyncData().finally(() => {
      this.saveInFlight = null;
    });
    return this.saveInFlight;
  }

  public async deleteAllData(): Promise<void> {
    await super.deleteAllData();
    this.syncAccumulator = new SyncAccumulator();
    this.newlyCreated = true;
    this.lastSaveTs = 0;
    if (this.degraded) return;
    try {
      await this.backend.clear();
    } catch (error) {
      this.degrade(error);
    }
  }

  public async getOutOfBandMembers(roomId: string): Promise<IStateEventWithRoomId[] | null> {
    if (this.degraded) return super.getOutOfBandMembers(roomId);
    try {
      const serialized = await this.backend.get(outOfBandMembersKey(roomId));
      if (!serialized) return null;
      return parseJson<IStateEventWithRoomId[]>(serialized);
    } catch (error) {
      this.degrade(error);
      return super.getOutOfBandMembers(roomId);
    }
  }

  public async setOutOfBandMembers(roomId: string, membershipEvents: IStateEventWithRoomId[]): Promise<void> {
    await super.setOutOfBandMembers(roomId, membershipEvents);
    if (this.degraded) return;
    try {
      await this.backend.set(outOfBandMembersKey(roomId), JSON.stringify(membershipEvents));
    } catch (error) {
      this.degrade(error);
    }
  }

  public async clearOutOfBandMembers(roomId: string): Promise<void> {
    await super.clearOutOfBandMembers(roomId);
    if (this.degraded) return;
    try {
      await this.backend.delete(outOfBandMembersKey(roomId));
    } catch (error) {
      this.degrade(error);
    }
  }

  public async getClientOptions(): Promise<IStoredClientOpts | undefined> {
    if (this.degraded) return super.getClientOptions();
    try {
      const serialized = await this.backend.get(CLIENT_OPTIONS_KEY);
      if (!serialized) return undefined;
      return parseJson<IStoredClientOpts>(serialized) ?? undefined;
    } catch (error) {
      this.degrade(error);
      return super.getClientOptions();
    }
  }

  public async storeClientOptions(options: IStoredClientOpts): Promise<void> {
    await super.storeClientOptions(options);
    if (this.degraded) return;
    try {
      await this.backend.set(CLIENT_OPTIONS_KEY, JSON.stringify(options));
    } catch (error) {
      this.degrade(error);
    }
  }

  public async removeEventsFromRoom(roomId: string, eventIds: string[]): Promise<void> {
    try {
      this.syncAccumulator.removeEventsFromRoom(roomId, eventIds);
    } catch {
      return;
    }
    await this.persistSyncData();
  }

  public async destroy(): Promise<void> {
    try {
      await this.backend.close();
    } catch (error) {
      this.degrade(error);
    }
  }

  private async readSyncData(): Promise<ISyncData | null> {
    const serialized = await this.backend.get(SYNC_KEY);
    if (!serialized) return null;
    return parseJson<ISyncData>(serialized);
  }

  private async persistSyncData(): Promise<void> {
    if (this.degraded) return;
    const syncData = this.syncAccumulator.getJSON(true);
    if (!syncData.nextBatch) return;
    try {
      await this.backend.set(SYNC_KEY, JSON.stringify(syncData));
    } catch (error) {
      this.degrade(error);
    }
  }

  private degrade(error: unknown): void {
    this.degraded = true;
    console.warn(DEGRADED_MESSAGE, error);
  }
}

export type SqliteStoreOptions = {
  dbName: string;
  backend?: KeyValueBackend;
};

export const createSqliteStore = ({ dbName, backend }: SqliteStoreOptions): SqliteStore =>
  new SqliteStore(backend ?? expoSqliteBackend(dbName));
