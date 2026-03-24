"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  Trash2,
  Pause,
  Play,
  RefreshCw,
  Download,
} from "lucide-react";

function getServerParams() {
  const s = useStore.getState().getActiveServer();
  if (!s) return {};
  return { server: s.hostname, serverId: s.id, credentialMode: s.credentialMode };
}

interface Props {
  zoneName: string;
  zoneType: string;
  onDeleted: () => void;
}

export function ZoneActions({ zoneName, zoneType, onDeleted }: Props) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isSecondary = zoneType === "Secondary";
  const p = getServerParams();

  const handleDelete = async () => {
    if (confirmName !== zoneName) {
      toast.warning("Zone name does not match.");
      return;
    }
    setDeleting(true);
    const result = await api.removeZone(zoneName, p.server, p.serverId, p.credentialMode);
    setDeleting(false);
    if (result.success) {
      toast.success(`Zone "${zoneName}" deleted.`);
      setDeleteOpen(false);
      setConfirmName("");
      onDeleted();
    } else {
      toast.error("Failed: " + result.error);
    }
  };

  const handleSuspend = async () => {
    const r = await api.suspendZone(zoneName, p.server, p.serverId, p.credentialMode);
    if (r.success) toast.success(`Zone "${zoneName}" suspended.`);
    else toast.error("Failed: " + r.error);
  };

  const handleResume = async () => {
    const r = await api.resumeZone(zoneName, p.server, p.serverId, p.credentialMode);
    if (r.success) toast.success(`Zone "${zoneName}" resumed.`);
    else toast.error("Failed: " + r.error);
  };

  const handleTransfer = async () => {
    const r = await api.startZoneTransfer(zoneName, p.server, p.serverId, p.credentialMode);
    if (r.success) toast.success(`Zone transfer started for "${zoneName}".`);
    else toast.error("Failed: " + r.error);
  };

  const handleExport = async () => {
    const r = await api.exportZone(zoneName, undefined, p.server, p.serverId, p.credentialMode);
    if (r.success) toast.success(`Zone "${zoneName}" exported to ${(r as Record<string, unknown>).fileName || zoneName + ".dns"}.`);
    else toast.error("Failed: " + r.error);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 w-7 p-0" />}>
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleSuspend}>
            <Pause className="h-3.5 w-3.5 mr-2" /> Suspend
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleResume}>
            <Play className="h-3.5 w-3.5 mr-2" /> Resume
          </DropdownMenuItem>
          {isSecondary && (
            <DropdownMenuItem onClick={handleTransfer}>
              <RefreshCw className="h-3.5 w-3.5 mr-2" /> Force Transfer
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-2" /> Export
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Zone
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Zone</DialogTitle>
            <DialogDescription>
              This will permanently remove <strong>{zoneName}</strong> and all its records. Type the zone name to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Type zone name to confirm</Label>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={zoneName}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={confirmName !== zoneName || deleting}
            >
              {deleting ? "Deleting..." : "Delete Zone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
