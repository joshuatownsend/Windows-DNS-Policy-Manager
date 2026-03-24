"use client";

import { useStore } from "@/lib/store";

export function BridgeStatus() {
  const connected = useStore((s) => s.bridgeConnected);

  return (
    <div className="flex items-center gap-2.5" role="status" aria-live="polite" aria-label={`PowerShell bridge: ${connected ? "online" : "offline"}`}>
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${
          connected ? "bg-emerald-400" : "bg-muted-foreground/40"
        }`}
        aria-hidden="true"
      />
      <div className="flex flex-col">
        <span
          className={`text-[11px] font-semibold tracking-wider uppercase ${
            connected ? "text-emerald-400" : "text-muted-foreground/60"
          }`}
        >
          {connected ? "Online" : "Offline"}
        </span>
        <span className="text-[10px] text-muted-foreground/50 font-mono">
          BRIDGE
        </span>
      </div>
    </div>
  );
}
