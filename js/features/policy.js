/* ── Policy Generation & Management ────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    var parameterMap = {
        ClientSubnet:      'ClientSubnet',
        FQDN:              'FQDN',
        QType:             'QType',
        ServerInterface:   'ServerInterface',
        InternetProtocol:  'InternetProtocol',
        TransportProtocol: 'TransportProtocol',
        TimeOfDay:         'TimeOfDay'
    };

    function getCriteriaParameterName(type) {
        return parameterMap[type] || type;
    }

    /**
     * Helper: set the powershell output panel content safely using textContent.
     */
    function setPowershellOutput(text) {
        var output = document.getElementById('powershellOutput');
        var pre = document.createElement('pre');
        pre.textContent = text;
        output.textContent = '';
        output.appendChild(pre);
    }

    /**
     * Collect policy data from the form into a plain object.
     */
    function collectPolicyData() {
        var dnsServer = document.getElementById('dnsServer').value;
        var policyName = document.getElementById('policyName').value.trim();
        var policyAction = document.getElementById('policyAction').value;
        var policyLevel = document.getElementById('policyLevel').value;
        var zoneName = document.getElementById('zoneName').value.trim();
        var condition = document.getElementById('condition').value;
        var processingOrder = document.getElementById('processingOrder').value;

        var criteriaElements = document.querySelectorAll('.criteria-item');
        var criteria = [];

        for (var i = 0; i < criteriaElements.length; i++) {
            var el = criteriaElements[i];
            var type = el.querySelector('.criteria-type').value;
            var operator = el.querySelector('.criteria-operator').value;
            var values = el.querySelector('.criteria-values').value
                .split(',').map(function (v) { return v.trim(); }).filter(function (v) { return v; });

            if (values.length > 0) {
                criteria.push({ type: type, operator: operator, values: values });
            }
        }

        var scopes = [];
        if (policyAction === 'ALLOW') {
            var scopeElements = document.querySelectorAll('.scope-item');
            for (var j = 0; j < scopeElements.length; j++) {
                var name = scopeElements[j].querySelector('.scope-name').value.trim();
                var weight = parseInt(scopeElements[j].querySelector('.scope-weight').value, 10) || 1;
                if (name) {
                    scopes.push({ name: name, weight: weight });
                }
            }
        }

        return {
            server: dnsServer,
            name: policyName,
            action: policyAction,
            level: policyLevel,
            zoneName: (policyLevel === 'Zone' && zoneName) ? zoneName : null,
            criteria: criteria,
            scopes: scopes,
            condition: condition,
            processingOrder: parseInt(processingOrder, 10) || 1
        };
    }

    /**
     * Build the PowerShell command string from policy data.
     */
    function buildCommand(data) {
        var cmd = 'Add-DnsServerQueryResolutionPolicy -Name "' + data.name + '" -Action ' + data.action;

        if (data.zoneName) {
            cmd += ' -ZoneName "' + data.zoneName + '"';
        }

        data.criteria.forEach(function (c) {
            cmd += ' -' + getCriteriaParameterName(c.type) + ' "' + c.operator + ',' + c.values.join(',') + '"';
        });

        if (data.criteria.length > 1) {
            cmd += ' -Condition ' + data.condition;
        }

        if (data.processingOrder) {
            cmd += ' -ProcessingOrder ' + data.processingOrder;
        }

        if (data.action === 'ALLOW' && data.scopes.length > 0) {
            var scopeStr = data.scopes.map(function (s) { return s.name + ',' + s.weight; }).join(';');
            cmd += ' -ZoneScope "' + scopeStr + '"';
        }

        if (data.server !== 'localhost') {
            cmd += ' -ComputerName "' + data.server + '"';
        }

        cmd += ' -PassThru';
        return cmd;
    }

    NS.generatePolicy = function generatePolicy() {
        if (!NS.validatePolicyForm()) return;

        var data = collectPolicyData();
        var cmd = buildCommand(data);

        // If execute mode is active and bridge is connected, create on server
        if (state.executionMode === 'execute' && state.bridgeConnected && NS.api) {
            var btn = document.querySelector('[data-action="generatePolicy"]');
            if (btn) btn.classList.add('loading');

            NS.api.addPolicy(data).then(function (result) {
                if (btn) btn.classList.remove('loading');

                if (result.success) {
                    // Show the command that was executed
                    var timestamp = new Date().toLocaleString();
                    setPowershellOutput(
                        '# Policy Executed on Server - ' + timestamp + '\n' +
                        '# Target DNS Server: ' + data.server + '\n' +
                        '# Status: SUCCESS\n\n' +
                        cmd
                    );
                    NS.showTab('powershell');

                    // Add to local list with server source flag
                    state.policies.push({
                        name: data.name,
                        action: data.action,
                        level: data.level,
                        zoneName: data.zoneName,
                        criteria: data.criteria,
                        scopes: data.scopes,
                        condition: data.condition,
                        processingOrder: data.processingOrder,
                        server: data.server,
                        fromServer: true
                    });

                    NS.renderPolicies();
                    NS.toast.success('Policy "' + data.name + '" created on server.');
                } else {
                    NS.toast.error('Failed to create policy: ' + (result.error || 'Unknown error'));
                    // Still show the command for manual execution
                    showGeneratedCommand(data, cmd);
                }
            });
            return;
        }

        // Fallback: generate command only (original behavior)
        showGeneratedCommand(data, cmd);
        state.policies.push({
            name: data.name,
            action: data.action,
            level: data.level,
            zoneName: data.zoneName,
            criteria: data.criteria,
            scopes: data.scopes,
            condition: data.condition,
            processingOrder: data.processingOrder,
            server: data.server,
            fromServer: false
        });

        NS.renderPolicies();
        NS.toast.success('Policy "' + data.name + '" generated successfully.');
    };

    function showGeneratedCommand(data, cmd) {
        var timestamp = new Date().toLocaleString();
        var zoneParam = data.zoneName ? ' -ZoneName "' + data.zoneName + '"' : '';
        var serverParam = data.server !== 'localhost' ? ' -ComputerName "' + data.server + '"' : '';

        setPowershellOutput(
            '# Generated DNS Policy Command - ' + timestamp + '\n' +
            '# Target DNS Server: ' + data.server + '\n\n' +
            cmd + '\n\n' +
            '# To remove this policy, use:\n' +
            'Remove-DnsServerQueryResolutionPolicy -Name "' + data.name + '"' + zoneParam + serverParam + '\n\n' +
            '# To view existing policies, use:\n' +
            'Get-DnsServerQueryResolutionPolicy' + zoneParam + serverParam
        );

        NS.showTab('powershell');
    }

    /**
     * Render policy list using safe DOM methods (no innerHTML with user data).
     */
    NS.renderPolicies = function renderPolicies() {
        var policyList = document.getElementById('policyList');
        while (policyList.firstChild) {
            policyList.removeChild(policyList.firstChild);
        }

        state.policies.forEach(function (policy, index) {
            var div = document.createElement('div');
            div.className = 'policy-item' + (state.selectedPolicy === index ? ' selected' : '');
            div.setAttribute('role', 'listitem');
            div.setAttribute('tabindex', '0');
            div.setAttribute('data-action', 'selectPolicy');
            div.setAttribute('data-index', index);

            var nameEl = document.createElement('div');
            nameEl.className = 'policy-name';
            nameEl.textContent = policy.name;

            var actionEl = document.createElement('div');
            actionEl.className = 'policy-action action-' + policy.action.toLowerCase();
            actionEl.textContent = policy.action;

            var detailsEl = document.createElement('div');
            detailsEl.className = 'policy-details';
            var detailLines = ['Level: ' + (policy.level || policy.Level || 'Server')];
            if (policy.zoneName || policy.ZoneName) {
                detailLines.push('Zone: ' + (policy.zoneName || policy.ZoneName));
            }
            if (policy.criteria && policy.criteria.length) {
                var criteriaText = policy.criteria.map(function (c) {
                    return c.type + ': ' + c.values.join(', ');
                }).join(' | ');
                detailLines.push('Criteria: ' + criteriaText);
            }
            detailsEl.textContent = detailLines.join(' \u2022 ');

            div.appendChild(nameEl);
            div.appendChild(actionEl);
            div.appendChild(detailsEl);

            // Delete button for server-sourced policies
            if (policy.fromServer && state.bridgeConnected) {
                var deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete-policy';
                deleteBtn.setAttribute('data-action', 'removePolicy');
                deleteBtn.setAttribute('data-index', index);
                deleteBtn.setAttribute('aria-label', 'Delete policy ' + policy.name);
                deleteBtn.textContent = '\u00D7';
                div.appendChild(deleteBtn);
            }

            policyList.appendChild(div);
        });

        // Toggle empty state in policies tab
        if (NS.updatePoliciesEmptyState) {
            NS.updatePoliciesEmptyState();
        }
    };

    NS.selectPolicy = function selectPolicy(index) {
        state.selectedPolicy = index;
        NS.renderPolicies();
    };

    NS.removePolicy = function removePolicy(index) {
        var policy = state.policies[index];
        if (!policy) return;

        if (!state.bridgeConnected || !NS.api) {
            NS.toast.warning('Bridge is offline. Cannot delete from server.');
            return;
        }

        NS.api.removePolicy(
            policy.name,
            policy.server || state.connection.server,
            policy.zoneName || policy.ZoneName
        ).then(function (result) {
            if (result.success) {
                state.policies.splice(index, 1);
                if (state.selectedPolicy === index) {
                    state.selectedPolicy = null;
                } else if (state.selectedPolicy !== null && state.selectedPolicy > index) {
                    state.selectedPolicy--;
                }
                NS.renderPolicies();
                NS.toast.success('Policy "' + policy.name + '" removed from server.');
            } else {
                NS.toast.error('Failed to remove: ' + (result.error || 'Unknown error'));
            }
        });
    };

    NS.exportPolicy = function exportPolicy() {
        var output = document.getElementById('powershellOutput');
        var text = output.textContent;

        if (!text.includes('Generated DNS Policy Command') && !text.includes('Policy Executed')) {
            NS.toast.warning('Please generate a policy first.');
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                NS.toast.success('PowerShell commands copied to clipboard!');
            }).catch(function () {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    };

    function fallbackCopy(text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            NS.toast.success('PowerShell commands copied to clipboard!');
        } catch (e) {
            NS.toast.error('Could not copy to clipboard. Please select and copy the text manually.');
        }
        document.body.removeChild(textarea);
    }

    NS.loadSamplePolicies = function loadSamplePolicies() {
        state.policies = [
            {
                name: 'BlockMalware',
                action: 'IGNORE',
                level: 'Server',
                criteria: [{ type: 'FQDN', operator: 'EQ', values: ['*.malware.com', '*.suspicious.net'] }],
                condition: 'AND',
                processingOrder: 1,
                fromServer: false
            },
            {
                name: 'GeoRouting',
                action: 'ALLOW',
                level: 'Zone',
                zoneName: 'contoso.com',
                criteria: [{ type: 'ClientSubnet', operator: 'EQ', values: ['USSubnet'] }],
                scopes: [{ name: 'USScope', weight: 3 }, { name: 'EuropeScope', weight: 1 }],
                condition: 'AND',
                processingOrder: 2,
                fromServer: false
            }
        ];
        NS.renderPolicies();
    };

    NS.loadPolicies = function loadPolicies() {
        if (!state.bridgeConnected || !NS.api) {
            NS.toast.info('Bridge is offline. Connect to a DNS server via the bridge to load live policies.');
            return;
        }

        var server = document.getElementById('dnsServer').value || 'localhost';
        var btn = document.querySelector('[data-action="loadPolicies"]');
        if (btn) btn.classList.add('loading');

        NS.api.listPolicies(server).then(function (result) {
            if (btn) btn.classList.remove('loading');

            if (result.success) {
                // Map server policy format to our format
                state.policies = (result.policies || []).map(function (p) {
                    return {
                        name: p.Name,
                        action: p.Action,
                        level: p.Level || 'Server',
                        zoneName: p.ZoneName || null,
                        criteria: [],
                        condition: p.Condition || 'AND',
                        processingOrder: p.ProcessingOrder || 1,
                        server: server,
                        fromServer: true
                    };
                });
                NS.renderPolicies();
                NS.toast.success('Loaded ' + state.policies.length + ' policies from server.');
            } else {
                NS.toast.error('Failed to load policies: ' + (result.error || 'Unknown error'));
            }
        });
    };
})();
