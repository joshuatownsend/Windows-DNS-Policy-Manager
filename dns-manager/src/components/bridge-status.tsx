"use client";

import { useStore } from "@/lib/store";

export function BridgeStatus() {
  const connected = useStore((s) => s.bridgeConnected);

  return (
    <div className="flex items-center gap-3">
      {/* Indicator cluster */}
      <div className="relative flex items-center justify-center">
        {/* Outer ring */}
        <div
          className={`absolute w-5 h-5 rounded-full border transition-colors duration-500 ${
            connected
              ? "border-emerald-500/30"
              : "border-muted-foreground/15"
          }`}
        />
        {/* Inner dot */}
        <div
          className={`w-2 h-2 rounded-full transition-all duration-500 ${
            connected
              ? "bg-emerald-400 animate-beacon"
              : "bg-muted-foreground/50 animate-flatline"
          }`}
        />
      </div>

      {/* Label */}
      <div className="flex flex-col">
        <span
          className={`text-[11px] font-semibold tracking-wider uppercase transition-colors duration-500 ${
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
