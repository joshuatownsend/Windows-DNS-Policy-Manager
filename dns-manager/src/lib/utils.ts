import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { useStore } from "./store"
import type { Server } from "./types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Server param shape returned by getServerParams helpers */
export type ServerParams = { server?: string; serverId?: string; credentialMode?: string };

/** Get server/credential params for the active server (non-React context) */
export function getServerParams(): ServerParams {
  const s = useStore.getState().getActiveServer();
  if (!s) return {};
  return { server: s.hostname, serverId: s.id, credentialMode: s.credentialMode };
}

/** Get server/credential params for a specific server */
export function getServerParamsFor(server: Server): ServerParams {
  return { server: server.hostname, serverId: server.id, credentialMode: server.credentialMode };
}

/** Download data as a JSON file */
export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
