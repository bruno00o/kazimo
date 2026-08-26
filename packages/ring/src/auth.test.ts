import { describe, expect, test } from "bun:test";
import { bearerOf, constantTimeEqual, createAuthenticator, digestOf } from "./auth";

const deployments = [
  { deploymentId: "lisboa", token: "aaaaaaaaaaaaaaaaaaaaaaaa" },
  { deploymentId: "porto", token: "bbbbbbbbbbbbbbbbbbbbbbbb" },
];

describe("constantTimeEqual", () => {
  test("matches identical digests", async () => {
    expect(constantTimeEqual(await digestOf("same"), await digestOf("same"))).toBe(true);
  });

  test("rejects digests that differ in a single byte", async () => {
    expect(constantTimeEqual(await digestOf("same"), await digestOf("samf"))).toBe(false);
  });

  test("rejects buffers of different lengths", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  test("compares every byte whatever the first difference", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, new Uint8Array([9, 2, 3, 4]))).toBe(false);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3, 9]))).toBe(false);
  });
});

describe("bearerOf", () => {
  test("reads the token whatever the case of the scheme", () => {
    expect(bearerOf("Bearer abc")).toBe("abc");
    expect(bearerOf("bearer abc")).toBe("abc");
  });

  test("ignores other schemes and empty headers", () => {
    expect(bearerOf("Basic abc")).toBeNull();
    expect(bearerOf("Bearer")).toBeNull();
    expect(bearerOf(null)).toBeNull();
  });
});

describe("createAuthenticator", () => {
  test("resolves the deployment behind a known token", async () => {
    const auth = await createAuthenticator(deployments);
    expect(await auth.deploymentOf(`Bearer ${deployments[1]?.token}`)).toBe("porto");
  });

  test("refuses an unknown token, a missing header and an empty token", async () => {
    const auth = await createAuthenticator(deployments);
    expect(await auth.deploymentOf("Bearer nope")).toBeNull();
    expect(await auth.deploymentOf(null)).toBeNull();
    expect(await auth.deploymentOf("Bearer ")).toBeNull();
  });

  test("refuses a prefix of a known token", async () => {
    const auth = await createAuthenticator(deployments);
    expect(await auth.deploymentOf("Bearer aaaaaaaaaaa")).toBeNull();
  });
});
