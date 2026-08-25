export const CONTROL_EVENT_TYPE = "dev.kazimo.control";
export const CONTACT_EVENT_TYPE = "dev.kazimo.contact";
export const FRAME_EVENT_TYPE = "dev.kazimo.frame";
export const CONTROL_ADMIN_POWER_LEVEL = 100;

export interface FrameStatusContent {
  hasAdmin?: boolean;
}

export const frameStatusOf = (content: unknown): boolean =>
  typeof content === "object" && content !== null && (content as FrameStatusContent).hasAdmin === true;

export interface ContactContent {
  name?: string;
}

export interface FrameContact {
  userId: string;
  name: string;
}

export const contactStateKeyOf = (userId: string): string => userId.replace(/^@/, "");

export const contactUserIdOf = (stateKey: string): string | null =>
  stateKey.length > 0 && !stateKey.startsWith("@") && stateKey.includes(":") ? `@${stateKey}` : null;

export const contactOf = (stateKey: string, content: unknown): FrameContact | null => {
  const userId = contactUserIdOf(stateKey);
  if (!userId) return null;
  if (typeof content !== "object" || content === null) return null;
  const name = (content as ContactContent).name;
  if (typeof name !== "string" || name.trim().length === 0) return null;
  return { userId, name: name.trim() };
};
