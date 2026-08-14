import {
  ClientEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from "matrix-js-sdk";
import {
  ClientWidgetApi,
  type IRoomEvent,
  type IWidgetApiRequest,
  Widget,
  type WidgetApiToWidgetAction,
} from "matrix-widget-api";
import { KioskWidgetDriver } from "./driver";

export interface CallHostConfig {
  userId: string;
  deviceId: string;
  homeserverUrl: string;
  lang: string;
}

const ACK_ACTIONS = ["io.element.device_mute", "io.element.tile_layout", "io.element.join"];

export const RTC_MEMBER_TYPES = new Set([
  "org.matrix.msc3401.call.member",
  "m.rtc.member",
  "io.element.rtc.member",
]);

export class CallHost {
  private api: ClientWidgetApi | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private teardown: Array<() => void> = [];

  constructor(
    private readonly client: MatrixClient,
    private readonly config: CallHostConfig,
  ) {}

  get active(): boolean {
    return this.api !== null;
  }

  mount(roomId: string, container: HTMLElement, onEnded: () => void): void {
    if (this.api) return;

    const iframe = document.createElement("iframe");
    iframe.allow = "camera; microphone; autoplay; display-capture; clipboard-write;";
    iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;";
    iframe.src = this.callUrl(roomId);
    container.appendChild(iframe);
    this.iframe = iframe;

    const widget = new Widget({
      id: "kazimo-call",
      creatorUserId: this.config.userId,
      type: "m.custom",
      url: iframe.src,
      waitForIframeLoad: false,
    });
    const api = new ClientWidgetApi(widget, iframe, new KioskWidgetDriver(this.client, roomId));
    api.setViewedRoomId(roomId);
    this.api = api;

    for (const action of ACK_ACTIONS) {
      api.on(`action:${action}`, (ev: CustomEvent<IWidgetApiRequest>) => {
        ev.preventDefault();
        api.transport.reply(ev.detail, {});
      });
    }

    for (const action of ["im.vector.hangup", "io.element.close"]) {
      api.on(`action:${action}`, (ev: CustomEvent<IWidgetApiRequest>) => {
        ev.preventDefault();
        api.transport.reply(ev.detail, {});
        this.unmount();
        onEnded();
      });
    }

    const onTimeline = (event: MatrixEvent, eventRoom?: Room) => {
      if (eventRoom?.roomId !== roomId) return;
      void this.client
        .decryptEventIfNeeded(event)
        .then(() => api.feedEvent(event.getEffectiveEvent() as unknown as IRoomEvent, roomId))
        .catch(() => {});
    };
    this.client.on(RoomEvent.Timeline, onTimeline);
    this.teardown.push(() => this.client.removeListener(RoomEvent.Timeline, onTimeline));

    const onStateEvent = (event: MatrixEvent) => {
      if (event.getRoomId() !== roomId || event.getStateKey() === undefined) return;
      void api.feedStateUpdate(event.getEffectiveEvent() as unknown as IRoomEvent).catch(() => {});
    };
    this.client.on(RoomStateEvent.Events, onStateEvent);
    this.teardown.push(() => this.client.removeListener(RoomStateEvent.Events, onStateEvent));

    const onToDevice = (event: MatrixEvent) => {
      void api
        .feedToDevice(event.getEffectiveEvent() as unknown as IRoomEvent, event.isEncrypted())
        .catch((error) => console.error("feedToDevice failed", error));
    };
    this.client.on(ClientEvent.ToDeviceEvent, onToDevice);
    this.teardown.push(() => this.client.removeListener(ClientEvent.ToDeviceEvent, onToDevice));

    let unmuted = false;
    const onOwnMembership = (event: MatrixEvent) => {
      if (unmuted || event.getRoomId() !== roomId) return;
      if (!RTC_MEMBER_TYPES.has(event.getType())) return;
      if (event.getSender() !== this.config.userId) return;
      if (Object.keys(event.getContent()).length === 0) return;
      unmuted = true;
      void api.transport
        .send("io.element.device_mute" as WidgetApiToWidgetAction, {
          audio_enabled: true,
          video_enabled: true,
        })
        .catch(() => {});
    };
    this.client.on(RoomStateEvent.Events, onOwnMembership);
    this.teardown.push(() => this.client.removeListener(RoomStateEvent.Events, onOwnMembership));
  }

  async hangup(): Promise<void> {
    const api = this.api;
    if (!api) return;
    try {
      await api.transport.send("im.vector.hangup" as WidgetApiToWidgetAction, {});
    } catch {
      this.unmount();
    }
  }

  private unmount(): void {
    for (const cleanup of this.teardown) cleanup();
    this.teardown = [];
    this.iframe?.remove();
    this.iframe = null;
    this.api = null;
  }

  private callUrl(roomId: string): string {
    const encrypted = this.client.getRoom(roomId)?.hasEncryptionStateEvent() ?? false;
    const params = new URLSearchParams({
      widgetId: "kazimo-call",
      parentUrl: `${window.location.origin}/`,
      userId: this.config.userId,
      deviceId: this.config.deviceId,
      roomId,
      baseUrl: this.config.homeserverUrl,
      intent: "join_existing_dm",
      header: "none",
      showControls: "false",
      hideScreensharing: "true",
      confineToRoom: "true",
      perParticipantE2EE: String(encrypted),
      lang: this.config.lang,
    });
    return `/call/index.html?${params.toString()}`;
  }
}
