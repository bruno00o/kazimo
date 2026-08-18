import type { ActivitySummary, MissedCall, UnreadItem } from "@kazimo/shared";

const MAX_UNREAD = 20;
const MAX_MISSED = 10;

export const emptyActivity = (): ActivitySummary => ({ unread: [], missed: [], ringing: null });

export const withUnread = (activity: ActivitySummary, item: UnreadItem): ActivitySummary => ({
  ...activity,
  unread: [...activity.unread, item].slice(-MAX_UNREAD),
});

export const withMissed = (activity: ActivitySummary, call: MissedCall): ActivitySummary => ({
  ...activity,
  missed: [...activity.missed, call].slice(-MAX_MISSED),
});

export const withRinging = (activity: ActivitySummary, from: string | null): ActivitySummary => ({
  ...activity,
  ringing: from ? { from } : null,
});

export const withoutMissedFrom = (activity: ActivitySummary, userId: string): ActivitySummary => ({
  ...activity,
  missed: activity.missed.filter((call) => call.userId !== userId),
});

export const cleared = (activity: ActivitySummary, what: "unread" | "missed"): ActivitySummary => ({
  ...activity,
  [what]: [],
});

export interface BadgeGroup {
  name: string;
  count: number;
}

export interface Badge {
  missed: BadgeGroup[];
  unread: BadgeGroup[];
}

const grouped = (items: { from: string; timestamp: number }[]): BadgeGroup[] => {
  const groups = new Map<string, { count: number; latest: number }>();
  for (const item of items) {
    const group = groups.get(item.from) ?? { count: 0, latest: 0 };
    groups.set(item.from, { count: group.count + 1, latest: Math.max(group.latest, item.timestamp) });
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => b.latest - a.latest)
    .map(([name, { count }]) => ({ name, count }));
};

export const badgeFor = (activity: ActivitySummary | undefined): Badge | null => {
  if (!activity || (activity.unread.length === 0 && activity.missed.length === 0)) return null;
  return {
    missed: grouped(activity.missed),
    unread: grouped(activity.unread),
  };
};
