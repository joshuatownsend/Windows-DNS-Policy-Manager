"use client";

import { useStore } from "@/lib/store";
import { Switch } from "@/components/ui/switch";

export function ExecutionToggle() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const executionMode = useStore((s) => s.executionMode);
  const setExecutionMode = useStore((s) => s.setExecutionMode);

  if (!bridgeConnected) return null;

  const isLive = executionMode === "execute";

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end">
        <span
          className={`text-[11px] font-semibold tracking-wider uppercase transition-colors duration-300 ${
            isLive ? "text-amber-400" : "text-muted-foreground/60"
          }`}
        >
          {isLive ? "Live" : "Dry Run"}
        </span>
        <span className="text-[10px] text-muted-foreground/50 font-mono">
          EXEC MODE
        </span>
      </div>
      <Switch
        id="exec-mode"
        checked={isLive}
        onCheckedChange={(checked) =>
          setExecutionMode(checked ? "execute" : "generate")
        }
      />
    </div>
  );
}
