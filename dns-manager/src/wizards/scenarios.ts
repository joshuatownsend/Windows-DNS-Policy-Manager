export interface ScenarioStep {
  id: string;
  title: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  icon: string;
  steps: ScenarioStep[];
}

export const scenarios: Record<string, Scenario> = {
  geolocation: {
    id: "geolocation",
    title: "Geo-Location Routing",
    description: "Route queries to different IPs based on client geographic location using client subnets.",
    icon: "\u{1F30D}",
    steps: [
      { id: "zone", title: "Select Zone" },
      { id: "regions", title: "Define Regions" },
      { id: "records", title: "Configure Records" },
      { id: "review", title: "Review & Execute" },
    ],
  },
  splitbrain: {
    id: "splitbrain",
    title: "Split-Brain DNS",
    description: "Serve different answers to internal vs. external clients for the same zone.",
    icon: "\u{1F500}",
    steps: [
      { id: "method", title: "Choose Method" },
      { id: "zone", title: "Select Zone & Network" },
      { id: "records", title: "Internal Scope & Records" },
      { id: "recursion", title: "Configure Recursion" },
      { id: "policies", title: "Create Policies" },
      { id: "review", title: "Review & Execute" },
    ],
  },
  blocklist: {
    id: "blocklist",
    title: "Domain Blocklist",
    description: "Block or silently drop queries for a list of domains.",
    icon: "\u{1F6AB}",
    steps: [
      { id: "domains", title: "Import Domains" },
      { id: "action", title: "Choose Action" },
      { id: "review", title: "Review & Execute" },
    ],
  },
  timeofday: {
    id: "timeofday",
    title: "Time-of-Day Routing",
    description: "Route queries using weighted zone scopes based on time of day.",
    icon: "\u23F0",
    steps: [
      { id: "zone", title: "Select Zone & Record" },
      { id: "datacenters", title: "Define Datacenters" },
      { id: "peakhours", title: "Peak Hours & Weights" },
      { id: "review", title: "Review & Execute" },
    ],
  },
  loadbalancing: {
    id: "loadbalancing",
    title: "Application Load Balancing",
    description: "Distribute DNS queries across multiple backend servers using weighted zone scopes.",
    icon: "\u2696\uFE0F",
    steps: [
      { id: "zone", title: "Select Zone & Record" },
      { id: "backends", title: "Define Backends" },
      { id: "review", title: "Review & Execute" },
    ],
  },
  geolb: {
    id: "geolb",
    title: "Geo-Location + Load Balancing",
    description: "Combine geographic routing with weighted load balancing across datacenters.",
    icon: "\u{1F310}",
    steps: [
      { id: "zone", title: "Select Zone & Record" },
      { id: "regions", title: "Define Regions" },
      { id: "datacenters", title: "Datacenters & Weights" },
      { id: "review", title: "Review & Execute" },
    ],
  },
  primarysecondary: {
    id: "primarysecondary",
    title: "Primary-Secondary Geo-Location",
    description: "Configure geo-location on primary, replicate to secondary DNS servers.",
    icon: "\u{1F504}",
    steps: [
      { id: "primary", title: "Primary Server Setup" },
      { id: "secondaries", title: "Secondary Servers" },
      { id: "review", title: "Review & Execute" },
    ],
  },
  queryfilter: {
    id: "queryfilter",
    title: "Query Filters (Block/Allow)",
    description: "Block or allow DNS queries by domain, subnet, query type, or combinations.",
    icon: "\u{1F6E1}\uFE0F",
    steps: [
      { id: "mode", title: "Filter Mode" },
      { id: "values", title: "Filter Values" },
      { id: "review", title: "Review & Execute" },
    ],
  },
};
