import type { ChatDriver } from "./types.js";
import { claudeDriver } from "./claude.js";
import { codexDriver } from "./codex.js";
import { openCodeDriver } from "./opencode.js";

export type { ChatDriver, ChatEvent, ChatSpawnOpts } from "./types.js";

const drivers = new Map<string, ChatDriver>([
  [claudeDriver.type, claudeDriver],
  [codexDriver.type, codexDriver],
  [openCodeDriver.type, openCodeDriver],
]);

/** Supported adapter types for chat */
export const CHAT_ADAPTER_TYPES = [
  claudeDriver.type,
  codexDriver.type,
  openCodeDriver.type,
] as const;

export function getChatDriver(type: string): ChatDriver | undefined {
  return drivers.get(type);
}

export function listChatDrivers(): ChatDriver[] {
  return Array.from(drivers.values());
}
