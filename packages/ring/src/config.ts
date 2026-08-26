export interface Deployment {
  deploymentId: string;
  token: string;
}

export interface GatewayEnv {
  port: number;
  keyPath: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  apnsHost: string;
  deployments: Deployment[];
  ringsPerMinute: number;
  lifetimeSeconds: number;
}

export interface GatewayConfig extends Omit<GatewayEnv, "keyPath"> {
  privateKeyPem: string;
}

export const APNS_PRODUCTION_HOST = "https://api.push.apple.com";
export const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";

const DEFAULT_PORT = 8089;
const DEFAULT_RINGS_PER_MINUTE = 6;
const DEFAULT_LIFETIME_SECONDS = 60;

export class RingConfigError extends Error {}

const REQUIRED = {
  keyPath: "KAZIMO_RING_KEY_FILE",
  keyId: "KAZIMO_RING_KEY_ID",
  teamId: "KAZIMO_RING_TEAM_ID",
  bundleId: "KAZIMO_RING_BUNDLE_ID",
  deployments: "KAZIMO_RING_DEPLOYMENTS",
} as const;

type Env = Record<string, string | undefined>;

const numberOr = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new RingConfigError(`${name} must be a positive number`);
  }
  return value;
};

export const parseDeployments = (raw: string): Deployment[] => {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new RingConfigError(`${REQUIRED.deployments} is empty, expected id:token pairs`);
  }
  const deployments = entries.map((entry, index) => {
    const separator = entry.indexOf(":");
    const deploymentId = separator === -1 ? "" : entry.slice(0, separator).trim();
    const token = separator === -1 ? "" : entry.slice(separator + 1).trim();
    if (deploymentId.length === 0 || token.length === 0) {
      throw new RingConfigError(`${REQUIRED.deployments} entry ${index + 1} is not of the form id:token`);
    }
    return { deploymentId, token };
  });
  const ids = new Set(deployments.map((deployment) => deployment.deploymentId));
  if (ids.size !== deployments.length) {
    throw new RingConfigError(`${REQUIRED.deployments} contains duplicate deployment ids`);
  }
  return deployments;
};

const apnsHostOf = (env: Env): string => {
  const override = env.KAZIMO_RING_APNS_HOST?.trim();
  if (override) return override.replace(/\/$/, "");
  const environment = (env.KAZIMO_RING_APNS_ENV ?? "production").trim().toLowerCase();
  if (environment === "production") return APNS_PRODUCTION_HOST;
  if (environment === "sandbox") return APNS_SANDBOX_HOST;
  throw new RingConfigError("KAZIMO_RING_APNS_ENV must be production or sandbox");
};

export const parseGatewayEnv = (env: Env): GatewayEnv => {
  const missing = Object.values(REQUIRED).filter((name) => (env[name] ?? "").trim().length === 0);
  if (missing.length > 0) {
    throw new RingConfigError(`missing required configuration: ${missing.join(", ")}`);
  }
  return {
    port: numberOr(env.KAZIMO_RING_PORT, DEFAULT_PORT, "KAZIMO_RING_PORT"),
    keyPath: (env[REQUIRED.keyPath] as string).trim(),
    keyId: (env[REQUIRED.keyId] as string).trim(),
    teamId: (env[REQUIRED.teamId] as string).trim(),
    bundleId: (env[REQUIRED.bundleId] as string).trim(),
    apnsHost: apnsHostOf(env),
    deployments: parseDeployments(env[REQUIRED.deployments] as string),
    ringsPerMinute: numberOr(
      env.KAZIMO_RING_RATE_PER_MINUTE,
      DEFAULT_RINGS_PER_MINUTE,
      "KAZIMO_RING_RATE_PER_MINUTE",
    ),
    lifetimeSeconds: numberOr(env.KAZIMO_RING_LIFETIME, DEFAULT_LIFETIME_SECONDS, "KAZIMO_RING_LIFETIME"),
  };
};

export const loadGatewayConfig = async (
  env: Env,
  readKey: (path: string) => Promise<string>,
): Promise<GatewayConfig> => {
  const { keyPath, ...rest } = parseGatewayEnv(env);
  let privateKeyPem: string;
  try {
    privateKeyPem = await readKey(keyPath);
  } catch {
    throw new RingConfigError(`${REQUIRED.keyPath} could not be read`);
  }
  if (!privateKeyPem.includes("BEGIN PRIVATE KEY")) {
    throw new RingConfigError(`${REQUIRED.keyPath} is not a PKCS8 private key`);
  }
  return { ...rest, privateKeyPem };
};
