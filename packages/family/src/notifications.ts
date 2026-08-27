import type { Strings } from "./i18n";

type NotificationsModule = typeof import("expo-notifications");
type NotificationSubscription = ReturnType<NotificationsModule["addNotificationResponseReceivedListener"]>;

export type MissedCallContent = {
  title: string;
  body: string;
  data: { roomId: string };
};

let pendingModule: Promise<NotificationsModule | null> | null = null;

const notifications = (): Promise<NotificationsModule | null> => {
  pendingModule ??= import("expo-notifications").catch(() => null);
  return pendingModule;
};

export const missedCallContent = (
  strings: Strings,
  callerTitle: string,
  roomId: string,
): MissedCallContent => ({
  title: strings.missedCall,
  body: callerTitle,
  data: { roomId },
});

export const roomIdOfNotificationResponse = (response: unknown): string | null => {
  const notification = (response as { notification?: unknown } | null | undefined)?.notification;
  const request = (notification as { request?: unknown } | null | undefined)?.request;
  const content = (request as { content?: unknown } | null | undefined)?.content;
  const data = (content as { data?: unknown } | null | undefined)?.data;
  const roomId = (data as { roomId?: unknown } | null | undefined)?.roomId;
  return typeof roomId === "string" && roomId ? roomId : null;
};

export const setupNotifications = (): void => {
  void notifications()
    .then((module) => {
      module?.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    })
    .catch((error) => console.log("[notify] setup failed", error));
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  const module = await notifications();
  if (!module) return false;
  try {
    const current = await module.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await module.requestPermissionsAsync();
    return asked.granted;
  } catch (error) {
    console.log("[notify] permission failed", error);
    return false;
  }
};

export const devicePushToken = async (): Promise<string | null> => {
  const module = await notifications();
  if (!module) return null;
  try {
    const token = await module.getDevicePushTokenAsync();
    return typeof token.data === "string" && token.data ? token.data : null;
  } catch (error) {
    console.log("[notify] device token failed", error);
    return null;
  }
};

export const notifyMissedCall = async (
  strings: Strings,
  call: { roomId: string; title: string },
): Promise<void> => {
  const module = await notifications();
  if (!module) return;
  try {
    await module.scheduleNotificationAsync({
      content: missedCallContent(strings, call.title, call.roomId),
      trigger: null,
    });
  } catch (error) {
    console.log("[notify] missed call failed", error);
  }
};

export const watchNotificationTaps = (onRoom: (roomId: string) => void): (() => void) => {
  let subscription: NotificationSubscription | null = null;
  let stopped = false;

  const deliver = (response: unknown) => {
    const roomId = roomIdOfNotificationResponse(response);
    if (roomId) onRoom(roomId);
  };

  void notifications()
    .then((module) => {
      if (!module || stopped) return;
      subscription = module.addNotificationResponseReceivedListener(deliver);
      void module
        .getLastNotificationResponseAsync()
        .then(deliver)
        .catch(() => undefined);
    })
    .catch((error) => console.log("[notify] taps failed", error));

  return () => {
    stopped = true;
    subscription?.remove();
    subscription = null;
  };
};
