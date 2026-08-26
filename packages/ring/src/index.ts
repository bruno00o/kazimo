import { loadGatewayConfig, RingConfigError } from "./config";
import { createRingServer, log } from "./server";

const readKey = (path: string) => Bun.file(path).text();

try {
  const config = await loadGatewayConfig(process.env, readKey);
  const server = await createRingServer(config);
  log(`ringing ${config.deployments.length} deployments to ${config.apnsHost} on port ${server.port}`);
} catch (error) {
  if (error instanceof RingConfigError) {
    log(`refusing to start: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
