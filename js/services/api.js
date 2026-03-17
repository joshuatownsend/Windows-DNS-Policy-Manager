/* ── Bridge API Client ─────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    var BRIDGE_URL = 'http://127.0.0.1:8650';
    var REQUEST_TIMEOUT = 15000;
    var HEALTH_INTERVAL = 30000;

    var healthTimer = null;

    /**
     * Core request wrapper. Returns { success, ... } or { success: false, error, bridgeDown }.
     */
    function request(method, path, body) {
        var url = BRIDGE_URL + path;

        var opts = {
            method: method,
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' }
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            opts.body = JSON.stringify(body);
        }

        // Timeout via AbortController if available, else race with setTimeout
        var controller = null;
        var timeoutId = null;

        if (typeof AbortController !== 'undefined') {
            controller = new AbortController();
            opts.signal = controller.signal;
            timeoutId = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT);
        }

        return fetch(url, opts)
            .then(function (res) {
                if (timeoutId) clearTimeout(timeoutId);
                return res.json().catch(function () {
                    // Non-JSON response (e.g. HTML error page)
                    return {
                        success: false,
                        error: 'Bridge returned non-JSON response (HTTP ' + res.status + ')'
                    };
                });
            })
            .catch(function (err) {
                if (timeoutId) clearTimeout(timeoutId);
                return {
                    success: false,
                    error: err.message || 'Bridge unreachable',
                    bridgeDown: true
                };
            });
    }

    // ── Convenience Methods ─────────────────────────────────

    var api = {};

    api.health = function () {
        return request('GET', '/api/health');
    };

    api.connect = function (server, connectionType) {
        return request('POST', '/api/connect', {
            server: server || 'localhost',
            connectionType: connectionType || 'local'
        });
    };

    api.listZones = function (server) {
        var qs = server ? '?server=' + encodeURIComponent(server) : '';
        return request('GET', '/api/zones' + qs);
    };

    api.listPolicies = function (server, zone) {
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (zone) params.push('zone=' + encodeURIComponent(zone));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('GET', '/api/policies' + qs);
    };

    api.addPolicy = function (policy) {
        return request('POST', '/api/policies', policy);
    };

    api.removePolicy = function (name, server, zone) {
        var encodedName = encodeURIComponent(name);
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (zone) params.push('zone=' + encodeURIComponent(zone));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('DELETE', '/api/policies/' + encodedName + qs);
    };

    api.backup = function (server, includeZone, includeServer) {
        return request('POST', '/api/backup', {
            server: server || 'localhost',
            includeZone: includeZone !== false,
            includeServer: includeServer !== false
        });
    };

    api.execute = function (command) {
        return request('POST', '/api/execute', { command: command });
    };

    // ── Credential Management ────────────────────────────────

    api.storeCredential = function (serverId, username, password) {
        return request('POST', '/api/credentials/store', {
            serverId: serverId,
            username: username,
            password: password
        });
    };

    api.checkCredential = function (serverId) {
        return request('GET', '/api/credentials/check?serverId=' + encodeURIComponent(serverId));
    };

    api.deleteCredential = function (serverId) {
        return request('DELETE', '/api/credentials/' + encodeURIComponent(serverId));
    };

    api.storeSessionCredential = function (serverId, username, password) {
        return request('POST', '/api/credentials/session', {
            serverId: serverId,
            username: username,
            password: password
        });
    };

    // ── Client Subnets ────────────────────────────────────────

    api.listSubnets = function (server, serverId, credentialMode) {
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (serverId) params.push('serverId=' + encodeURIComponent(serverId));
        if (credentialMode) params.push('credentialMode=' + encodeURIComponent(credentialMode));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('GET', '/api/subnets' + qs);
    };

    api.createSubnet = function (data) {
        return request('POST', '/api/subnets', data);
    };

    api.deleteSubnet = function (name, server, serverId, credentialMode) {
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (serverId) params.push('serverId=' + encodeURIComponent(serverId));
        if (credentialMode) params.push('credentialMode=' + encodeURIComponent(credentialMode));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('DELETE', '/api/subnets/' + encodeURIComponent(name) + qs);
    };

    // ── Zone Scopes ─────────────────────────────────────────

    api.listZoneScopes = function (zone, server, serverId, credentialMode) {
        var params = [];
        if (zone) params.push('zone=' + encodeURIComponent(zone));
        if (server) params.push('server=' + encodeURIComponent(server));
        if (serverId) params.push('serverId=' + encodeURIComponent(serverId));
        if (credentialMode) params.push('credentialMode=' + encodeURIComponent(credentialMode));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('GET', '/api/zonescopes' + qs);
    };

    api.createZoneScope = function (data) {
        return request('POST', '/api/zonescopes', data);
    };

    api.deleteZoneScope = function (name, zone, server, serverId, credentialMode) {
        var params = [];
        if (zone) params.push('zone=' + encodeURIComponent(zone));
        if (server) params.push('server=' + encodeURIComponent(server));
        if (serverId) params.push('serverId=' + encodeURIComponent(serverId));
        if (credentialMode) params.push('credentialMode=' + encodeURIComponent(credentialMode));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('DELETE', '/api/zonescopes/' + encodeURIComponent(name) + qs);
    };

    api.addZoneScopeRecord = function (data) {
        return request('POST', '/api/zonescopes/records', data);
    };

    // ── Recursion Scopes ────────────────────────────────────

    api.listRecursionScopes = function (server, serverId, credentialMode) {
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (serverId) params.push('serverId=' + encodeURIComponent(serverId));
        if (credentialMode) params.push('credentialMode=' + encodeURIComponent(credentialMode));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('GET', '/api/recursionscopes' + qs);
    };

    api.createRecursionScope = function (data) {
        return request('POST', '/api/recursionscopes', data);
    };

    api.setRecursionScope = function (name, data) {
        return request('PUT', '/api/recursionscopes/' + encodeURIComponent(name), data);
    };

    api.deleteRecursionScope = function (name, server, serverId, credentialMode) {
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (serverId) params.push('serverId=' + encodeURIComponent(serverId));
        if (credentialMode) params.push('credentialMode=' + encodeURIComponent(credentialMode));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('DELETE', '/api/recursionscopes/' + encodeURIComponent(name) + qs);
    };

    // ── Zone Transfer Policies ──────────────────────────────

    api.listZoneTransferPolicies = function (server, zone, serverId, credentialMode) {
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (zone) params.push('zone=' + encodeURIComponent(zone));
        if (serverId) params.push('serverId=' + encodeURIComponent(serverId));
        if (credentialMode) params.push('credentialMode=' + encodeURIComponent(credentialMode));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('GET', '/api/transferpolicies' + qs);
    };

    api.addZoneTransferPolicy = function (policy) {
        return request('POST', '/api/transferpolicies', policy);
    };

    api.removeZoneTransferPolicy = function (name, server, zone, serverId, credentialMode) {
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (zone) params.push('zone=' + encodeURIComponent(zone));
        if (serverId) params.push('serverId=' + encodeURIComponent(serverId));
        if (credentialMode) params.push('credentialMode=' + encodeURIComponent(credentialMode));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('DELETE', '/api/transferpolicies/' + encodeURIComponent(name) + qs);
    };

    // ── Policy State ────────────────────────────────────────

    api.setPolicyState = function (name, isEnabled, server, zone, policyType) {
        var params = [];
        if (server) params.push('server=' + encodeURIComponent(server));
        if (zone) params.push('zone=' + encodeURIComponent(zone));
        if (policyType) params.push('type=' + encodeURIComponent(policyType));
        var qs = params.length ? '?' + params.join('&') : '';
        return request('PUT', '/api/policies/' + encodeURIComponent(name) + '/state' + qs, {
            isEnabled: isEnabled
        });
    };

    // ── Multi-Server ─────────────────────────────────────────

    api.connectServer = function (serverObj) {
        return request('POST', '/api/connect', {
            server: serverObj.hostname,
            serverId: serverObj.id,
            credentialMode: serverObj.credentialMode
        });
    };

    api.addPolicyMulti = function (policy, servers) {
        return request('POST', '/api/policies/multi', {
            policy: policy,
            servers: servers
        });
    };

    api.copyPolicies = function (sourceServer, targetServers, zone, sourceServerId, sourceCredentialMode) {
        return request('POST', '/api/policies/copy', {
            sourceServer: sourceServer,
            targetServers: targetServers,
            zone: zone || null,
            sourceServerId: sourceServerId || null,
            sourceCredentialMode: sourceCredentialMode || 'currentUser'
        });
    };

    // ── Health Check Polling ────────────────────────────────

    function updateBridgeStatus(connected, info) {
        var wasConnected = state.bridgeConnected;
        state.bridgeConnected = connected;

        // Update UI indicator
        var dot = document.getElementById('bridgeStatusDot');
        var label = document.getElementById('bridgeStatusLabel');
        var modeToggle = document.getElementById('executionModeToggle');

        if (dot && label) {
            if (connected) {
                dot.className = 'bridge-dot connected';
                label.textContent = 'Bridge: Connected';
            } else {
                dot.className = 'bridge-dot offline';
                label.textContent = 'Bridge: Offline';
            }
        }

        if (modeToggle) {
            modeToggle.style.display = connected ? 'flex' : 'none';
        }

        // Notify on status change
        if (wasConnected && !connected) {
            NS.toast.warning('Bridge connection lost. Falling back to command generation.');
            state.executionMode = 'generate';
            var toggle = document.getElementById('executionModeSwitch');
            if (toggle) toggle.checked = false;
        } else if (!wasConnected && connected) {
            NS.toast.success('Bridge connected.');
        }
    }

    api.checkBridge = function () {
        var dot = document.getElementById('bridgeStatusDot');
        if (dot) dot.className = 'bridge-dot checking';

        return api.health().then(function (result) {
            updateBridgeStatus(result.success && result.status === 'ok', result);
            return result;
        });
    };

    api.startHealthCheck = function () {
        if (healthTimer) clearInterval(healthTimer);
        healthTimer = setInterval(function () {
            api.checkBridge();
        }, HEALTH_INTERVAL);
    };

    api.stopHealthCheck = function () {
        if (healthTimer) {
            clearInterval(healthTimer);
            healthTimer = null;
        }
    };

    NS.api = api;
})();
