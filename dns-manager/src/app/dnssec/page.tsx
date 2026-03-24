"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { getServerParams } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Plus,
  Trash2,
  Download,
  Anchor,
} from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const sp = getServerParams;

export default function DnssecPage() {
  const zones = useStore((s) => s.zones);
  const setZones = useStore((s) => s.setZones);
  const bridgeConnected = useStore((s) => s.bridgeConnected);

  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [dnssecSettings, setDnssecSettings] = useState<any>(null);
  const [signingKeys, setSigningKeys] = useState<any[]>([]);
  const [trustAnchors, setTrustAnchors] = useState<any[]>([]);
  const [trustPoints, setTrustPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [unsignConfirm, setUnsignConfirm] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  // Key form
  const [keyType, setKeyType] = useState("ZoneSigningKey");
  const [keyAlgo, setKeyAlgo] = useState("RsaSha256");
  const [keyLength, setKeyLength] = useState("2048");

  const setL = (k: string, v: boolean) => setLoading((p) => ({ ...p, [k]: v }));

  // Load zones on mount
  useEffect(() => {
    if (!bridgeConnected) return;
    const p = sp();
    api.listZones(p.server, p.serverId, p.credentialMode).then((r) => {
      if (r.success) setZones((r as any).zones || []);
    });
  }, [bridgeConnected, setZones]);

  const loadZoneDetails = useCallback(async (zoneName: string) => {
    const p = sp();
    setL("zone", true);
    const [settingsR, keysR] = await Promise.all([
      api.getDnssecSettings(zoneName, p.server, p.serverId, p.credentialMode),
      api.getSigningKeys(zoneName, p.server, p.serverId, p.credentialMode),
    ]);
    if (settingsR.success) setDnssecSettings((settingsR as any).settings);
    if (keysR.success) setSigningKeys((keysR as any).keys || []);
    setL("zone", false);
  }, []);

  const loadTrustData = useCallback(async () => {
    const p = sp();
    setL("trust", true);
    const [aR, pR] = await Promise.all([
      api.getTrustAnchors(p.server, p.serverId, p.credentialMode),
      api.getTrustPoints(p.server, p.serverId, p.credentialMode),
    ]);
    if (aR.success) setTrustAnchors((aR as any).anchors || []);
    if (pR.success) setTrustPoints((pR as any).points || []);
    setL("trust", false);
  }, []);

  const selectZone = (name: string) => {
    setSelectedZone(name);
    loadZoneDetails(name);
  };

  const handleSign = async () => {
    if (!selectedZone) return;
    const p = sp();
    setL("sign", true);
    const r = await api.signZone(selectedZone, p.server, p.serverId, p.credentialMode);
    setL("sign", false);
    if (r.success) { toast.success(`Zone "${selectedZone}" signed.`); loadZoneDetails(selectedZone); }
    else toast.error("Failed: " + r.error);
  };

  const handleUnsign = async () => {
    if (!selectedZone || confirmName !== selectedZone) return;
    const p = sp();
    setL("unsign", true);
    const r = await api.unsignZone(selectedZone, p.server, p.serverId, p.credentialMode);
    setL("unsign", false);
    if (r.success) { toast.success(`Zone "${selectedZone}" unsigned.`); setUnsignConfirm(false); setConfirmName(""); loadZoneDetails(selectedZone); }
    else toast.error("Failed: " + r.error);
  };

  const handleExportKey = async () => {
    if (!selectedZone) return;
    const p = sp();
    const r = await api.exportDnssecKey(selectedZone, p.server, p.serverId, p.credentialMode);
    if (r.success) toast.success("Public key exported. Check server's DNS directory.");
    else toast.error("Failed: " + r.error);
  };

  const handleAddKey = async () => {
    if (!selectedZone) return;
    const p = sp();
    const r = await api.addSigningKey(selectedZone, {
      keyType, cryptoAlgorithm: keyAlgo, keyLength: parseInt(keyLength),
    }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success("Signing key added."); setAddKeyOpen(false); loadZoneDetails(selectedZone); }
    else toast.error("Failed: " + r.error);
  };

  const handleRemoveKey = async (keyId: string) => {
    if (!selectedZone) return;
    const p = sp();
    const r = await api.removeSigningKey(selectedZone, keyId, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success("Key removed."); loadZoneDetails(selectedZone); }
    else toast.error("Failed: " + r.error);
  };

  if (!bridgeConnected) {
    return <div className="text-center py-12 text-muted-foreground">Connect to a server to manage DNSSEC.</div>;
  }

  // Zone counts used in summary (not rendered directly)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">DNSSEC Management</h2>
        <Button variant="outline" size="sm" onClick={loadTrustData} disabled={loading.trust}>
          <Anchor className="h-3.5 w-3.5 mr-1.5" /> Load Trust Data
        </Button>
      </div>

      {/* Zone signing status table */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Zone Signing Status</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zone</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.map((zone: any) => (
                <TableRow
                  key={zone.ZoneName}
                  className={`cursor-pointer ${selectedZone === zone.ZoneName ? "bg-cyan-500/5" : ""}`}
                  onClick={() => selectZone(zone.ZoneName)}
                >
                  <TableCell className="font-mono text-sm">{zone.ZoneName}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{zone.ZoneType}</Badge></TableCell>
                  <TableCell>
                    {zone.IsSigned ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">
                        <ShieldCheck className="h-3 w-3 mr-1" /> Signed
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <ShieldOff className="h-3 w-3 mr-1" /> Unsigned
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); selectZone(zone.ZoneName); }}>
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Selected zone DNSSEC detail */}
      {selectedZone && (
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">DNSSEC — {selectedZone}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSign} disabled={loading.sign}>
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Sign Zone
                </Button>
                <Button variant="outline" size="sm" onClick={() => setUnsignConfirm(true)}>
                  <ShieldOff className="h-3.5 w-3.5 mr-1" /> Unsign
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportKey}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export Key
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadZoneDetails(selectedZone)} disabled={loading.zone}>
                  <RefreshCw className={`h-3.5 w-3.5 ${loading.zone ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* DNSSEC Settings */}
            {dnssecSettings && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(dnssecSettings as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between p-2 rounded bg-secondary/30">
                    <span className="text-xs text-muted-foreground truncate mr-2">{key}</span>
                    <span className="text-xs font-mono shrink-0">{typeof val === "boolean" ? (val ? "Yes" : "No") : String(val)}</span>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            {/* Signing Keys */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Signing Keys</h3>
              <Button size="sm" variant="outline" onClick={() => setAddKeyOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Key
              </Button>
            </div>
            {signingKeys.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Algorithm</TableHead>
                    <TableHead>Length</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signingKeys.map((k: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge variant={k.KeyType === "KeySigningKey" ? "default" : "secondary"} className="text-xs">
                          {k.KeyType === "KeySigningKey" ? "KSK" : "ZSK"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{k.CryptoAlgorithm}</TableCell>
                      <TableCell className="text-sm font-mono">{k.KeyLength}</TableCell>
                      <TableCell className="text-sm">{k.CurrentState}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleRemoveKey(String(k.KeyId))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No signing keys. Zone may not be signed.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Trust Anchors */}
      {trustAnchors.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Trust Anchors</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trustAnchors.map((a: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-sm">{a.Name || a.TrustAnchorName}</TableCell>
                    <TableCell className="text-sm">{a.TrustAnchorType}</TableCell>
                    <TableCell className="text-sm">{a.TrustAnchorState}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive"
                        onClick={async () => {
                          const p = sp();
                          const r = await api.removeTrustAnchor(String(a.Name || a.TrustAnchorName), p.server, p.serverId, p.credentialMode);
                          if (r.success) { toast.success("Trust anchor removed."); loadTrustData(); }
                          else toast.error("Failed: " + r.error);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Trust Points */}
      {trustPoints.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Trust Points</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Last Refresh</TableHead>
                  <TableHead className="w-24">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trustPoints.map((pt: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-sm">{pt.TrustPointName}</TableCell>
                    <TableCell className="text-sm">{pt.TrustPointState}</TableCell>
                    <TableCell className="text-sm">{pt.LastActiveRefreshTime || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 text-xs"
                        onClick={async () => {
                          const p = sp();
                          const r = await api.updateTrustPoint(String(pt.TrustPointName), p.server, p.serverId, p.credentialMode);
                          if (r.success) { toast.success("Trust point updated."); loadTrustData(); }
                          else toast.error("Failed: " + r.error);
                        }}
                      >
                        Update
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add Signing Key Dialog */}
      <Dialog open={addKeyOpen} onOpenChange={setAddKeyOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Signing Key</DialogTitle>
            <DialogDescription>Add a KSK or ZSK to {selectedZone}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Key Type</Label>
              <Select value={keyType} onValueChange={(v) => { if (v) setKeyType(v); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="KeySigningKey">KSK (Key Signing Key)</SelectItem>
                  <SelectItem value="ZoneSigningKey">ZSK (Zone Signing Key)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Algorithm</Label>
              <Select value={keyAlgo} onValueChange={(v) => { if (v) setKeyAlgo(v); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RsaSha256">RSA/SHA-256</SelectItem>
                  <SelectItem value="RsaSha512">RSA/SHA-512</SelectItem>
                  <SelectItem value="ECDsaP256Sha256">ECDSA P-256/SHA-256</SelectItem>
                  <SelectItem value="ECDsaP384Sha384">ECDSA P-384/SHA-384</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Key Length</Label>
              <Input type="number" value={keyLength} onChange={(e) => setKeyLength(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddKeyOpen(false)}>Cancel</Button>
            <Button onClick={handleAddKey}>Add Key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsign Confirmation Dialog */}
      <Dialog open={unsignConfirm} onOpenChange={setUnsignConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unsign Zone</DialogTitle>
            <DialogDescription>
              This will remove DNSSEC signing from <strong>{selectedZone}</strong>. Type the zone name to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Type zone name to confirm</Label>
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={selectedZone || ""} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnsignConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleUnsign} disabled={confirmName !== selectedZone || loading.unsign}>
              {loading.unsign ? "Unsigning..." : "Unsign Zone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
