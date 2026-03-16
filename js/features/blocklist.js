/* ── Blocklist Import ──────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    NS.handleFileSelect = function handleFileSelect(input) {
        var file = input.files[0];
        var fileName = document.getElementById('selectedFileName');
        var previewBtn = document.getElementById('previewBtn');
        var importBtn = document.getElementById('importBtn');

        if (file) {
            fileName.textContent = file.name;

            var reader = new FileReader();
            reader.onload = function (e) {
                state.blocklistData = {
                    content: e.target.result,
                    fileName: file.name
                };
                previewBtn.disabled = false;
                importBtn.disabled = false;
            };
            reader.readAsText(file);
        } else {
            fileName.textContent = 'No file selected';
            previewBtn.disabled = true;
            importBtn.disabled = true;
            state.blocklistData = null;
        }
    };

    NS.parseBlocklistFile = function parseBlocklistFile(content, fileName) {
        var includeWildcards = document.getElementById('includeWildcards').checked;
        var skipComments = document.getElementById('skipComments').checked;
        var validateDomains = document.getElementById('validateDomains').checked;
        var csvColumn = (document.getElementById('csvColumn').value || 'domain').toLowerCase();

        var domains = [];

        if (fileName.endsWith('.csv')) {
            var lines = content.split('\n');
            if (lines.length === 0) {
                throw new Error('CSV file is empty.');
            }

            var headers = lines[0].split(',').map(function (h) { return h.trim().toLowerCase(); });
            var columnIndex = headers.indexOf(csvColumn);

            if (columnIndex === -1) {
                throw new Error(
                    'Column "' + csvColumn + '" not found in CSV. ' +
                    'Available columns: ' + headers.join(', ')
                );
            }

            for (var i = 1; i < lines.length; i++) {
                var columns = lines[i].split(',');
                if (columns.length > columnIndex) {
                    var domain = columns[columnIndex].trim().replace(/['"]/g, '');
                    if (domain) domains.push(domain);
                }
            }
        } else {
            domains = content.split('\n')
                .map(function (line) { return line.trim(); })
                .filter(function (line) {
                    if (!line) return false;
                    if (skipComments && (line.charAt(0) === '#' || line.indexOf('//') === 0)) return false;
                    return true;
                });
        }

        domains = domains.map(function (d) {
            d = d.replace(/^https?:\/\//, '').split('/')[0];
            if (includeWildcards && d.indexOf('*.') !== 0) {
                d = '*.' + d;
            }
            return d;
        });

        if (validateDomains) {
            var domainRegex = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
            domains = domains.filter(function (d) { return domainRegex.test(d); });
        }

        // Deduplicate
        var seen = {};
        var unique = [];
        for (var k = 0; k < domains.length; k++) {
            if (!seen[domains[k]]) {
                seen[domains[k]] = true;
                unique.push(domains[k]);
            }
        }
        return unique;
    };

    NS.previewBlocklist = function previewBlocklist() {
        if (!state.blocklistData) {
            NS.toast.warning('Please select a file first.');
            return;
        }

        try {
            var domains = NS.parseBlocklistFile(state.blocklistData.content, state.blocklistData.fileName);
            var maxDomains = parseInt(document.getElementById('maxDomains').value, 10) || 100;
            var totalPolicies = Math.ceil(domains.length / maxDomains);

            var previewContent = document.getElementById('previewContent');
            while (previewContent.firstChild) {
                previewContent.removeChild(previewContent.firstChild);
            }

            var statsDiv = document.createElement('div');
            statsDiv.className = 'policy-stats';

            var stat1 = document.createElement('div');
            stat1.className = 'stat-item';
            var num1 = document.createElement('div');
            num1.className = 'stat-number';
            num1.textContent = domains.length;
            var label1 = document.createElement('div');
            label1.className = 'stat-label';
            label1.textContent = 'Total Domains';
            stat1.appendChild(num1);
            stat1.appendChild(label1);

            var stat2 = document.createElement('div');
            stat2.className = 'stat-item';
            var num2 = document.createElement('div');
            num2.className = 'stat-number';
            num2.textContent = totalPolicies;
            var label2 = document.createElement('div');
            label2.className = 'stat-label';
            label2.textContent = 'Policies to Create';
            stat2.appendChild(num2);
            stat2.appendChild(label2);

            statsDiv.appendChild(stat1);
            statsDiv.appendChild(stat2);

            var heading = document.createElement('h5');
            heading.textContent = 'Sample Domains (first 20):';

            var domainListDiv = document.createElement('div');
            domainListDiv.className = 'domain-list';
            domainListDiv.textContent = domains.slice(0, 20).join('\n');

            previewContent.appendChild(statsDiv);
            previewContent.appendChild(heading);
            previewContent.appendChild(domainListDiv);

            document.getElementById('importPreview').style.display = 'block';
        } catch (error) {
            NS.toast.error('Error parsing file: ' + error.message);
        }
    };

    NS.importBlocklist = function importBlocklist() {
        if (!state.blocklistData) {
            NS.toast.warning('Please select a file first.');
            return;
        }

        try {
            var domains = NS.parseBlocklistFile(state.blocklistData.content, state.blocklistData.fileName);
            var policyName = document.getElementById('blocklistPolicyName').value || 'ImportedBlocklist';
            var action = document.getElementById('blocklistAction').value;
            var maxDomains = parseInt(document.getElementById('maxDomains').value, 10) || 100;
            var dnsServer = document.getElementById('dnsServer').value || 'localhost';

            var chunks = [];
            for (var i = 0; i < domains.length; i += maxDomains) {
                chunks.push(domains.slice(i, i + maxDomains));
            }

            // If execute mode and bridge connected, execute directly
            if (state.executionMode === 'execute' && state.bridgeConnected && NS.api) {
                var btn = document.getElementById('importBtn');
                if (btn) btn.classList.add('loading');

                var completed = 0;
                var failed = 0;

                var executeChunk = function (index) {
                    if (index >= chunks.length) {
                        if (btn) btn.classList.remove('loading');
                        NS.toast.success('Imported ' + domains.length + ' domains: ' + completed + ' policies created, ' + failed + ' failed.');
                        return;
                    }

                    var chunk = chunks[index];
                    var nameWithIndex = chunks.length > 1 ? policyName + '_' + (index + 1) : policyName;

                    NS.api.addPolicy({
                        name: nameWithIndex,
                        action: action,
                        server: dnsServer,
                        criteria: [{ type: 'FQDN', operator: 'EQ', values: chunk }]
                    }).then(function (result) {
                        if (result.success) {
                            completed++;
                        } else {
                            failed++;
                        }
                        executeChunk(index + 1);
                    });
                };

                executeChunk(0);
                return;
            }

            // Fallback: generate commands (original behavior)
            var commands =
                '# Blocklist Import - Generated ' + new Date().toLocaleString() + '\n' +
                '# Source File: ' + state.blocklistData.fileName + '\n' +
                '# Total Domains: ' + domains.length + '\n\n';

            chunks.forEach(function (chunk, index) {
                var nameWithIndex = chunks.length > 1 ? policyName + '_' + (index + 1) : policyName;
                var domainList = chunk.join(',');
                var serverParam = dnsServer !== 'localhost' ? ' -ComputerName "' + dnsServer + '"' : '';

                commands += 'Add-DnsServerQueryResolutionPolicy -Name "' + nameWithIndex + '" -Action ' + action +
                    ' -FQDN "EQ,' + domainList + '"' + serverParam + ' -PassThru\n\n';
            });

            var output = document.getElementById('powershellOutput');
            var pre = document.createElement('pre');
            pre.textContent = commands;
            output.textContent = '';
            output.appendChild(pre);

            NS.showTab('powershell');
            NS.toast.success('Imported ' + domains.length + ' domains into ' + chunks.length + ' policy(ies).');
        } catch (error) {
            NS.toast.error('Error importing blocklist: ' + error.message);
        }
    };
})();
