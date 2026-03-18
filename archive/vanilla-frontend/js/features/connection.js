/* ── Server Connection ─────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    /**
     * Populate the zone name datalist for autocomplete.
     */
    function populateZoneDatalist(zones) {
        var datalist = document.getElementById('zoneNameList');
        if (!datalist) return;
        while (datalist.firstChild) {
            datalist.removeChild(datalist.firstChild);
        }
        zones.forEach(function (z) {
            var option = document.createElement('option');
            option.value = z.ZoneName;
            datalist.appendChild(option);
        });
    }

    /**
     * Render server info cards in the Server tab.
     */
    NS.renderServerInfo = function renderServerInfo(serverName, result, serverObj) {
        var panel = document.getElementById('serverInfoPanel');
        var grid = document.getElementById('serverInfoGrid');
        if (!panel || !grid) return;

        while (grid.firstChild) {
            grid.removeChild(grid.firstChild);
        }

        var credModeLabels = {
            currentUser: 'Current User (Kerberos/NTLM)',
            savedCredential: 'Saved Credential (DPAPI)',
            session: 'Session Only'
        };

        var items = [
            { label: 'Server', value: serverName },
            { label: 'Hostname', value: (result && result.hostname) || (serverObj && serverObj.hostname) || serverName },
            { label: 'Zones', value: ((result && result.zoneCount) || (serverObj && serverObj.zoneCount) || 0) + ' zones found' },
            { label: 'Authentication', value: serverObj ? (credModeLabels[serverObj.credentialMode] || serverObj.credentialMode) : 'Current User' },
            { label: 'Status', value: 'Connected' }
        ];

        if (result && result.dnsModuleAvailable !== undefined) {
            items.push({ label: 'DNS Module', value: result.dnsModuleAvailable ? 'Available' : 'Not Found' });
        }

        items.forEach(function (item) {
            var card = document.createElement('div');
            card.className = 'server-info-item';

            var labelEl = document.createElement('div');
            labelEl.className = 'server-info-label';
            labelEl.textContent = item.label;

            var valueEl = document.createElement('div');
            valueEl.className = 'server-info-value';
            valueEl.textContent = item.value;

            card.appendChild(labelEl);
            card.appendChild(valueEl);
            grid.appendChild(card);
        });

        panel.style.display = 'block';
    };

    /**
     * Render DNS zones as cards in the Server tab.
     */
    NS.renderZones = function renderZones(zones) {
        var panel = document.getElementById('serverZonesPanel');
        var list = document.getElementById('zonesList');
        var countEl = document.getElementById('zoneCount');
        if (!panel || !list) return;

        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        if (!zones || zones.length === 0) {
            panel.style.display = 'none';
            return;
        }

        if (countEl) {
            countEl.textContent = zones.length + ' zone' + (zones.length !== 1 ? 's' : '');
        }

        zones.forEach(function (z) {
            var card = document.createElement('div');
            card.className = 'zone-card clickable';
            card.setAttribute('role', 'listitem');
            card.setAttribute('data-action', 'navigateToZone');
            card.setAttribute('data-zone', z.ZoneName);
            card.style.cursor = 'pointer';

            var nameEl = document.createElement('div');
            nameEl.className = 'zone-card-name';
            nameEl.textContent = z.ZoneName;

            var metaEl = document.createElement('div');
            metaEl.className = 'zone-card-meta';

            var typeBadge = document.createElement('span');
            typeBadge.className = 'zone-badge type-primary';
            typeBadge.textContent = z.ZoneType || 'Primary';
            metaEl.appendChild(typeBadge);

            if (z.IsDsIntegrated) {
                var adBadge = document.createElement('span');
                adBadge.className = 'zone-badge type-ad';
                adBadge.textContent = 'AD-Integrated';
                metaEl.appendChild(adBadge);
            }

            if (z.IsReverseLookupZone) {
                var revBadge = document.createElement('span');
                revBadge.className = 'zone-badge type-secondary';
                revBadge.textContent = 'Reverse';
                metaEl.appendChild(revBadge);
            }

            card.appendChild(nameEl);
            card.appendChild(metaEl);
            list.appendChild(card);
        });

        panel.style.display = 'block';

        // Also update zone datalist
        populateZoneDatalist(zones);
    };

    /**
     * Refresh zones from the active server.
     */
    NS.refreshZones = function refreshZones() {
        if (!state.bridgeConnected || !NS.api) {
            NS.toast.info('Bridge is offline. Cannot refresh zones.');
            return;
        }

        var server = NS.getActiveServer ? NS.getActiveServer() : null;
        if (!server) {
            NS.toast.info('No active server selected.');
            return;
        }

        NS.api.connectServer(server).then(function (result) {
            if (result.success && result.zones) {
                state.serverZones = result.zones;
                server.zoneCount = result.zoneCount || result.zones.length;
                NS.renderZones(result.zones);
                NS.toast.success('Zones refreshed.');
            } else {
                NS.toast.error('Failed to load zones: ' + (result.error || 'Unknown error'));
            }
        });
    };

    /**
     * Load zones from a specific server.
     */
    NS.loadZones = function loadZones(serverId) {
        if (!state.bridgeConnected || !NS.api) return;

        var server;
        if (serverId && NS.getActiveServer) {
            for (var i = 0; i < state.servers.length; i++) {
                if (state.servers[i].id === serverId) {
                    server = state.servers[i];
                    break;
                }
            }
        }

        if (!server) return;

        NS.api.connectServer(server).then(function (result) {
            if (result.success && result.zones) {
                state.serverZones = result.zones;
                populateZoneDatalist(result.zones);
                NS.renderZones(result.zones);
            }
        });
    };
})();
