/** Maps route pathnames to help document slugs in /public/help/{slug}.md */
const routeToSlug: Record<string, string> = {
  "/server": "server-management",
  "/objects": "dns-objects",
  "/zones": "zones",
  "/policies": "policies",
  "/create": "policies",
  "/blocklists": "blocklists",
  "/wizards": "wizards",
  "/dnssec": "dnssec",
  "/resolvers": "resolvers",
  "/backup": "backup-and-import",
  "/powershell": "powershell-output",
};

const routeEntries = Object.entries(routeToSlug);

const allDocs = [
  { slug: "getting-started", title: "Getting Started" },
  { slug: "server-management", title: "Server Management" },
  { slug: "dns-objects", title: "DNS Objects" },
  { slug: "zones", title: "Zone Management" },
  { slug: "policies", title: "Policies" },
  { slug: "blocklists", title: "Blocklists" },
  { slug: "wizards", title: "Scenario Wizards" },
  { slug: "dnssec", title: "DNSSEC Management" },
  { slug: "resolvers", title: "Resolvers & Topology" },
  { slug: "backup-and-import", title: "Backup & Import" },
  { slug: "powershell-output", title: "PowerShell Commands" },
  { slug: "troubleshooting", title: "Troubleshooting" },
];

export function slugForRoute(pathname: string): string {
  if (routeToSlug[pathname]) return routeToSlug[pathname];
  for (const [route, slug] of routeEntries) {
    if (pathname.startsWith(route + "/")) return slug;
  }
  return "getting-started";
}

export function titleForSlug(slug: string): string {
  return allDocs.find((d) => d.slug === slug)?.title ?? "Help";
}

export function getAllDocs() {
  return allDocs;
}
