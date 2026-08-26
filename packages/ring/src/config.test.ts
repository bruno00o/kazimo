import { describe, expect, test } from "bun:test";
import {
  APNS_PRODUCTION_HOST,
  APNS_SANDBOX_HOST,
  loadGatewayConfig,
  parseDeployments,
  parseGatewayEnv,
  RingConfigError,
} from "./config";

const complete = {
  KAZIMO_RING_KEY_FILE: "/keys/apns.p8",
  KAZIMO_RING_KEY_ID: "KEYID12345",
  KAZIMO_RING_TEAM_ID: "TEAMID6789",
  KAZIMO_RING_BUNDLE_ID: "dev.kazimo.family",
  KAZIMO_RING_DEPLOYMENTS: "lisboa:one-secret,porto:another-secret",
};

const PEM = "-----BEGIN PRIVATE KEY-----\nMHc=\n-----END PRIVATE KEY-----\n";

describe("parseGatewayEnv", () => {
  test("reads a complete environment with its defaults", () => {
    const env = parseGatewayEnv(complete);
    expect(env.apnsHost).toBe(APNS_PRODUCTION_HOST);
    expect(env.port).toBe(8089);
    expect(env.ringsPerMinute).toBe(6);
    expect(env.lifetimeSeconds).toBe(60);
    expect(env.deployments.map((deployment) => deployment.deploymentId)).toEqual(["lisboa", "porto"]);
  });

  test("names every missing variable instead of starting half configured", () => {
    expect(() => parseGatewayEnv({})).toThrow(RingConfigError);
    try {
      parseGatewayEnv({ ...complete, KAZIMO_RING_KEY_ID: "", KAZIMO_RING_TEAM_ID: undefined });
    } catch (error) {
      expect((error as Error).message).toContain("KAZIMO_RING_KEY_ID");
      expect((error as Error).message).toContain("KAZIMO_RING_TEAM_ID");
    }
  });

  test("switches to the sandbox host on request", () => {
    expect(parseGatewayEnv({ ...complete, KAZIMO_RING_APNS_ENV: "sandbox" }).apnsHost).toBe(
      APNS_SANDBOX_HOST,
    );
    expect(parseGatewayEnv({ ...complete, KAZIMO_RING_APNS_HOST: "http://localhost:9000/" }).apnsHost).toBe(
      "http://localhost:9000",
    );
    expect(() => parseGatewayEnv({ ...complete, KAZIMO_RING_APNS_ENV: "staging" })).toThrow(RingConfigError);
  });

  test("refuses a rate or a port that is not a positive number", () => {
    expect(() => parseGatewayEnv({ ...complete, KAZIMO_RING_PORT: "zero" })).toThrow(RingConfigError);
    expect(() => parseGatewayEnv({ ...complete, KAZIMO_RING_RATE_PER_MINUTE: "0" })).toThrow(RingConfigError);
  });
});

describe("parseDeployments", () => {
  test("reads id and token pairs", () => {
    expect(parseDeployments(" lisboa:one , porto:two ")).toEqual([
      { deploymentId: "lisboa", token: "one" },
      { deploymentId: "porto", token: "two" },
    ]);
  });

  test("refuses malformed, empty and duplicated entries", () => {
    expect(() => parseDeployments("lisboa")).toThrow(RingConfigError);
    expect(() => parseDeployments(":one")).toThrow(RingConfigError);
    expect(() => parseDeployments("lisboa:")).toThrow(RingConfigError);
    expect(() => parseDeployments(" , ")).toThrow(RingConfigError);
    expect(() => parseDeployments("lisboa:one,lisboa:two")).toThrow(RingConfigError);
  });
});

describe("loadGatewayConfig", () => {
  test("loads the signing key next to the environment", async () => {
    const config = await loadGatewayConfig(complete, async () => PEM);
    expect(config.privateKeyPem).toBe(PEM);
    expect(config.bundleId).toBe("dev.kazimo.family");
  });

  test("refuses to start when the key file is missing or not a key", async () => {
    expect(
      loadGatewayConfig(complete, async () => {
        throw new Error("ENOENT");
      }),
    ).rejects.toThrow(RingConfigError);
    expect(loadGatewayConfig(complete, async () => "not a key")).rejects.toThrow(RingConfigError);
  });
});
