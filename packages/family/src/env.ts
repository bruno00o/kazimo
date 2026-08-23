export type FamilyEnv = {
  homeserver: string;
  token: string;
};

export const readEnv = (): FamilyEnv | null => {
  const homeserver = process.env.EXPO_PUBLIC_HOMESERVER;
  const token = process.env.EXPO_PUBLIC_MATRIX_TOKEN;
  if (!homeserver || !token) return null;
  return { homeserver, token };
};
