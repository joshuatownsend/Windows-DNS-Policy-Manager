"use client";

import { useState, useEffect } from "react";
import { BridgeStatus } from "./bridge-status";
import { ExecutionToggle } from "./execution-toggle";
import { TabNav } from "./tab-nav";
import { HelpPanel } from "./help-panel";
import { useBridgeHealth } from "@/lib/use-bridge-health";
import { useStore } from "@/lib/store";

function ActiveServerIndicator() {
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  const active = servers.find((s) => s.id === activeServerId);
  if (!active) return null;

  const statusColor =
    active.status === "online"
      ? "bg-emerald-500"
      : active.status === "offline"
        ? "bg-red-500"
        : active.status === "error"
          ? "bg-amber-500"
          : "bg-zinc-500";

  return (
    <div className="flex items-center gap-2.5 px-6 py-1.5 text-xs text-muted-foreground bg-background/50 border-b border-border/40">
      <span className={`h-1.5 w-1.5 rounded-full ${statusColor} shrink-0`} />
      <span className="font-mono tracking-wide">
        {active.name || active.hostname}
      </span>
      <span className="text-muted-foreground/50">·</span>
      <span className="text-muted-foreground/60">{active.hostname}</span>
      {active.status === "online" && active.zoneCount > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground/60">{active.zoneCount} zone{active.zoneCount !== 1 ? "s" : ""}</span>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useBridgeHealth();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background ops-grid-bg">
      {/* ── Header ──────────────────────────────────────── */}
      <header className="relative ops-scanline">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Brand */}
            <div className="flex items-center gap-4">
              <div className="relative flex items-center justify-center w-9 h-9">
                <div className="absolute inset-0 rounded-lg bg-cyan/10 border border-cyan/20" />
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="w-[18px] h-[18px] relative z-10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5Z" className="stroke-cyan" />
                  <path d="M2 17l10 5 10-5" className="stroke-cyan/50" />
                  <path d="M2 12l10 5 10-5" className="stroke-cyan/70" />
                </svg>
              </div>
              <div>
                <h1
                  className="text-[15px] font-semibold tracking-wide text-foreground"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  DNS POLICY MANAGER
                </h1>
                <p className="text-[11px] text-muted-foreground tracking-widest uppercase font-mono">
                  Windows Server Operations Console
                </p>
              </div>
            </div>

            {/* Right side: controls */}
            <div className="flex items-center gap-5">
              <ExecutionToggle />
              <div className="w-px h-5 bg-border" />
              <BridgeStatus />
              <div className="w-px h-5 bg-border" />
              {/* Help button */}
              <button
                onClick={() => setHelpOpen(true)}
                className="group relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-[rgba(136,180,255,0.08)] transition-colors"
                title="Help (context-sensitive)"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground group-hover:text-cyan transition-colors"
                >
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M6 6.5a2 2 0 013.94.5c0 1-1.44 1.5-1.44 1.5" />
                  <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div className="header-rule" />
      </header>

      {/* ── Active Server Indicator ─────────────────────── */}
      <div className="mx-auto max-w-[1400px]">
        <ActiveServerIndicator />
      </div>

      {/* ── Tabs + Content ──────────────────────────────── */}
      <div className="mx-auto max-w-[1400px] px-6 pt-1">
        <TabNav />
        <main className="py-6 animate-fade-in">{children}</main>
      </div>

      {/* ── Help slide-over ─────────────────────────────── */}
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
