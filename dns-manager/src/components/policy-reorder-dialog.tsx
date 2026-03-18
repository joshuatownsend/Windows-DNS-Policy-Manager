"use client";

import { useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Policy } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowUp, ArrowDown, RefreshCw } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  ALLOW: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  DENY: "bg-red-500/15 text-red-400 border-red-500/30",
  IGNORE: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  policies: Policy[];
  zone?: string;
  onSaved: () => void;
}

export function PolicyReorderDialog({ open, onOpenChange, policies, zone, onSaved }: Props) {
  const getActiveServer = useStore((s) => s.getActiveServer);

  // Local copy sorted by current ProcessingOrder
  const [order, setOrder] = useState<Policy[]>(() =>
    [...policies].sort((a, b) => (parseInt(String(a.ProcessingOrder)) || 0) - (parseInt(String(b.ProcessingOrder)) || 0))
  );
  const [saving, setSaving] = useState(false);

  // Reset order when dialog opens with new policies
  useState(() => {
    setOrder(
      [...policies].sort((a, b) => (parseInt(String(a.ProcessingOrder)) || 0) - (parseInt(String(b.ProcessingOrder)) || 0))
    );
  });

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...order];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setOrder(next);
  };

  const moveDown = (idx: number) => {
    if (idx >= order.length - 1) return;
    const next = [...order];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setOrder(next);
  };

  const hasChanges = order.some((p, i) => {
    const original = parseInt(String(p.ProcessingOrder)) || 0;
    return original !== i + 1;
  });

  const handleSave = useCallback(async () => {
    const server = getActiveServer();
    const sp = server ? { server: server.hostname } : {};
    const serverZone = zone || undefined;

    setSaving(true);
    let ok = 0, fail = 0;

    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      const newOrder = i + 1;
      const currentOrder = parseInt(String(p.ProcessingOrder)) || 0;
      if (currentOrder === newOrder) continue; // Skip unchanged

      const enabled = String(p.IsEnabled).toLowerCase() !== "false";
      const result = await api.setPolicyState(
        p.Name,
        enabled,
        sp.server,
        serverZone,
        undefined,
        newOrder
      );
      if (result.success) ok++;
      else fail++;
    }

    setSaving(false);

    if (fail === 0) {
      toast.success(`Processing order updated (${ok} ${ok === 1 ? "policy" : "policies"} changed).`);
      onOpenChange(false);
      onSaved();
    } else {
      toast.warning(`${ok} updated, ${fail} failed.`);
      onSaved();
    }
  }, [order, zone, getActiveServer, onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Reorder Policies</DialogTitle>
          <DialogDescription>
            Policies are evaluated in processing order (lowest first). Use arrows to reorder, then save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-1 py-2">
          {order.map((p, i) => {
            const originalOrder = parseInt(String(p.ProcessingOrder)) || 0;
            const changed = originalOrder !== i + 1;
            return (
              <div
                key={p.Name}
                className={`flex items-center gap-2 p-2 rounded transition-colors ${
                  changed ? "bg-cyan-500/5 border border-cyan-500/20" : "bg-secondary/30 border border-transparent"
                }`}
              >
                {/* Order number */}
                <span className="font-mono text-xs w-6 text-center text-muted-foreground">
                  {i + 1}
                </span>

                {/* Up/Down arrows */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className="p-0.5 rounded hover:bg-secondary disabled:opacity-20 transition-colors"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => moveDown(i)}
                    disabled={i >= order.length - 1}
                    className="p-0.5 rounded hover:bg-secondary disabled:opacity-20 transition-colors"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>

                {/* Policy info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.Name}</div>
                  {p.ZoneName && (
                    <div className="text-[11px] text-muted-foreground truncate">{p.ZoneName}</div>
                  )}
                </div>

                {/* Action badge */}
                <Badge className={`text-[10px] shrink-0 ${ACTION_COLORS[String(p.Action)] || ""}`}>
                  {String(p.Action)}
                </Badge>

                {/* Changed indicator */}
                {changed && (
                  <span className="text-[10px] text-cyan font-mono shrink-0">
                    {originalOrder}→{i + 1}
                  </span>
                )}
              </div>
            );
          })}

          {order.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No policies to reorder.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? (
              <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving...</>
            ) : (
              `Save Order${hasChanges ? "" : " (no changes)"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
