"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ExecutionToggle() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const executionMode = useStore((s) => s.executionMode);
  const setExecutionMode = useStore((s) => s.setExecutionMode);
  const activeServer = useStore((s) => s.getActiveServer());
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!bridgeConnected) return null;

  const isLive = executionMode === "execute";
  const serverName = activeServer?.name || activeServer?.hostname || "the connected server";

  function handleToggle(checked: boolean) {
    if (checked) {
      // Switching TO live mode — confirm first
      setConfirmOpen(true);
    } else {
      // Switching back to dry run — no confirmation needed
      setExecutionMode("generate");
    }
  }

  function confirmLive() {
    setExecutionMode("execute");
    setConfirmOpen(false);
  }

  return (
    <>
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
          onCheckedChange={handleToggle}
          aria-label={`Execution mode: ${isLive ? "Live — commands will execute on the server" : "Dry Run — commands are generated only"}`}
        />
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enable Live Execution?</DialogTitle>
            <DialogDescription>
              Commands will run directly on <strong className="text-foreground">{serverName}</strong>. DNS changes take effect immediately and may affect name resolution.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Stay in Dry Run
            </Button>
            <Button
              variant="destructive"
              onClick={confirmLive}
            >
              Enable Live Mode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
