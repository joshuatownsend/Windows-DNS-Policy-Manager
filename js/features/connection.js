/* ── Server Connection ─────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    NS.toggleCredentialFields = function toggleCredentialFields() {
        var connectionType = document.getElementById('connectionType').value;
        var credentialFields = document.getElementById('credentialFields');

        if (connectionType === 'remote') {
            credentialFields.style.display = 'block';
        } else {
            credentialFields.style.display = 'none';
        }
    };

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
    function renderServerInfo(serverName, result) {
        var panel = document.getElementById('serverInfoPanel');
        var grid = document.getElementById('serverInfoGrid');
        if (!panel || !grid) return;

        while (grid.firstChild) {
            grid.removeChild(grid.firstChild);
        }

        var items = [
            { label: 'Server', value: serverName },
            { label: 'Hostname', value: result.hostname || serverName },
            { label: 'Zones', value: (result.zoneCount || 0) + ' zones found' },
            { label: 'Connection', value: state.connection.type === 'remote' ? 'Remote (Credentials)' : 'Local (Current User)' },
            { label: 'Status', value: 'Connected' }
        ];

        if (result.dnsModuleAvailable !== undefined) {
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
    }

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
            card.className = 'zone-card';
            card.setAttribute('role', 'listitem');

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
    };

    /**
     * Refresh zones from the server.
     */
    NS.refreshZones = function refreshZones() {
        if (!state.bridgeConnected || !NS.api) {
            NS.toast.info('Bridge is offline. Cannot refresh zones.');
            return;
        }

        var server = document.getElementById('dnsServer').value || 'localhost';
        NS.api.listZones(server).then(function (result) {
            if (result.success && result.zones) {
                state.serverZones = result.zones;
                NS.renderZones(result.zones);
                populateZoneDatalist(result.zones);
                NS.toast.success('Zones refreshed.');
            } else {
                NS.toast.error('Failed to load zones: ' + (result.error || 'Unknown error'));
            }
        });
    };

    /**
     * Load zones from the DNS server and populate the datalist.
     */
    NS.loadZones = function loadZones(server) {
        if (!state.bridgeConnected || !NS.api) return;

        NS.api.listZones(server).then(function (result) {
            if (result.success && result.zones) {
                state.serverZones = result.zones;
                populateZoneDatalist(result.zones);
                NS.renderZones(result.zones);
            }
        });
    };

    NS.testConnection = function testConnection() {
        var dnsServer = document.getElementById('dnsServer').value;
        var statusElement = document.getElementById('connectionStatus');

        if (!dnsServer) {
            statusElement.textContent = 'Please enter a DNS server';
            statusElement.className = 'connection-status error';
            return;
        }

        statusElement.textContent = 'Testing connection...';
        statusElement.className = 'connection-status testing';

        // If bridge is connected, use real connection test
        if (state.bridgeConnected && NS.api) {
            var connectionType = document.getElementById('connectionType').value;
            var btn = document.querySelector('[data-action="testConnection"]');
            if (btn) btn.classList.add('loading');

            NS.api.connect(dnsServer, connectionType).then(function (result) {
                if (btn) btn.classList.remove('loading');

                if (result.success) {
                    state.connection.server = dnsServer;
                    state.connection.type = connectionType;
                    state.connection.status = 'connected';

                    statusElement.textContent = 'Connected to ' + result.serverName + ' (' + result.zoneCount + ' zones)';
                    statusElement.className = 'connection-status success';

                    // Store zones and populate UI
                    if (result.zones) {
                        state.serverZones = result.zones;
                        populateZoneDatalist(result.zones);
                        NS.renderZones(result.zones);
                    }

                    // Show server info panel
                    renderServerInfo(dnsServer, result);

                    NS.toast.success('Connected to DNS server: ' + result.serverName);
                } else {
                    state.connection.status = 'error';
                    statusElement.textContent = result.error || 'Connection failed';
                    statusElement.className = 'connection-status error';

                    // Hide info panels on failure
                    var infoPanel = document.getElementById('serverInfoPanel');
                    var zonesPanel = document.getElementById('serverZonesPanel');
                    if (infoPanel) infoPanel.style.display = 'none';
                    if (zonesPanel) zonesPanel.style.display = 'none';

                    NS.toast.error(result.error || 'Connection failed');
                }
            });
            return;
        }

        // Fallback: generate test commands (original behavior)
        setTimeout(function () {
            statusElement.textContent = 'Connection test commands generated \u2014 check PowerShell tab';
            statusElement.className = 'connection-status success';

            var output = document.getElementById('powershellOutput');
            var serverParam = dnsServer !== 'localhost' ? ' -ComputerName "' + dnsServer + '"' : '';

            var pre = document.createElement('pre');
            pre.textContent =
                '# DNS Server Connection Test\n' +
                '# Target Server: ' + dnsServer + '\n\n' +
                '# Run this command to test the connection:\n' +
                'Test-NetConnection -ComputerName "' + dnsServer + '" -Port 53\n\n' +
                '# To check DNS Server service:\n' +
                'Get-Service DNS' + serverParam + '\n\n' +
                '# To verify DNS cmdlets are available:\n' +
                'Get-Command *DnsServer* | Select-Object Name, ModuleName';
            output.textContent = '';
            output.appendChild(pre);

            NS.showTab('powershell');
            NS.toast.success('Connection test commands generated.');
        }, 1500);
    };
})();
