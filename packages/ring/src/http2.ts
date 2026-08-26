import { type ClientHttp2Session, connect, constants } from "node:http2";
import type { Transport } from "./apns";

export class Http2ResponseError extends Error {}

export interface Http2Client {
  readonly send: Transport;
  readonly close: () => void;
}

export const createHttp2Client = (origin: string): Http2Client => {
  let session: ClientHttp2Session | null = null;

  const sessionOf = (): ClientHttp2Session => {
    if (session && !session.closed && !session.destroyed) return session;
    const opened = connect(origin);
    const forget = () => {
      if (session === opened) session = null;
    };
    opened.on("error", forget);
    opened.on("close", forget);
    opened.on("goaway", forget);
    opened.unref();
    session = opened;
    return opened;
  };

  return {
    send: (url, init) =>
      new Promise<Response>((resolve, reject) => {
        const target = new URL(url);
        const request = sessionOf().request({
          ...(init.headers as Record<string, string>),
          [constants.HTTP2_HEADER_METHOD]: init.method ?? "POST",
          [constants.HTTP2_HEADER_PATH]: `${target.pathname}${target.search}`,
        });
        const abort = () => request.close(constants.NGHTTP2_CANCEL);
        const signal = init.signal ?? null;
        signal?.addEventListener("abort", abort, { once: true });
        const settle = () => signal?.removeEventListener("abort", abort);
        let status = 0;
        let body = "";
        request.setEncoding("utf8");
        request.on("response", (headers) => {
          status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
        });
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("error", (error) => {
          settle();
          reject(error);
        });
        request.on("end", () => {
          settle();
          if (status < 200) {
            reject(new Http2ResponseError("the push endpoint closed the stream without a status"));
            return;
          }
          resolve(new Response(body, { status }));
        });
        request.end(init.body as string);
      }),
    close: () => {
      session?.close();
      session = null;
    },
  };
};
