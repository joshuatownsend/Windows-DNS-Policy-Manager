/* ── Server Connection ─────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};

    NS.toggleCredentialFields = function toggleCredentialFields() {
        var connectionType = document.getElementById('connectionType').value;
        var credentialFields = document.getElementById('credentialFields');

        if (connectionType === 'remote') {
            credentialFields.style.display = 'block';
        } else {
            credentialFields.style.display = 'none';
        }
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

        setTimeout(function () {
            statusElement.textContent = 'Connection test commands generated \u2014 check PowerShell tab';
            statusElement.className = 'connection-status success';

            var output = document.getElementById('powershellOutput');
            var serverParam = dnsServer !== 'localhost' ? ' -ComputerName "' + dnsServer + '"' : '';

            // Build output using safe DOM methods
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
