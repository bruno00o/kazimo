import {
  parseRingRequest,
  RING_PATH,
  type RingErrorCode,
  type RingErrorResponse,
  type RingResponse,
} from "@kazimo/shared";
import { apnsTopic, createPusher, type Pusher } from "./apns";
import { type Authenticator, createAuthenticator } from "./auth";
import type { GatewayConfig } from "./config";
import { createJwtProvider, importSigningKey } from "./jwt";
import { createRateLimiter, type RateLimiter } from "./limit";

const MAX_BODY_BYTES = 4096;

export const log = (message: string): void =>
  console.log(`[kazimo-ring] ${new Date().toISOString()} ${message}`);

export interface RingHandlerDeps {
  auth: Authenticator;
  limiter: RateLimiter;
  pusher: Pusher;
  lifetimeSeconds: number;
  now?: () => number;
  onLog?: (message: string) => void;
}

const fail = (status: number, error: RingErrorCode): Response =>
  Response.json({ error } satisfies RingErrorResponse, { status });

const tooLarge = (request: Request): boolean => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
};

export const handleRing = async (request: Request, deps: RingHandlerDeps): Promise<Response> => {
  const now = deps.now ?? Date.now;
  const write = deps.onLog ?? log;
  const deploymentId = await deps.auth.deploymentOf(request.headers.get("authorization"));
  if (!deploymentId) return fail(401, "unauthorized");
  if (tooLarge(request)) return fail(400, "invalid_request");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_request");
  }
  const ring = parseRingRequest(body);
  if (!ring) {
    write(`rejected a malformed ring from ${deploymentId}`);
    return fail(400, "invalid_request");
  }
  if (!deps.limiter.allow(deploymentId, now())) {
    write(`rate limited ${deploymentId}`);
    return fail(429, "rate_limited");
  }

  const expiresAt = Math.floor(now() / 1000) + deps.lifetimeSeconds;
  let results: RingResponse["results"];
  try {
    results = await deps.pusher.push(ring, expiresAt);
  } catch (error) {
    write(`push unavailable for ${deploymentId}: ${error instanceof Error ? error.message : "unknown"}`);
    return fail(503, "push_unavailable");
  }

  const delivered = results.filter((result) => result.ok).length;
  const stale = results.filter((result) => result.stale).length;
  write(
    `ring ${ring.callId} from ${deploymentId}: ${delivered}/${results.length} delivered` +
      (stale > 0 ? `, ${stale} stale` : ""),
  );
  return Response.json({ callId: ring.callId, results } satisfies RingResponse);
};

export const createRingServer = async (config: GatewayConfig) => {
  const key = await importSigningKey(config.privateKeyPem);
  const deps: RingHandlerDeps = {
    auth: await createAuthenticator(config.deployments),
    limiter: createRateLimiter(config.ringsPerMinute),
    pusher: createPusher({
      host: config.apnsHost,
      topic: apnsTopic(config.bundleId),
      jwt: createJwtProvider(key, config.keyId, config.teamId),
    }),
    lifetimeSeconds: config.lifetimeSeconds,
  };

  return Bun.serve({
    port: config.port,
    routes: {
      "/health": new Response("ok"),
      [RING_PATH]: {
        POST: (request: Request) => handleRing(request, deps),
      },
    },
    fetch: () => new Response("not found", { status: 404 }),
  });
};
