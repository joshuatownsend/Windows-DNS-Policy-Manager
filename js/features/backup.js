/* ── Backup & Export ───────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    NS.generateBackupScript = function generateBackupScript() {
        var backupServer = document.getElementById('backupServer').value || 'localhost';
        var backupFormat = document.getElementById('backupFormat').value;
        var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        var serverParam = backupServer !== 'localhost' ? ' -ComputerName "' + backupServer + '"' : '';

        var script =
            '# DNS Policy Backup Script\n' +
            '# Generated: ' + new Date().toLocaleString() + '\n' +
            '# Target Server: ' + backupServer + '\n\n' +
            '# Get all policies\n' +
            '$policies = Get-DnsServerQueryResolutionPolicy' + serverParam + '\n\n' +
            '# Export to ' + backupFormat.toUpperCase() + '\n' +
            '$policies | Export-Clixml -Path "DNS-Policies-Backup-' + timestamp + '.xml"\n' +
            'Write-Host "Backup saved to DNS-Policies-Backup-' + timestamp + '.xml"';

        document.getElementById('backupCommands').textContent = script;
        document.getElementById('backupOutput').style.display = 'block';
        NS.toast.success('Backup script generated.');
    };

    NS.exportCurrentPolicies = function exportCurrentPolicies() {
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
