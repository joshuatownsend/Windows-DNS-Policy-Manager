"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { CredentialMode, Server, ZoneSummary } from "@/lib/types";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Play,
  Pencil,
  Trash2,
  Server as ServerIcon,
  Globe,
  Shield,
  RefreshCw,
  Wifi,
  WifiOff,
  HelpCircle,
  Lock,
  Key,
  User,
} from "lucide-react";
import { ServerConfig } from "@/components/server/server-config";
import { BpaPanel } from "@/components/server/bpa-panel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeDefaultServer(): Server {
  return {
    id: generateId(),
    name: "localhost",
    hostname: "localhost",
    credentialMode: "currentUser",
    hasCredential: false,
    status: "unknown",
    lastChecked: null,
    serverInfo: null,
    zoneCount: 0,
  };
}

const STATUS_COLORS: Record<Server["status"], string> = {
  online: "bg-emerald-500",
  offline: "bg-red-500",
  error: "bg-amber-500",
  unknown: "bg-muted-foreground/50",
};

const STATUS_LABELS: Record<Server["status"], string> = {
  online: "Online",
  offline: "Offline",
  error: "Error",
  unknown: "Unknown",
};

const CREDENTIAL_LABELS: Record<CredentialMode, string> = {
  currentUser: "Kerberos",
  savedCredential: "Saved Cred",
  session: "Session",
};

const CREDENTIAL_ICONS: Record<CredentialMode, typeof Key> = {
  currentUser: User,
  savedCredential: Lock,
  session: Key,
};

// ---------------------------------------------------------------------------
// Form state for add/edit dialog
// ---------------------------------------------------------------------------

interface ServerFormState {
  name: string;
  hostname: string;
  credentialMode: CredentialMode;
  username: string;
  password: string;
}

const EMPTY_FORM: ServerFormState = {
  name: "",
  hostname: "",
  credentialMode: "currentUser",
  username: "",
  password: "",
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ServerPage() {
  const {
    servers,
    activeServerId,
    serverZones,
    bridgeConnected,
    addServer,
    updateServer,
    removeServer,
    setActiveServerId,
    setServerZones,
  } = useStore();

  const getActiveServer = useStore((s) => s.getActiveServer);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [form, setForm] = useState<ServerFormState>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Testing state
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [testingAll, setTestingAll] = useState(false);

  const didInit = useRef(false);
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch — Zustand persist loads from localStorage
  // after SSR, so server/client HTML differ until mounted.
  useEffect(() => { setMounted(true); }, []);

  // ── Bootstrap default localhost server ────────────────────
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    if (servers.length === 0) {
      const def = makeDefaultServer();
      addServer(def);
      setActiveServerId(def.id);
    }
  }, [servers.length, addServer, setActiveServerId]);

  // ── Check saved credentials when bridge comes online ──────
  useEffect(() => {
    if (!bridgeConnected) return;
    servers
      .filter((s) => s.credentialMode === "savedCredential")
      .forEach(async (s) => {
        const res = await api.checkCredential(s.id);
        if (res.success) {
          updateServer(s.id, { hasCredential: !!res.found });
        }
      });
    // Run once when bridge connects; intentionally not re-running on servers changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeConnected]);

  // ── Test a single server ──────────────────────────────────
  const testServer = useCallback(
    async (server: Server) => {
      setTestingIds((prev) => new Set(prev).add(server.id));
      try {
        const res = await api.connectServer({
          hostname: server.hostname,
          id: server.id,
          credentialMode: server.credentialMode,
        });

        if (res.success) {
          const zones = (res.zones as ZoneSummary[] | undefined) ?? [];
          const serverInfo = (res.serverInfo as Server["serverInfo"]) ?? null;
          updateServer(server.id, {
            status: "online",
            lastChecked: new Date().toISOString(),
            zoneCount: zones.length,
            serverInfo,
          });

          // If this is the active server, update zone list
          if (server.id === activeServerId) {
            setServerZones(
              zones.map((z) => ({
                ZoneName: z.ZoneName,
                ZoneType: z.ZoneType,
                IsAutoCreated: z.IsAutoCreated,
                IsDsIntegrated: z.IsDsIntegrated,
                IsReverseLookupZone: z.IsReverseLookupZone,
                IsSigned: z.IsSigned,
              }))
            );
          }

          toast.success(`${server.name} is online`, {
            description: `${zones.length} zone(s) found`,
          });
        } else {
          updateServer(server.id, {
            status: res.bridgeDown ? "error" : "offline",
            lastChecked: new Date().toISOString(),
          });
          toast.error(`Failed to connect to ${server.name}`, {
            description: res.error ?? "Unknown error",
          });
        }
      } catch {
        updateServer(server.id, {
          status: "error",
          lastChecked: new Date().toISOString(),
        });
        toast.error(`Error testing ${server.name}`);
      } finally {
        setTestingIds((prev) => {
          const next = new Set(prev);
          next.delete(server.id);
          return next;
        });
      }
    },
    [activeServerId, updateServer, setServerZones]
  );

  // ── Test all servers ──────────────────────────────────────
  const testAllServers = useCallback(async () => {
    setTestingAll(true);
    // Test servers sequentially to avoid overwhelming the single-threaded bridge
    for (const s of servers) {
      await testServer(s);
    }
    setTestingAll(false);
  }, [servers, testServer]);

  // ── Activate server ───────────────────────────────────────
  const activateServer = useCallback(
    (server: Server) => {
      setActiveServerId(server.id);

      // Load zones from serverInfo if available
      if (server.serverInfo?.zones) {
        setServerZones(
          server.serverInfo.zones.map((z) => ({
            ZoneName: z.ZoneName,
            ZoneType: z.ZoneType,
            IsAutoCreated: z.IsAutoCreated,
            IsDsIntegrated: z.IsDsIntegrated,
            IsReverseLookupZone: z.IsReverseLookupZone,
            IsSigned: z.IsSigned,
          }))
        );
      } else {
        setServerZones([]);
      }
    },
    [setActiveServerId, setServerZones]
  );

  // ── Dialog helpers ────────────────────────────────────────
  const openAddDialog = () => {
    setEditingServerId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEditDialog = (server: Server) => {
    setEditingServerId(server.id);
    setForm({
      name: server.name,
      hostname: server.hostname,
      credentialMode: server.credentialMode,
      username: "",
      password: "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const trimmedName = form.name.trim();
    const trimmedHostname = form.hostname.trim();

    if (!trimmedName || !trimmedHostname) {
      toast.error("Name and hostname are required");
      return;
    }

    setSaving(true);
    try {
      if (editingServerId) {
        // Update existing
        updateServer(editingServerId, {
          name: trimmedName,
          hostname: trimmedHostname,
          credentialMode: form.credentialMode,
        });

        // Store credentials if provided
        if (
          form.credentialMode !== "currentUser" &&
          form.username &&
          form.password
        ) {
          const storeFn =
            form.credentialMode === "savedCredential"
              ? api.storeCredential
              : api.storeSessionCredential;

          if (bridgeConnected) {
            const res = await storeFn(
              editingServerId,
              form.username,
              form.password
            );
            if (res.success) {
              updateServer(editingServerId, { hasCredential: true });
              toast.success("Credentials saved");
            } else {
              toast.error("Failed to save credentials", {
                description: res.error,
              });
            }
          }
        }

        toast.success(`Updated ${trimmedName}`);
      } else {
        // Add new
        const newId = generateId();
        const newServer: Server = {
          id: newId,
          name: trimmedName,
          hostname: trimmedHostname,
          credentialMode: form.credentialMode,
          hasCredential: false,
          status: "unknown",
          lastChecked: null,
          serverInfo: null,
          zoneCount: 0,
        };

        addServer(newServer);

        // Store credentials if provided
        if (
          form.credentialMode !== "currentUser" &&
          form.username &&
          form.password &&
          bridgeConnected
        ) {
          const storeFn =
            form.credentialMode === "savedCredential"
              ? api.storeCredential
              : api.storeSessionCredential;

          const res = await storeFn(newId, form.username, form.password);
          if (res.success) {
            updateServer(newId, { hasCredential: true });
          }
        }

        setActiveServerId(newId);
        toast.success(`Added ${trimmedName}`);
      }

      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (server: Server) => {
    if (bridgeConnected && server.credentialMode === "savedCredential") {
      api.deleteCredential(server.id);
    }
    removeServer(server.id);
    toast.success(`Removed ${server.name}`);
  };

  // ── Derived data ──────────────────────────────────────────
  const activeServer = getActiveServer();
  const activeIsOnline = activeServer?.status === "online";
  const showCredentialFields = form.credentialMode !== "currentUser";

  // ── Render ────────────────────────────────────────────────
  if (!mounted) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">DNS Servers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage and monitor your DNS server connections
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={testAllServers}
            disabled={testingAll || servers.length === 0}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${testingAll ? "animate-spin" : ""}`}
            />
            Test All
          </Button>
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Server
          </Button>
        </div>
      </div>

      {/* Server Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((server) => {
          const isActive = server.id === activeServerId;
          const isTesting = testingIds.has(server.id);
          const CredIcon = CREDENTIAL_ICONS[server.credentialMode];

          return (
            <Card
              key={server.id}
              className={`cursor-pointer transition-all hover:ring-1 hover:ring-border ${
                isActive
                  ? "ring-2 ring-cyan-500 bg-secondary"
                  : "bg-secondary/40"
              }`}
              onClick={() => activateServer(server)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_COLORS[server.status]}`}
                      title={STATUS_LABELS[server.status]}
                    />
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-semibold truncate">
                        {server.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground truncate">
                        {server.hostname}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    <CredIcon className="h-3 w-3 mr-0.5" />
                    {CREDENTIAL_LABELS[server.credentialMode]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      {server.zoneCount} zone{server.zoneCount !== 1 ? "s" : ""}
                    </span>
                    {server.lastChecked && (
                      <span title={server.lastChecked}>
                        {new Date(server.lastChecked).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => testServer(server)}
                      disabled={isTesting}
                      title="Test connection"
                    >
                      {isTesting ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEditDialog(server)}
                      title="Edit server"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => handleRemove(server)}
                      title="Remove server"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {servers.length === 0 && (
        <Card accent className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-14 max-w-md mx-auto text-center">
            <ServerIcon className="h-10 w-10 mb-4 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">
              Add a DNS server to get started
            </p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Connect to a Windows DNS server to manage policies, zones, and records. Or use the app offline to generate PowerShell commands.
            </p>
            <Button size="sm" className="mt-5" onClick={openAddDialog}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Server
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Server Info + Zone Grid */}
      {activeServer && activeIsOnline && (
        <div className="space-y-4">
          {/* Server Info Panel */}
          <Card className="bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-cyan-500" />
                <CardTitle className="text-sm font-semibold">
                  {activeServer.name} - Server Info
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Hostname</p>
                  <p className="font-medium">{activeServer.hostname}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[activeServer.status]}`}
                    />
                    <span className="font-medium">
                      {STATUS_LABELS[activeServer.status]}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Zones</p>
                  <p className="font-medium">{activeServer.zoneCount}</p>
                </div>
                {activeServer.serverInfo?.version && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Version</p>
                    <p className="font-medium">
                      {activeServer.serverInfo.version}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Zone Cards Grid */}
          {serverZones.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-foreground/80 mb-3 flex items-center gap-2">
                <Globe className="h-4 w-4 text-cyan-500" />
                Zones ({serverZones.length})
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {serverZones.map((zone) => (
                  <Card
                    key={zone.ZoneName}
                    className="bg-secondary/40 hover:bg-card transition-colors"
                  >
                    <CardContent className="p-3">
                      <p
                        className="text-sm font-medium truncate mb-2"
                        title={zone.ZoneName}
                      >
                        {zone.ZoneName}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {zone.ZoneType}
                        </Badge>
                        {zone.IsDsIntegrated && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            <Shield className="h-2.5 w-2.5 mr-0.5" />
                            AD
                          </Badge>
                        )}
                        {zone.IsSigned && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            <Lock className="h-2.5 w-2.5 mr-0.5" />
                            DNSSEC
                          </Badge>
                        )}
                        {zone.IsReverseLookupZone && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0"
                          >
                            Reverse
                          </Badge>
                        )}
                        {zone.IsAutoCreated && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 text-muted-foreground/60"
                          >
                            Auto
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {serverZones.length === 0 && (
            <Card className="bg-secondary/40 border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <HelpCircle className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">No zones returned from server</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeServer && !activeIsOnline && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 max-w-md mx-auto text-center">
            <WifiOff className="h-8 w-8 mb-3 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">
              {activeServer.name || activeServer.hostname} is not connected
            </p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Test the connection to view server details, zones, and policies. Make sure the PowerShell bridge is running.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={testingIds.has(activeServer.id)}
              onClick={() => testServer(activeServer)}
            >
              {testingIds.has(activeServer.id) ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              Test Connection
            </Button>
          </CardContent>
        </Card>
      )}

      {/* DNS Best Practices Analyzer */}
      <BpaPanel />

      {/* Server Configuration */}
      <ServerConfig />

      {/* Add/Edit Server Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingServerId ? "Edit Server" : "Add Server"}
            </DialogTitle>
            <DialogDescription>
              {editingServerId
                ? "Update the server connection details."
                : "Configure a new DNS server connection."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="srv-name">Name</Label>
              <Input
                id="srv-name"
                placeholder="e.g. Production DNS"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="srv-hostname">Hostname</Label>
              <Input
                id="srv-hostname"
                placeholder="e.g. dns1.corp.local"
                value={form.hostname}
                onChange={(e) =>
                  setForm((f) => ({ ...f, hostname: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Credential Mode</Label>
              <Select
                value={form.credentialMode}
                onValueChange={(val) =>
                  setForm((f) => ({
                    ...f,
                    credentialMode: val as CredentialMode,
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="currentUser">
                    Current User (Kerberos/NTLM)
                  </SelectItem>
                  <SelectItem value="savedCredential">
                    Saved Credential (DPAPI)
                  </SelectItem>
                  <SelectItem value="session">
                    Session Credential
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showCredentialFields && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="srv-username">Username</Label>
                  <Input
                    id="srv-username"
                    placeholder="DOMAIN\\username"
                    value={form.username}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, username: e.target.value }))
                    }
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="srv-password">Password</Label>
                  <Input
                    id="srv-password"
                    type="password"
                    placeholder="Enter password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    autoComplete="new-password"
                  />
                </div>

                {!bridgeConnected && (
                  <p className="text-xs text-amber-400">
                    Bridge is offline. Credentials will not be saved until the
                    bridge is connected.
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {editingServerId ? "Save Changes" : "Add Server"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
