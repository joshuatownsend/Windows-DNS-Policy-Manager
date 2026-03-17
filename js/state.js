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
        executionMode: 'generate'   // 'generate' | 'execute'
    };
})();
