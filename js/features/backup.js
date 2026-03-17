/* ── Backup & Export ───────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    /**
     * Resolve server info from the backup server select.
     * Returns { hostname, id, credentialMode }.
     */
    function getBackupServer() {
        var select = document.getElementById('backupServer');
        if (!select) return { hostname: 'localhost', id: null, credentialMode: 'currentUser' };

        var serverId = select.value;
        for (var i = 0; i < state.servers.length; i++) {
            if (state.servers[i].id === serverId) {
                return state.servers[i];
            }
        }

        // Fallback
        return { hostname: 'localhost', id: null, credentialMode: 'currentUser' };
    }

    NS.generateBackupScript = function generateBackupScript() {
        var server = getBackupServer();
        var backupServer = server.hostname;
        var backupFormat = document.getElementById('backupFormat').value;
        var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        var serverParam = backupServer !== 'localhost' ? ' -ComputerName "' + backupServer + '"' : '';

        var exportCmd, ext;
        if (backupFormat === 'json') {
            ext = 'json';
            exportCmd = '$policies | ConvertTo-Json -Depth 10 | Out-File -FilePath "DNS-Policies-Backup-' + timestamp + '.json" -Encoding UTF8';
        } else if (backupFormat === 'powershell') {
            ext = 'ps1';
            exportCmd =
                '# Re-create commands\n' +
                '$policies | ForEach-Object {\n' +
                '    $cmd = "Add-DnsServerQueryResolutionPolicy -Name ""$($_.Name)"" -Action $($_.Action)' + serverParam + ' -PassThru"\n' +
                '    $cmd | Out-File -Append -FilePath "DNS-Policies-Backup-' + timestamp + '.ps1" -Encoding UTF8\n' +
                '}';
        } else {
            ext = 'xml';
            exportCmd = '$policies | Export-Clixml -Path "DNS-Policies-Backup-' + timestamp + '.xml"';
        }

        var script =
            '# DNS Policy Backup Script\n' +
            '# Generated: ' + new Date().toLocaleString() + '\n' +
            '# Target Server: ' + backupServer + '\n\n' +
            '# Get all policies\n' +
            '$policies = Get-DnsServerQueryResolutionPolicy' + serverParam + '\n\n' +
            '# Export to ' + backupFormat.toUpperCase() + '\n' +
            exportCmd + '\n' +
            'Write-Host "Backup saved to DNS-Policies-Backup-' + timestamp + '.' + ext + '"';

        document.getElementById('backupCommands').textContent = script;
        document.getElementById('backupOutput').style.display = 'block';
        NS.toast.success('Backup script generated.');
    };

    /**
     * Backup policies directly from the server via bridge.
     */
    NS.backupFromServer = function backupFromServer() {
        if (!state.bridgeConnected || !NS.api) {
            NS.toast.info('Bridge offline. Use "Generate Backup Script" to create a PowerShell script instead.');
            return;
        }

        var server = getBackupServer();
        var includeZone = document.getElementById('includeZonePolicies').checked;
        var includeServer = document.getElementById('includeServerPolicies').checked;

        var btn = document.querySelector('[data-action="backupFromServer"]');
        if (btn) btn.classList.add('loading');

        NS.api.backup(server.hostname, includeZone, includeServer).then(function (result) {
            if (btn) btn.classList.remove('loading');

            if (result.success && result.backup) {
                var content = JSON.stringify(result.backup, null, 2);
                var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                var fileName = 'dns-policies-backup-' + timestamp + '.json';
                NS.downloadFile(content, fileName, 'application/json');

                var count = result.backup.policies ? result.backup.policies.length : 0;
                NS.toast.success('Backed up ' + count + ' policies to ' + fileName);
            } else {
                NS.toast.error('Backup failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    NS.exportCurrentPolicies = function exportCurrentPolicies() {
        // If bridge is connected, use real backup
        if (state.bridgeConnected && NS.api) {
            NS.backupFromServer();
            return;
        }

        if (state.policies.length === 0) {
            NS.toast.warning('No policies to export. Create some policies first.');
            return;
        }

        var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        var backup = {
            backupDate: new Date().toISOString(),
            version: '1.0',
            policies: state.policies
        };

        var content = JSON.stringify(backup, null, 2);
        var fileName = 'dns-policies-backup-' + timestamp + '.json';
        NS.downloadFile(content, fileName, 'application/json');
        NS.toast.success('Policies exported to ' + fileName);
    };
})();
