import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Http2Server } from "node:http2";
import { transportFor } from "./apns";
import { createHttp2Client } from "./http2";

const started = new Promise<{ server: Http2Server; port: number; seen: Record<string, string>[] }>(
  (resolve) => {
    const seen: Record<string, string>[] = [];
    const server = createServer((request, response) => {
      seen.push(request.headers as Record<string, string>);
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        if (request.url === "/3/device/dead") {
          response.writeHead(410, { "content-type": "application/json" });
          response.end('{"reason":"Unregistered"}');
          return;
        }
        response.writeHead(200);
        response.end(body);
      });
    });
    server.listen(0, () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0, seen });
    });
  },
);

afterAll(async () => {
  const { server } = await started;
  server.close();
});

describe("createHttp2Client", () => {
  test("posts over http2 and reads the status and body back", async () => {
    const { port } = await started;
    const client = createHttp2Client(`http://localhost:${port}`);
    const response = await client.send(`http://localhost:${port}/3/device/alive`, {
      method: "POST",
      headers: { "apns-topic": "dev.kazimo.family.voip" },
      body: '{"v":1}',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"v":1}');
    client.close();
  });

  test("carries the apns headers on the stream", async () => {
    const { port, seen } = await started;
    const client = createHttp2Client(`http://localhost:${port}`);
    await client.send(`http://localhost:${port}/3/device/alive`, {
      method: "POST",
      headers: { "apns-push-type": "voip", "apns-priority": "10" },
      body: "{}",
    });
    const headers = seen.at(-1) as Record<string, string>;
    expect(headers["apns-push-type"]).toBe("voip");
    expect(headers[":path"]).toBe("/3/device/alive");
    expect(headers[":method"]).toBe("POST");
    client.close();
  });

  test("surfaces an apns rejection as a status, not an exception", async () => {
    const { port } = await started;
    const client = createHttp2Client(`http://localhost:${port}`);
    const response = await client.send(`http://localhost:${port}/3/device/dead`, {
      method: "POST",
      headers: {},
      body: "{}",
    });
    expect(response.status).toBe(410);
    expect(await response.text()).toBe('{"reason":"Unregistered"}');
    client.close();
  });

  test("reuses one session across pushes", async () => {
    const { port } = await started;
    const client = createHttp2Client(`http://localhost:${port}`);
    const send = () =>
      client.send(`http://localhost:${port}/3/device/alive`, { method: "POST", headers: {}, body: "{}" });
    const [first, second] = await Promise.all([send(), send()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    client.close();
  });

  test("rejects when the endpoint cannot be reached", async () => {
    const client = createHttp2Client("http://localhost:1");
    expect(
      client.send("http://localhost:1/3/device/alive", { method: "POST", headers: {}, body: "{}" }),
    ).rejects.toThrow();
  });
});

describe("transportFor", () => {
  test("falls back to fetch for a plain http stand in", async () => {
    const stand = Bun.serve({ port: 0, fetch: async (request) => new Response(await request.text()) });
    const send = transportFor(`http://localhost:${stand.port}`);
    const response = await send(`http://localhost:${stand.port}/3/device/alive`, {
      method: "POST",
      headers: {},
      body: "{}",
    });
    expect(await response.text()).toBe("{}");
    await stand.stop();
  });

  test("speaks http2 to an apns host, which plain fetch cannot", async () => {
    const { port } = await started;
    const overHttp2 = createHttp2Client(`http://localhost:${port}`);
    const response = await overHttp2.send(`http://localhost:${port}/3/device/alive`, {
      method: "POST",
      headers: {},
      body: "{}",
    });
    expect(response.status).toBe(200);
    overHttp2.close();
    expect(
      fetch(`http://localhost:${port}/3/device/alive`, { method: "POST", body: "{}" }),
    ).rejects.toThrow();
  });
});
