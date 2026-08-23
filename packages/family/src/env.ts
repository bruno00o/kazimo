export type FamilyEnv = {
  homeserver: string;
  token: string;
};

const blankToNull = (value: string | undefined): string | null => (value ? value : null);

export const readHomeserver = (): string | null => blankToNull(process.env.EXPO_PUBLIC_HOMESERVER);

export const readOidcClientId = (): string | null => blankToNull(process.env.EXPO_PUBLIC_OIDC_CLIENT_ID);

export const readEnv = (): FamilyEnv | null => {
  const homeserver = readHomeserver();
  const token = blankToNull(process.env.EXPO_PUBLIC_MATRIX_TOKEN);
  if (!homeserver || !token) return null;
  return { homeserver, token };
};
