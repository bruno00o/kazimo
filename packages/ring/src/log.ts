export const log = (message: string): void =>
  console.log(`[kazimo-ring] ${new Date().toISOString()} ${message}`);
