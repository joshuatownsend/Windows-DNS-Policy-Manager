/* ── Application State ─────────────────────────────────── */
(function () {
    'use strict';

    window.DNSPolicyManager = window.DNSPolicyManager || {};

    window.DNSPolicyManager.state = {
        policies: [],
        selectedPolicy: null,
        criteriaCount: 0,
        scopeCount: 1,
        blocklistData: null
    };
})();
