import type { Deployment } from "./config";

const BEARER = /^bearer\s+(\S+)$/i;

export const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] as number) ^ (b[index] as number);
  }
  return difference === 0;
};

export const digestOf = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

export const bearerOf = (header: string | null): string | null => {
  if (!header) return null;
  const match = header.match(BEARER);
  return match?.[1] ?? null;
};

export interface Authenticator {
  readonly deploymentOf: (header: string | null) => Promise<string | null>;
}

export const createAuthenticator = async (deployments: Deployment[]): Promise<Authenticator> => {
  const known = await Promise.all(
    deployments.map(async (deployment) => ({
      deploymentId: deployment.deploymentId,
      digest: await digestOf(deployment.token),
    })),
  );
  return {
    deploymentOf: async (header) => {
      const presented = bearerOf(header);
      if (!presented) return null;
      const digest = await digestOf(presented);
      let matched: string | null = null;
      for (const entry of known) {
        if (constantTimeEqual(entry.digest, digest)) matched = entry.deploymentId;
      }
      return matched;
    },
  };
};
