import { loadGatewayConfig, RingConfigError } from "./config";
import { log } from "./log";
import { NOTIFY_PATH } from "./notify";
import { createRingServer } from "./server";

const readKey = (path: string) => Bun.file(path).text();

try {
  const config = await loadGatewayConfig(process.env, readKey);
  const server = await createRingServer(config);
  log(`ringing ${config.deployments.length} deployments to ${config.apnsHost} on port ${server.port}`);
  log(`notifying messages on ${NOTIFY_PATH} for the ${config.bundleId} pusher`);
} catch (error) {
  if (error instanceof RingConfigError) {
    log(`refusing to start: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
