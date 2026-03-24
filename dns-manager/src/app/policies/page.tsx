"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Policy } from "@/lib/types";
import { toast } from "sonner";
import { PolicyReorderDialog } from "@/components/policy-reorder-dialog";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
// Select components removed (unused after refactor)
import {
  RefreshCwIcon,
  Trash2Icon,
  ShieldIcon,
  AlertTriangleIcon,
} from "lucide-react";

function getServerParams() {
  const server = useStore.getState().getActiveServer();
  if (!server) return {};
  return {
    server: server.hostname,
    serverId: server.id,
    credentialMode: server.credentialMode,
  };
}

function actionColor(action?: string) {
  switch (action?.toUpperCase()) {
    case "ALLOW":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "DENY":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "IGNORE":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    default:
      return "";
  }
}

interface PolicyCardProps {
  policy: Policy;
  policyType: "standard" | "zoneTransfer";
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
  toggling: string | null;
}

function PolicyCard({
  policy,
  policyType,
  onToggle,
  onDelete,
  toggling,
}: PolicyCardProps) {
  const isEnabled = policy.IsEnabled === "True" || policy.IsEnabled === "true";
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground truncate">
                {policy.Name}
              </span>
              {policyType === "zoneTransfer" && (
                <Badge variant="outline" className="text-[10px]">
                  Zone Transfer
                </Badge>
              )}
            </div>
            {policy.ZoneName && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Zone: {policy.ZoneName}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {policy.ProcessingOrder && (
              <Badge variant="outline" className="tabular-nums">
                #{policy.ProcessingOrder}
              </Badge>
            )}
            {policy.Action && (
              <Badge
                variant="outline"
                className={actionColor(policy.Action)}
              >
                {policy.Action}
              </Badge>
            )}
            {policy.Level && (
              <Badge variant="secondary">{policy.Level}</Badge>
            )}
          </div>
        </div>

        <Separator orientation="vertical" className="h-8" />

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <Label
              htmlFor={`toggle-${policy.Name}`}
              className="text-xs text-muted-foreground"
            >
              {isEnabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id={`toggle-${policy.Name}`}
              checked={isEnabled}
              onCheckedChange={(checked: boolean) =>
                onToggle(policy.Name, checked)
              }
              disabled={toggling === policy.Name}
              size="sm"
            />
          </div>

          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger
              render={
                <Button variant="destructive" size="icon-sm" />
              }
            >
              <Trash2Icon className="size-3.5" />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Policy</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete the policy{" "}
                  <strong>{policy.Name}</strong>? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setDeleteOpen(false);
                    onDelete(policy.Name);
                  }}
                >
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PoliciesPage() {
  const policies = useStore((s) => s.policies);
  const setPolicies = useStore((s) => s.setPolicies);
  const bridgeConnected = useStore((s) => s.bridgeConnected);

  const [zoneTransferPolicies, setZoneTransferPolicies] = useState<Policy[]>(
    []
  );
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadPolicies = useCallback(async () => {
    if (!bridgeConnected) return;
    setLoading(true);

    const params = getServerParams();
    const zone = zoneFilter || undefined;

    try {
      const [stdResult, ztResult] = await Promise.all([
        api.listPolicies(params.server, zone),
        api.listZoneTransferPolicies(
          params.server,
          zone,
          params.serverId,
          params.credentialMode
        ),
      ]);

      if (stdResult.success) {
        setPolicies(
          (stdResult as Record<string, unknown>).policies as Policy[] ?? []
        );
      } else {
        toast.error("Failed to load policies", {
          description: stdResult.error,
        });
      }

      if (ztResult.success) {
        setZoneTransferPolicies(
          (ztResult as Record<string, unknown>).policies as Policy[] ?? []
        );
      }
    } catch {
      toast.error("Failed to load policies");
    } finally {
      setLoading(false);
    }
  }, [bridgeConnected, zoneFilter, setPolicies]);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  const handleToggle = useCallback(
    async (name: string, enabled: boolean) => {
      setToggling(name);
      const params = getServerParams();
      const zone = zoneFilter || undefined;

      const result = await api.setPolicyState(
        name,
        enabled,
        params.server,
        zone
      );

      if (result.success) {
        toast.success(
          `Policy "${name}" ${enabled ? "enabled" : "disabled"}`
        );
        await loadPolicies();
      } else {
        toast.error(`Failed to ${enabled ? "enable" : "disable"} policy`, {
          description: result.error,
        });
      }
      setToggling(null);
    },
    [zoneFilter, loadPolicies]
  );

  const handleDelete = useCallback(
    async (name: string) => {
      const params = getServerParams();
      const zone = zoneFilter || undefined;

      // Try standard delete first, then zone transfer
      const isZt = zoneTransferPolicies.some((p) => p.Name === name);
      const result = isZt
        ? await api.removeZoneTransferPolicy(
            name,
            params.server,
            zone,
            params.serverId,
            params.credentialMode
          )
        : await api.removePolicy(name, params.server, zone);

      if (result.success) {
        toast.success(`Policy "${name}" deleted`);
        await loadPolicies();
      } else {
        toast.error("Failed to delete policy", {
          description: result.error,
        });
      }
    },
    [zoneFilter, zoneTransferPolicies, loadPolicies]
  );

  const allPolicies = [
    ...policies.map((p) => ({ policy: p, type: "standard" as const })),
    ...zoneTransferPolicies.map((p) => ({
      policy: p,
      type: "zoneTransfer" as const,
    })),
  ];

  const isEmpty = allPolicies.length === 0 && !loading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Policies</h2>
          <p className="text-sm text-muted-foreground">
            View and manage DNS policies on the active server
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label
              htmlFor="zone-filter"
              className="text-sm text-muted-foreground whitespace-nowrap"
            >
              Zone filter
            </Label>
            <Input
              id="zone-filter"
              placeholder="All zones"
              value={zoneFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setZoneFilter(e.target.value)
              }
              className="w-48"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReorderOpen(true)}
            disabled={policies.length < 2}
          >
            Reorder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadPolicies}
            disabled={loading || !bridgeConnected}
          >
            <RefreshCwIcon
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <Separator />

      {/* Not connected state */}
      {!bridgeConnected && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center max-w-md mx-auto">
            <AlertTriangleIcon className="size-8 text-amber-400/60 mb-3" />
            <CardTitle className="text-base mb-1">
              Bridge not connected
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Start the PowerShell bridge and add a server on the Server tab to view policies. You can still create policies offline using the Create Policy tab.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {bridgeConnected && isEmpty && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center max-w-md mx-auto">
            <ShieldIcon className="size-8 text-muted-foreground/30 mb-3" />
            <CardTitle className="text-base mb-1">No policies configured</CardTitle>
            <p className="text-sm text-muted-foreground">
              {zoneFilter
                ? `No policies found for zone "${zoneFilter}". Try clearing the filter or creating a new policy.`
                : "DNS policies control how the server responds to queries. Use the Create Policy tab to add your first policy, or try a Wizard for common scenarios."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && allPolicies.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <RefreshCwIcon className="size-5 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">
              Loading policies...
            </span>
          </CardContent>
        </Card>
      )}

      {/* Policy list */}
      {allPolicies.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {allPolicies.length} {allPolicies.length === 1 ? "policy" : "policies"} found
          </p>
          {allPolicies.map(({ policy, type }) => (
            <PolicyCard
              key={`${type}-${policy.Name}`}
              policy={policy}
              policyType={type}
              onToggle={handleToggle}
              onDelete={handleDelete}
              toggling={toggling}
            />
          ))}
        </div>
      )}

      {/* Reorder Dialog */}
      <PolicyReorderDialog
        open={reorderOpen}
        onOpenChange={setReorderOpen}
        policies={policies}
        zone={zoneFilter || undefined}
        onSaved={loadPolicies}
      />
    </div>
  );
}
