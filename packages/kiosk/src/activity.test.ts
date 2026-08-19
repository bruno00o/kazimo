import { describe, expect, test } from "bun:test";
import {
  badgeFor,
  cleared,
  emptyActivity,
  withMissed,
  withoutMissedFrom,
  withoutUnreadFrom,
  withRinging,
  withUnread,
} from "./activity";

const textFrom = (userId: string, from: string) =>
  ({ userId, from, kind: "text", body: "hello", timestamp: 1 }) as const;

describe("activity", () => {
  test("accumulates and caps unread", () => {
    let activity = emptyActivity();
    for (let i = 0; i < 25; i++) activity = withUnread(activity, textFrom("@rui", "Rui"));
    expect(activity.unread.length).toBe(20);
  });

  test("clearing one side keeps the other", () => {
    let activity = withUnread(emptyActivity(), textFrom("@rui", "Rui"));
    activity = withMissed(activity, { userId: "@maria", from: "Maria", timestamp: 2 });
    const afterUnread = cleared(activity, "unread");
    expect(afterUnread.unread.length).toBe(0);
    expect(afterUnread.missed.length).toBe(1);
  });

  test("connecting clears missed calls from that person only", () => {
    let activity = withMissed(emptyActivity(), { userId: "@maria", from: "Maria", timestamp: 1 });
    activity = withMissed(activity, { userId: "@rui", from: "Rui", timestamp: 2 });
    const after = withoutMissedFrom(activity, "@maria");
    expect(after.missed.map((c) => c.from)).toEqual(["Rui"]);
  });

  test("reading one person's messages clears their unread only", () => {
    let activity = withUnread(emptyActivity(), textFrom("@rui", "Rui"));
    activity = withUnread(activity, textFrom("@maria", "Maria"));
    const after = withoutUnreadFrom(activity, "@rui");
    expect(after.unread.map((item) => item.from)).toEqual(["Maria"]);
  });

  test("badge groups are ordered by most recent sender", () => {
    let activity = withUnread(emptyActivity(), { ...textFrom("@rui", "Rui"), timestamp: 1 });
    activity = withUnread(activity, { ...textFrom("@ana", "Ana"), timestamp: 5 });
    activity = withUnread(activity, { ...textFrom("@rui", "Rui"), timestamp: 2 });
    expect(badgeFor(activity)?.unread.map((g) => g.name)).toEqual(["Ana", "Rui"]);
  });

  test("badge groups by name with counts", () => {
    let activity = withUnread(emptyActivity(), textFrom("@rui", "Rui"));
    activity = withUnread(activity, textFrom("@rui", "Rui"));
    activity = withMissed(activity, { userId: "@maria", from: "Maria", timestamp: 3 });
    const badge = badgeFor(activity);
    expect(badge?.unread).toEqual([{ name: "Rui", count: 2 }]);
    expect(badge?.missed).toEqual([{ name: "Maria", count: 1 }]);
  });

  test("no badge when nothing pending", () => {
    expect(badgeFor(emptyActivity())).toBeNull();
    expect(badgeFor(withRinging(emptyActivity(), "Maria"))).toBeNull();
  });
});
