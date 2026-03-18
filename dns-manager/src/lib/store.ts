import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Server,
  Policy,
  Zone,
  DnsRecord,
  ClientSubnet,
  ZoneScope,
  RecursionScope,
  WizardState,
  ScenarioId,
  BlocklistEntry,
} from "./types";

interface DnsStore {
  // Bridge
  bridgeConnected: boolean;
  setBridgeConnected: (v: boolean) => void;

  // Execution mode
  executionMode: "generate" | "execute";
  setExecutionMode: (v: "generate" | "execute") => void;

  // Servers
  servers: Server[];
  activeServerId: string | null;
  setServers: (s: Server[]) => void;
  addServer: (s: Server) => void;
  updateServer: (id: string, partial: Partial<Server>) => void;
  removeServer: (id: string) => void;
  setActiveServerId: (id: string | null) => void;
  getActiveServer: () => Server | undefined;

  // Server zones (shown on server tab)
  serverZones: Zone[];
  setServerZones: (z: Zone[]) => void;

  // Policies
  policies: Policy[];
  selectedPolicy: Policy | null;
  setPolicies: (p: Policy[]) => void;
  setSelectedPolicy: (p: Policy | null) => void;

  // DNS Objects
  clientSubnets: ClientSubnet[];
  zoneScopes: Record<string, ZoneScope[]>;
  recursionScopes: RecursionScope[];
  setClientSubnets: (s: ClientSubnet[]) => void;
  setZoneScopes: (z: Record<string, ZoneScope[]>) => void;
  setRecursionScopes: (r: RecursionScope[]) => void;

  // Zones tab
  zones: Zone[];
  selectedZone: Zone | null;
  zoneRecords: DnsRecord[];
  zoneRecordFilter: { type: string; search: string };
  setZones: (z: Zone[]) => void;
  setSelectedZone: (z: Zone | null) => void;
  setZoneRecords: (r: DnsRecord[]) => void;
  setZoneRecordFilter: (f: { type: string; search: string }) => void;

  // Wizard
  wizardState: WizardState;
  setWizardScenario: (id: ScenarioId, totalSteps: number) => void;
  setWizardStep: (step: number) => void;
  setWizardData: (data: Record<string, unknown>) => void;
  resetWizard: () => void;

  // Blocklist
  blocklistData: BlocklistEntry[] | null;
  setBlocklistData: (d: BlocklistEntry[] | null) => void;

  // Create policy form
  criteriaCount: number;
  scopeCount: number;
  setCriteriaCount: (n: number) => void;
  setScopeCount: (n: number) => void;

  // PowerShell output
  psOutput: string[];
  addPsOutput: (line: string) => void;
  clearPsOutput: () => void;
}

const initialWizardState: WizardState = {
  scenarioId: null,
  currentStep: 0,
  totalSteps: 0,
  data: {},
};

export const useStore = create<DnsStore>()(
  persist(
    (set, get) => ({
      // Bridge
      bridgeConnected: false,
      setBridgeConnected: (v) => set({ bridgeConnected: v }),

      // Execution mode
      executionMode: "generate",
      setExecutionMode: (v) => set({ executionMode: v }),

      // Servers
      servers: [],
      activeServerId: null,
      setServers: (servers) => set({ servers }),
      addServer: (s) => set((st) => ({ servers: [...st.servers, s] })),
      updateServer: (id, partial) =>
        set((st) => ({
          servers: st.servers.map((s) =>
            s.id === id ? { ...s, ...partial } : s
          ),
        })),
      removeServer: (id) =>
        set((st) => ({
          servers: st.servers.filter((s) => s.id !== id),
          activeServerId: st.activeServerId === id ? null : st.activeServerId,
        })),
      setActiveServerId: (id) => set({ activeServerId: id }),
      getActiveServer: () => {
        const { servers, activeServerId } = get();
        return servers.find((s) => s.id === activeServerId);
      },

      // Server zones
      serverZones: [],
      setServerZones: (z) => set({ serverZones: z }),

      // Policies
      policies: [],
      selectedPolicy: null,
      setPolicies: (policies) => set({ policies }),
      setSelectedPolicy: (p) => set({ selectedPolicy: p }),

      // DNS Objects
      clientSubnets: [],
      zoneScopes: {},
      recursionScopes: [],
      setClientSubnets: (clientSubnets) => set({ clientSubnets }),
      setZoneScopes: (zoneScopes) => set({ zoneScopes }),
      setRecursionScopes: (recursionScopes) => set({ recursionScopes }),

      // Zones tab
      zones: [],
      selectedZone: null,
      zoneRecords: [],
      zoneRecordFilter: { type: "", search: "" },
      setZones: (zones) => set({ zones }),
      setSelectedZone: (z) => set({ selectedZone: z }),
      setZoneRecords: (zoneRecords) => set({ zoneRecords }),
      setZoneRecordFilter: (f) => set({ zoneRecordFilter: f }),

      // Wizard
      wizardState: { ...initialWizardState },
      setWizardScenario: (id, totalSteps) =>
        set({
          wizardState: {
            scenarioId: id,
            currentStep: 0,
            totalSteps,
            data: {},
          },
        }),
      setWizardStep: (step) =>
        set((st) => ({
          wizardState: { ...st.wizardState, currentStep: step },
        })),
      setWizardData: (data) =>
        set((st) => ({
          wizardState: {
            ...st.wizardState,
            data: { ...st.wizardState.data, ...data },
          },
        })),
      resetWizard: () => set({ wizardState: { ...initialWizardState } }),

      // Blocklist
      blocklistData: null,
      setBlocklistData: (d) => set({ blocklistData: d }),

      // Create policy form
      criteriaCount: 0,
      scopeCount: 1,
      setCriteriaCount: (n) => set({ criteriaCount: n }),
      setScopeCount: (n) => set({ scopeCount: n }),

      // PowerShell output
      psOutput: [],
      addPsOutput: (line) =>
        set((st) => ({ psOutput: [...st.psOutput, line] })),
      clearPsOutput: () => set({ psOutput: [] }),
    }),
    {
      name: "dns-policy-manager",
      partialize: (state) => ({
        servers: state.servers,
        activeServerId: state.activeServerId,
        executionMode: state.executionMode,
      }),
    }
  )
);
