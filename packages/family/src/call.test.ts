import { describe, expect, test } from "bun:test";
import { leaveWhenJoinSettles } from "./call";

const deferred = () => {
  let resolve: (() => void) | null = null;
  let reject: ((error: Error) => void) | null = null;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {
    promise,
    resolve: resolve as unknown as () => void,
    reject: reject as unknown as (e: Error) => void,
  };
};

describe("leaveWhenJoinSettles", () => {
  test("holds the leave back until the join has landed", async () => {
    const join = deferred();
    const order: string[] = [];
    const settled = leaveWhenJoinSettles(join.promise, async () => {
      order.push("leave");
    });
    expect(order).toEqual([]);
    order.push("join");
    join.resolve();
    await settled;
    expect(order).toEqual(["join", "leave"]);
  });

  test("still leaves when the join failed so no membership is left behind", async () => {
    const join = deferred();
    let left = 0;
    const settled = leaveWhenJoinSettles(join.promise, async () => {
      left += 1;
    });
    join.reject(new Error("rtc membership 500"));
    await settled;
    expect(left).toBe(1);
  });

  test("swallows a failing leave instead of raising an unhandled rejection", async () => {
    const settled = leaveWhenJoinSettles(Promise.resolve(), () => Promise.reject(new Error("offline")));
    await expect(settled).resolves.toBeUndefined();
  });
});
