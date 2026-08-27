import { type MatrixClient, UpdateDelayedEventAction } from "matrix-js-sdk";
import {
  type Capability,
  type IOpenIDUpdate,
  type IRoomEvent,
  type ISendDelayedEventDetails,
  type ISendEventDetails,
  type ITurnServer,
  OpenIDRequestState,
  type SimpleObservable,
  WidgetDriver,
} from "matrix-widget-api";

type SendStateFn = (
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
  stateKey: string,
) => Promise<{ event_id: string }>;

type SendTimelineFn = (
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
) => Promise<{ event_id: string }>;

type SendDelayedStateFn = (
  roomId: string,
  delayOpts: { delay: number },
  eventType: string,
  content: Record<string, unknown>,
  stateKey?: string,
) => Promise<{ delay_id: string }>;

type SendDelayedTimelineFn = (
  roomId: string,
  delayOpts: { delay: number },
  threadId: null,
  eventType: string,
  content: Record<string, unknown>,
) => Promise<{ delay_id: string }>;

export class KioskWidgetDriver extends WidgetDriver {
  constructor(
    private readonly client: MatrixClient,
    private readonly roomId: string,
  ) {
    super();
  }

  override async validateCapabilities(requested: Set<Capability>): Promise<Set<Capability>> {
    return requested;
  }

  override async sendEvent(
    eventType: string,
    content: unknown,
    stateKey?: string | null,
    roomId?: string | null,
  ): Promise<ISendEventDetails> {
    const rid = roomId ?? this.roomId;
    const body = content as Record<string, unknown>;
    try {
      if (stateKey !== undefined && stateKey !== null) {
        const sendState = this.client.sendStateEvent.bind(this.client) as SendStateFn;
        const r = await sendState(rid, eventType, body, stateKey);
        return { roomId: rid, eventId: r.event_id };
      }
      const send = this.client.sendEvent.bind(this.client) as SendTimelineFn;
      const r = await send(rid, eventType, body);
      return { roomId: rid, eventId: r.event_id };
    } catch (error) {
      console.error("widget sendEvent failed", eventType, stateKey ?? "", rid, error);
      throw error;
    }
  }

  override async sendDelayedEvent(
    delay: number,
    eventType: string,
    content: unknown,
    stateKey?: string | null,
    roomId?: string | null,
  ): Promise<ISendDelayedEventDetails> {
    const rid = roomId ?? this.roomId;
    const body = content as Record<string, unknown>;
    try {
      if (stateKey !== undefined && stateKey !== null) {
        const sendDelayedState = this.client._unstable_sendDelayedStateEvent.bind(
          this.client,
        ) as SendDelayedStateFn;
        const r = await sendDelayedState(rid, { delay }, eventType, body, stateKey);
        return { roomId: rid, delayId: r.delay_id };
      }
      const sendDelayed = this.client._unstable_sendDelayedEvent.bind(this.client) as SendDelayedTimelineFn;
      const r = await sendDelayed(rid, { delay }, null, eventType, body);
      return { roomId: rid, delayId: r.delay_id };
    } catch (error) {
      console.error("widget sendDelayedEvent failed", eventType, stateKey ?? "", rid, error);
      throw error;
    }
  }

  override async cancelScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.client._unstable_updateDelayedEvent(delayId, UpdateDelayedEventAction.Cancel);
  }

  override async restartScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.client._unstable_updateDelayedEvent(delayId, UpdateDelayedEventAction.Restart);
  }

  override async sendScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.client._unstable_updateDelayedEvent(delayId, UpdateDelayedEventAction.Send);
  }

  override async sendToDevice(
    eventType: string,
    encrypted: boolean,
    contentMap: { [userId: string]: { [deviceId: string]: object } },
  ): Promise<void> {
    if (encrypted) {
      await Promise.all(
        Object.entries(contentMap).flatMap(([userId, devices]) =>
          Object.entries(devices).map(async ([deviceId, payload]) => {
            const targets = await this.deviceTargets(userId, deviceId);
            if (targets.length === 0) return;
            await this.client.encryptAndSendToDevice(eventType, targets, payload as Record<string, unknown>);
          }),
        ),
      );
      return;
    }
    const batch = Object.entries(contentMap).flatMap(([userId, devices]) =>
      Object.entries(devices).map(([deviceId, payload]) => ({
        userId,
        deviceId,
        payload: payload as Record<string, unknown>,
      })),
    );
    await this.client.queueToDevice({ eventType, batch });
  }

  private async deviceTargets(
    userId: string,
    deviceId: string,
  ): Promise<Array<{ userId: string; deviceId: string }>> {
    if (deviceId !== "*") return [{ userId, deviceId }];
    const deviceMap = await this.client.getCrypto()?.getUserDeviceInfo([userId]);
    const deviceIds = deviceMap?.get(userId)?.keys() ?? [];
    return [...deviceIds].map((id) => ({ userId, deviceId: id }));
  }

  override async readStateEvents(
    eventType: string,
    stateKey: string | undefined,
    limit: number,
    roomIds?: string[] | null,
  ): Promise<IRoomEvent[]> {
    const rooms = roomIds?.length ? roomIds : [this.roomId];
    const out: IRoomEvent[] = [];
    for (const rid of rooms) {
      const room = this.client.getRoom(rid);
      if (!room) continue;
      const events =
        stateKey === undefined
          ? room.currentState.getStateEvents(eventType)
          : [room.currentState.getStateEvents(eventType, stateKey)].filter((ev) => ev !== null);
      for (const ev of events) out.push(ev.getEffectiveEvent() as IRoomEvent);
    }
    return limit > 0 ? out.slice(0, limit) : out;
  }

  override async readRoomEvents(
    eventType: string,
    msgtype: string | undefined,
    limit: number,
    roomIds?: string[] | null,
  ): Promise<IRoomEvent[]> {
    const rooms = roomIds?.length ? roomIds : [this.roomId];
    const out: IRoomEvent[] = [];
    for (const rid of rooms) {
      const room = this.client.getRoom(rid);
      if (!room) continue;
      const events = room.getLiveTimeline().getEvents();
      for (const ev of [...events].reverse()) {
        if (ev.getType() !== eventType) continue;
        if (msgtype && ev.getContent().msgtype !== msgtype) continue;
        out.push(ev.getEffectiveEvent() as IRoomEvent);
        if (limit > 0 && out.length >= limit) break;
      }
    }
    return out;
  }

  override async readStickyEvents(): Promise<IRoomEvent[]> {
    return [];
  }

  override askOpenID(observer: SimpleObservable<IOpenIDUpdate>): void {
    void this.client
      .getOpenIdToken()
      .then((token) => observer.update({ state: OpenIDRequestState.Allowed, token }))
      .catch(() => observer.update({ state: OpenIDRequestState.Blocked }));
  }

  override async *getTurnServers(): AsyncGenerator<ITurnServer> {}
}
