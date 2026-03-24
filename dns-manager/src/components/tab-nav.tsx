"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/server", label: "Server" },
  { href: "/objects", label: "DNS Objects" },
  { href: "/zones", label: "Zones" },
  { href: "/policies", label: "Policies" },
  { href: "/create", label: "Create Policy" },
  { href: "/blocklists", label: "Blocklists" },
  { href: "/wizards", label: "Wizards" },
  { href: "/dnssec", label: "DNSSEC" },
  { href: "/resolvers", label: "Resolvers" },
  { href: "/backup", label: "Backup & Import" },
  { href: "/powershell", label: "PowerShell Commands" },
] as const;

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto scrollbar-none py-2"
      aria-label="Policy management"
    >
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors min-h-[36px] flex items-center",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground/80"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
