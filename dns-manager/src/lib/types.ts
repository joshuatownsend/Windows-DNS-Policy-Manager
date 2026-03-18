// ── Server Types ──────────────────────────────────────────

export type CredentialMode = "currentUser" | "savedCredential" | "session";

export interface Server {
  id: string;
  name: string;
  hostname: string;
  credentialMode: CredentialMode;
  hasCredential: boolean;
  status: "unknown" | "online" | "offline" | "error";
  lastChecked: string | null;
  serverInfo: ServerInfo | null;
  zoneCount: number;
}

export interface ServerInfo {
  name: string;
  version?: string;
  zones?: ZoneSummary[];
  [key: string]: unknown;
}

export interface ZoneSummary {
  ZoneName: string;
  ZoneType: string;
  IsAutoCreated: boolean;
  IsDsIntegrated: boolean;
  IsReverseLookupZone: boolean;
  IsSigned: boolean;
}

// ── Zone Types ────────────────────────────────────────────

export interface Zone {
  ZoneName: string;
  ZoneType: string;
  IsAutoCreated: boolean;
  IsDsIntegrated: boolean;
  IsReverseLookupZone: boolean;
  IsSigned: boolean;
  DynamicUpdate?: string;
  ReplicationScope?: string;
  Aging?: boolean;
  RefreshInterval?: string;
  NoRefreshInterval?: string;
  NotifyServers?: string[];
  SecondaryServers?: string[];
  SecureSecondaries?: string;
  [key: string]: unknown;
}

export type RecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "MX"
  | "NS"
  | "PTR"
  | "SRV"
  | "TXT"
  | "SOA";

export interface DnsRecord {
  HostName: string;
  RecordType: RecordType | string;
  RecordData: Record<string, unknown>;
  TimeToLive: string;
  Timestamp?: string;
  [key: string]: unknown;
}

// ── Policy Types ──────────────────────────────────────────

export type PolicyType = "QueryResolution" | "Recursion" | "ZoneTransfer";
export type PolicyAction = "ALLOW" | "DENY" | "IGNORE";
export type PolicyProcessingOrder = "FIRST" | "LAST" | string;

export interface PolicyCriterion {
  type: string;
  operator: string;
  value: string;
}

export interface PolicyScope {
  scopeName: string;
  weight?: number;
}

export interface Policy {
  Name: string;
  ProcessingOrder?: string;
  IsEnabled?: string;
  Action?: string;
  Level?: string;
  ZoneName?: string;
  Condition?: string;
  Content?: string[];
  Criteria?: PolicyCriterion[];
  [key: string]: unknown;
}

export interface PolicyFormData {
  name: string;
  policyType: PolicyType;
  action: PolicyAction;
  processingOrder: string;
  isEnabled: boolean;
  zoneName: string;
  condition: string;
  criteria: PolicyCriterion[];
  scopes: PolicyScope[];
  recursionScope: string;
  server: string;
  serverId: string;
  credentialMode: CredentialMode;
  applyToZone: boolean;
  targetServers: string[];
}

// ── DNS Object Types ──────────────────────────────────────

export interface ClientSubnet {
  Name: string;
  IPv4Subnet?: string[];
  IPv6Subnet?: string[];
}

export interface ZoneScope {
  Name: string;
  ZoneName: string;
}

export interface RecursionScope {
  Name: string;
  EnableRecursion?: boolean;
  Forwarder?: string[];
}

// ── Wizard Types ──────────────────────────────────────────

export type ScenarioId =
  | "geo-location"
  | "time-of-day"
  | "split-brain"
  | "load-balancing"
  | "query-filter"
  | "forensic-logging"
  | "app-partition"
  | "geo-lb"
  | "primary-secondary"
  | "block-domain";

export interface WizardScenario {
  id: ScenarioId;
  name: string;
  description: string;
  icon: string;
  policyType: PolicyType;
  steps: string[];
}

export interface WizardState {
  scenarioId: ScenarioId | null;
  currentStep: number;
  totalSteps: number;
  data: Record<string, unknown>;
}

// ── API Response Types ────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  bridgeDown?: boolean;
  data?: T;
  [key: string]: unknown;
}

export interface HealthResponse extends ApiResponse {
  status?: string;
}

// ── Backup Types ──────────────────────────────────────────

export interface BackupData {
  exportDate: string;
  server: string;
  policies: Policy[];
  zonePolicies?: Policy[];
  serverPolicies?: Policy[];
}

export interface BlocklistEntry {
  domain: string;
  action: PolicyAction;
}
