import type { ClientLike } from "@unomed/react-native-matrix-sdk";

export const UNAUTHORIZED = 401;

export class UnauthorizedError extends Error {
  constructor(source: string) {
    super(`${source} unauthorized`);
    this.name = "UnauthorizedError";
  }
}

export type BearerRequest = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

export const withBearer = (request: BearerRequest, accessToken: string): RequestInit => ({
  ...request,
  headers: { ...request.headers, Authorization: `Bearer ${accessToken}` },
});

const authenticatedProbe = (client: ClientLike): Promise<unknown> =>
  client.encryption().backupExistsOnServer();

const renewAccessToken = async (client: ClientLike): Promise<void> => {
  await authenticatedProbe(client).catch(() => undefined);
};

export const authorizedFetch = async (
  client: ClientLike,
  url: string,
  request: BearerRequest = {},
): Promise<Response> => {
  const first = await fetch(url, withBearer(request, client.session().accessToken));
  if (first.status !== UNAUTHORIZED) return first;
  await renewAccessToken(client);
  return fetch(url, withBearer(request, client.session().accessToken));
};
