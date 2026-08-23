import { describe, expect, test } from "bun:test";
import type { IStateEventWithRoomId, IStoredClientOpts, ISyncResponse } from "matrix-js-sdk";
import { createSqliteStore, databaseNameForUser, type KeyValueBackend, memoryBackend } from "./store";

const ROOM_ID = "!familia:kazimo.test";
const ME = "@avo:kazimo.test";
const RUI = "@rui:kazimo.test";
const NEXT_BATCH = "s42_transfer";
const PREV_BATCH = "t11_before";
const DB_NAME = "unused-when-a-backend-is-given";

const memberEvent = (userId: string): IStateEventWithRoomId => ({
  event_id: `$member-${userId}`,
  room_id: ROOM_ID,
  sender: userId,
  type: "m.room.member",
  state_key: userId,
  origin_server_ts: 1000,
  content: { membership: "join" },
});

const syncResponse = (nextBatch: string): ISyncResponse => ({
  next_batch: nextBatch,
  account_data: { events: [{ type: "m.push_rules", content: {} }] },
  rooms: {
    join: {
      [ROOM_ID]: {
        summary: { "m.heroes": [RUI] },
        state: { events: [memberEvent(ME), memberEvent(RUI)] },
        timeline: {
          prev_batch: PREV_BATCH,
          limited: false,
          events: [
            {
              event_id: "$one",
              room_id: ROOM_ID,
              sender: RUI,
              type: "m.room.message",
              origin_server_ts: 2000,
              content: { msgtype: "m.text", body: "bom dia" },
            },
            {
              event_id: "$two",
              room_id: ROOM_ID,
              sender: ME,
              type: "m.room.message",
              origin_server_ts: 3000,
              content: { msgtype: "m.text", body: "bom dia avo" },
            },
          ],
        },
        ephemeral: { events: [] },
        account_data: { events: [] },
        unread_notifications: { notification_count: 1 },
      },
    },
    invite: {},
    leave: {},
    knock: {},
  },
});

const startedStore = async (backend: KeyValueBackend) => {
  const store = createSqliteStore({ dbName: DB_NAME, backend });
  await store.startup();
  return store;
};

describe("databaseNameForUser", () => {
  test("keeps one database per account and strips unsafe characters", () => {
    expect(databaseNameForUser(ME)).toBe("kazimo-matrix-_avo_kazimo.test.db");
    expect(databaseNameForUser(RUI)).not.toBe(databaseNameForUser(ME));
  });
});

describe("SqliteStore", () => {
  test("a fresh store is newly created and has no saved sync", async () => {
    const store = await startedStore(memoryBackend());
    expect(await store.isNewlyCreated()).toBe(true);
    expect(await store.getSavedSync()).toBe(null);
    expect(await store.getSavedSyncToken()).toBe(null);
    expect(store.isDegraded()).toBe(false);
  });

  test("a saved sync is replayed by the next store on the same backend", async () => {
    const backend = memoryBackend();
    const first = await startedStore(backend);
    await first.setSyncData(syncResponse(NEXT_BATCH));
    await first.save(true);

    const second = await startedStore(backend);
    expect(await second.isNewlyCreated()).toBe(false);
    expect(await second.getSavedSyncToken()).toBe(NEXT_BATCH);

    const saved = await second.getSavedSync();
    expect(saved?.nextBatch).toBe(NEXT_BATCH);
    const room = saved?.roomsData.join[ROOM_ID];
    expect(room?.timeline.prev_batch).toBe(PREV_BATCH);
    expect(room?.timeline.events.map((event) => event.event_id)).toEqual(["$one", "$two"]);
    expect(room?.state?.events.map((event) => event.state_key).sort()).toEqual([ME, RUI]);
    expect(saved?.accountData.map((event) => event.type)).toEqual(["m.push_rules"]);
  });

  test("save without force respects the write delay", async () => {
    const backend = memoryBackend();
    const first = await startedStore(backend);
    await first.setSyncData(syncResponse(NEXT_BATCH));
    expect(first.wantsSave()).toBe(true);
    await first.save();
    expect(first.wantsSave()).toBe(false);

    await first.setSyncData(syncResponse("s43_later"));
    await first.save();

    const second = await startedStore(backend);
    expect(await second.getSavedSyncToken()).toBe(NEXT_BATCH);
  });

  test("deleteAllData makes the next store newly created again", async () => {
    const backend = memoryBackend();
    const first = await startedStore(backend);
    await first.setSyncData(syncResponse(NEXT_BATCH));
    await first.save(true);
    await first.deleteAllData();
    expect(await first.getSavedSync()).toBe(null);

    const second = await startedStore(backend);
    expect(await second.isNewlyCreated()).toBe(true);
    expect(await second.getSavedSync()).toBe(null);
  });

  test("client options round trip", async () => {
    const backend = memoryBackend();
    const options: IStoredClientOpts = { initialSyncLimit: 20, lazyLoadMembers: true };
    const first = await startedStore(backend);
    expect(await first.getClientOptions()).toBe(undefined);
    await first.storeClientOptions(options);

    const second = await startedStore(backend);
    expect(await second.getClientOptions()).toEqual(options);
  });

  test("out of band members round trip", async () => {
    const backend = memoryBackend();
    const members = [memberEvent(ME), memberEvent(RUI)];
    const first = await startedStore(backend);
    expect(await first.getOutOfBandMembers(ROOM_ID)).toBe(null);
    await first.setOutOfBandMembers(ROOM_ID, members);

    const second = await startedStore(backend);
    expect(await second.getOutOfBandMembers(ROOM_ID)).toEqual(members);
    await second.clearOutOfBandMembers(ROOM_ID);
    expect(await second.getOutOfBandMembers(ROOM_ID)).toBe(null);
  });

  test("an empty out of band member list is remembered as fetched", async () => {
    const backend = memoryBackend();
    const first = await startedStore(backend);
    await first.setOutOfBandMembers(ROOM_ID, []);

    const second = await startedStore(backend);
    expect(await second.getOutOfBandMembers(ROOM_ID)).toEqual([]);
  });
});
