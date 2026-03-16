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
     * Load zones from the DNS server and populate the datalist.
     */
    NS.loadZones = function loadZones(server) {
        if (!state.bridgeConnected || !NS.api) return;

        NS.api.listZones(server).then(function (result) {
            if (result.success && result.zones) {
                state.serverZones = result.zones;

                // Populate the datalist for zone name autocomplete
                var datalist = document.getElementById('zoneNameList');
                if (datalist) {
                    while (datalist.firstChild) {
                        datalist.removeChild(datalist.firstChild);
                    }
                    result.zones.forEach(function (z) {
                        var option = document.createElement('option');
                        option.value = z.ZoneName;
                        datalist.appendChild(option);
                    });
                }
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

            NS.api.connect(dnsServer, connectionType).then(function (result) {
                if (result.success) {
                    state.connection.server = dnsServer;
                    state.connection.type = connectionType;
                    state.connection.status = 'connected';

                    statusElement.textContent = 'Connected to ' + result.serverName + ' (' + result.zoneCount + ' zones)';
                    statusElement.className = 'connection-status success';

                    // Store zones and populate autocomplete directly from response
                    if (result.zones) {
                        state.serverZones = result.zones;
                        var datalist = document.getElementById('zoneNameList');
                        if (datalist) {
                            while (datalist.firstChild) {
                                datalist.removeChild(datalist.firstChild);
                            }
                            result.zones.forEach(function (z) {
                                var option = document.createElement('option');
                                option.value = z.ZoneName;
                                datalist.appendChild(option);
                            });
                        }
                    }

                    NS.toast.success('Connected to DNS server: ' + result.serverName);
                } else {
                    state.connection.status = 'error';
                    statusElement.textContent = result.error || 'Connection failed';
                    statusElement.className = 'connection-status error';
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
