/* ── Application State ─────────────────────────────────── */
(function () {
    'use strict';

    window.DNSPolicyManager = window.DNSPolicyManager || {};

    window.DNSPolicyManager.state = {
        policies: [],
        selectedPolicy: null,
        criteriaCount: 0,
        scopeCount: 1,
        blocklistData: null,

        // Bridge state
        bridgeConnected: false,

        // Multi-server registry
        servers: [],            // [{ id, name, hostname, credentialMode, hasCredential, status, lastChecked, serverInfo, zoneCount }]
        activeServerId: null,   // Currently selected server in Server tab

        serverZones: [],
        executionMode: 'generate',   // 'generate' | 'execute'

        // DNS Objects (Phase 1)
        clientSubnets: [],          // [{ Name, IPv4Subnet, IPv6Subnet }]
        zoneScopes: {},             // { "zone.com": [{ Name, ZoneName }] }
        recursionScopes: [],        // [{ Name, EnableRecursion, Forwarder }]

        // Zone management
        selectedZone: null,         // Full zone detail object from getZoneDetails
        zoneRecords: [],            // Flattened record array from getZoneRecords
        zoneRecordFilter: { type: '', search: '' },

        // Wizard state (Phase 4)
        wizardState: {
            scenarioId: null,
            currentStep: 0,
            totalSteps: 0,
            data: {}
        }
    };
})();
