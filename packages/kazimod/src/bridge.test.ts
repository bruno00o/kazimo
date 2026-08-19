import { describe, expect, test } from "bun:test";
import type { DaemonToKiosk } from "@kazimo/shared";
import { Effect } from "effect";
import { KioskBridge, type KioskBridgeApi } from "./bridge";

const makeBridge = () =>
  Effect.runPromise(KioskBridge.use(Effect.succeed).pipe(Effect.provide(KioskBridge.layer)));

describe("KioskBridge.request", () => {
  test("resolves with the kiosk reply matching the request id", async () => {
    const bridge: KioskBridgeApi = await makeBridge();
    const sent: DaemonToKiosk[] = [];
    bridge.setSink((message) => sent.push(message));
    const pending = bridge.request((id) => ({ type: "history-request", id, roomId: "!r", limit: 5 }));
    const request = sent[0];
    if (request?.type !== "history-request") throw new Error("no request sent");
    bridge.resolveRequest({ type: "history", id: request.id, messages: [] });
    const reply = await pending;
    expect(reply?.type).toBe("history");
  });

  test("resolves null when the kiosk never replies", async () => {
    const bridge = await makeBridge();
    bridge.setSink(() => {});
    const reply = await bridge.request((id) => ({ type: "show-photos", id, userId: null }), 20);
    expect(reply).toBeNull();
  });

  test("resolves null immediately without a connected kiosk", async () => {
    const bridge = await makeBridge();
    const reply = await bridge.request((id) => ({ type: "show-photos", id, userId: null }));
    expect(reply).toBeNull();
  });

  test("ignores a reply for an unknown id", async () => {
    const bridge = await makeBridge();
    bridge.resolveRequest({ type: "history", id: 999, messages: [] });
  });
});
