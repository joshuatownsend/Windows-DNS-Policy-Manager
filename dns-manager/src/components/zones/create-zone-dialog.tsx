"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { CreateZoneType } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ZONE_TYPES: { value: CreateZoneType; label: string; desc: string }[] = [
  { value: "Primary", label: "Primary", desc: "Authoritative read-write zone" },
  { value: "Secondary", label: "Secondary", desc: "Read-only copy from master" },
  { value: "Stub", label: "Stub", desc: "NS records only, delegates to master" },
  { value: "ConditionalForwarder", label: "Conditional Forwarder", desc: "Forward queries for this domain" },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}

export function CreateZoneDialog({ open, onOpenChange, onCreated }: Props) {
  const getActiveServer = useStore((s) => s.getActiveServer);

  const [zoneType, setZoneType] = useState<CreateZoneType>("Primary");
  const [zoneName, setZoneName] = useState("");
  const [replicationScope, setReplicationScope] = useState("");
  const [zoneFile, setZoneFile] = useState("");
  const [dynamicUpdate, setDynamicUpdate] = useState("None");
  const [masterServers, setMasterServers] = useState("");
  const [creating, setCreating] = useState(false);

  const needsMasters = zoneType === "Secondary" || zoneType === "Stub" || zoneType === "ConditionalForwarder";

  const handleCreate = async () => {
    if (!zoneName.trim()) {
      toast.warning("Zone name is required.");
      return;
    }
    if (needsMasters && !masterServers.trim()) {
      toast.warning("Master server IP(s) required.");
      return;
    }

    const server = getActiveServer();
    const data: Record<string, unknown> = {
      zoneName: zoneName.trim(),
      zoneType,
      server: server?.hostname,
      serverId: server?.id,
      credentialMode: server?.credentialMode,
    };

    if (replicationScope) data.replicationScope = replicationScope;
    if (zoneFile.trim()) data.zoneFile = zoneFile.trim();
    if (zoneType === "Primary" && dynamicUpdate !== "None") data.dynamicUpdate = dynamicUpdate;
    if (needsMasters) {
      data.masterServers = masterServers.split(",").map((s) => s.trim()).filter(Boolean);
    }

    setCreating(true);
    const result = await api.createZone(data);
    setCreating(false);

    if (result.success) {
      toast.success(`Zone "${zoneName}" created.`);
      onOpenChange(false);
      resetForm();
      onCreated();
    } else {
      toast.error("Failed: " + result.error);
    }
  };

  const resetForm = () => {
    setZoneName("");
    setReplicationScope("");
    setZoneFile("");
    setDynamicUpdate("None");
    setMasterServers("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Zone</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Zone Type Cards */}
          <div className="grid grid-cols-2 gap-2">
            {ZONE_TYPES.map((t) => (
              <Card
                key={t.value}
                className={`p-3 cursor-pointer transition-all hover:bg-secondary/50 ${
                  zoneType === t.value ? "ring-1 ring-primary bg-secondary/30" : ""
                }`}
                onClick={() => setZoneType(t.value)}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground">{t.desc}</div>
              </Card>
            ))}
          </div>

          {/* Zone Name */}
          <div className="space-y-2">
            <Label>Zone Name</Label>
            <Input
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder="contoso.com"
            />
          </div>

          {/* Master Servers (Secondary, Stub, Conditional Forwarder) */}
          {needsMasters && (
            <div className="space-y-2">
              <Label>Master Server IPs (comma-separated)</Label>
              <Input
                value={masterServers}
                onChange={(e) => setMasterServers(e.target.value)}
                placeholder="192.168.1.10, 192.168.1.11"
              />
            </div>
          )}

          {/* Replication Scope (Primary, Stub, Conditional Forwarder — AD-integrated) */}
          {(zoneType === "Primary" || zoneType === "Stub" || zoneType === "ConditionalForwarder") && (
            <div className="space-y-2">
              <Label>AD Replication Scope (leave empty for file-backed)</Label>
              <Select value={replicationScope} onValueChange={(v) => { if (v !== null) setReplicationScope(v); }}>
                <SelectTrigger><SelectValue placeholder="File-backed (no replication)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">File-backed (no replication)</SelectItem>
                  <SelectItem value="Domain">Domain</SelectItem>
                  <SelectItem value="Forest">Forest</SelectItem>
                  <SelectItem value="Legacy">Legacy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Zone File (when not AD-integrated) */}
          {!replicationScope && zoneType !== "ConditionalForwarder" && (
            <div className="space-y-2">
              <Label>Zone File (optional, defaults to zonename.dns)</Label>
              <Input
                value={zoneFile}
                onChange={(e) => setZoneFile(e.target.value)}
                placeholder={`${zoneName || "contoso.com"}.dns`}
              />
            </div>
          )}

          {/* Dynamic Update (Primary only) */}
          {zoneType === "Primary" && (
            <div className="space-y-2">
              <Label>Dynamic Update</Label>
              <Select value={dynamicUpdate} onValueChange={(v) => { if (v) setDynamicUpdate(v); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">None</SelectItem>
                  <SelectItem value="NonsecureAndSecure">Nonsecure and Secure</SelectItem>
                  <SelectItem value="Secure">Secure Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Zone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
