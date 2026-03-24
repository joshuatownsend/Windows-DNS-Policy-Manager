"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/server", label: "Server", shortcut: "01" },
  { href: "/objects", label: "Objects", shortcut: "02" },
  { href: "/zones", label: "Zones", shortcut: "03" },
  { href: "/policies", label: "Policies", shortcut: "04" },
  { href: "/create", label: "Create", shortcut: "05" },
  { href: "/blocklists", label: "Blocklists", shortcut: "06" },
  { href: "/wizards", label: "Wizards", shortcut: "07" },
  { href: "/dnssec", label: "DNSSEC", shortcut: "08" },
  { href: "/resolvers", label: "Resolvers", shortcut: "09" },
  { href: "/backup", label: "Backup", shortcut: "10" },
  { href: "/powershell", label: "PowerShell", shortcut: "11" },
] as const;

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex overflow-x-auto scrollbar-none stagger-children border-b border-border"
      role="tablist"
      aria-label="Policy management tabs"
    >
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            data-active={active}
            className={cn(
              "tab-indicator group relative flex items-center gap-2 whitespace-nowrap px-4 py-3 text-[13px] font-medium transition-all duration-200",
              "hover:text-foreground",
              active
                ? "text-cyan"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            {/* Numeric prefix */}
            <span
              className={cn(
                "font-mono text-[10px] tabular-nums transition-colors duration-200",
                active ? "text-cyan/60" : "text-muted-foreground/40 group-hover:text-muted-foreground/60"
              )}
            >
              {tab.shortcut}
            </span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
      {/* Trailing spacer fills remaining width */}
      <div className="min-w-0 flex-1" />
    </nav>
  );
}
