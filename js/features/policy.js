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
        var policyName = document.getElementById('policyName').value.trim();
        var policyAction = document.getElementById('policyAction').value;
        var policyLevel = document.getElementById('policyLevel').value;
        var zoneName = document.getElementById('zoneName').value.trim();
        var condition = document.getElementById('condition').value;
        var processingOrder = document.getElementById('processingOrder').value;

        // Policy type (Query Resolution, Recursion, Zone Transfer)
        var policyTypeEl = document.getElementById('policyType');
        var policyType = policyTypeEl ? policyTypeEl.value : 'QueryResolution';

        // Recursion-specific fields
        var applyOnRecursion = policyType === 'Recursion';
        var recursionScopeEl = document.getElementById('recursionScopeSelect');
        var recursionScope = (applyOnRecursion && recursionScopeEl) ? recursionScopeEl.value : null;

        // Get target servers from checkboxes
        var targetServers = NS.getSelectedTargetServers ? NS.getSelectedTargetServers() : [];

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

        // Determine server from target servers or active server
        var server = 'localhost';
        if (targetServers.length > 0) {
            server = targetServers[0].hostname;
        } else if (state.activeServerId) {
            var activeServer = NS.getActiveServer ? NS.getActiveServer() : null;
            if (activeServer) server = activeServer.hostname;
        }

        return {
            server: server,
            targetServers: targetServers,
            name: policyName,
            action: policyAction,
            level: policyLevel,
            zoneName: (policyLevel === 'Zone' && zoneName) ? zoneName : null,
            criteria: criteria,
            scopes: scopes,
            condition: condition,
            processingOrder: parseInt(processingOrder, 10) || 1,
            policyType: policyType,
            applyOnRecursion: applyOnRecursion,
            recursionScope: recursionScope
        };
    }

    /**
     * Build the PowerShell command string from policy data.
     */
    function buildCommand(data, serverOverride) {
        var policyType = data.policyType || 'QueryResolution';
        var cmdlet = policyType === 'ZoneTransfer'
            ? 'Add-DnsServerZoneTransferPolicy'
            : 'Add-DnsServerQueryResolutionPolicy';

        var cmd = cmdlet + ' -Name "' + data.name + '" -Action ' + data.action;

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

        // Recursion policy
        if (policyType === 'Recursion' && data.applyOnRecursion) {
            cmd += ' -ApplyOnRecursion';
            if (data.recursionScope) {
                cmd += ' -RecursionScope "' + data.recursionScope + '"';
            }
        }

        // Zone scopes (only for non-recursion query resolution policies)
        if (policyType !== 'Recursion' && policyType !== 'ZoneTransfer' && data.action === 'ALLOW' && data.scopes.length > 0) {
            var scopeStr = data.scopes.map(function (s) { return s.name + ',' + s.weight; }).join(';');
            cmd += ' -ZoneScope "' + scopeStr + '"';
        }

        var host = serverOverride || data.server;
        if (host !== 'localhost') {
            cmd += ' -ComputerName "' + host + '"';
        }

        cmd += ' -PassThru';
        return cmd;
    }

    NS.generatePolicy = function generatePolicy() {
        if (!NS.validatePolicyForm()) return;

        var data = collectPolicyData();
        var targetServers = data.targetServers;

        if (targetServers.length === 0) {
            NS.toast.warning('Please select at least one target server.');
            return;
        }

        // Execute mode + bridge + multiple servers
        if (state.executionMode === 'execute' && state.bridgeConnected && NS.api) {
            var btn = document.querySelector('[data-action="generatePolicy"]');
            if (btn) btn.classList.add('loading');

            if (targetServers.length > 1) {
                // Multi-server execution
                var policyPayload = {
                    name: data.name,
                    action: data.action,
                    zoneName: data.zoneName,
                    criteria: data.criteria,
                    scopes: data.scopes,
                    condition: data.condition,
                    processingOrder: data.processingOrder
                };

                NS.api.addPolicyMulti(policyPayload, targetServers).then(function (result) {
                    if (btn) btn.classList.remove('loading');
                    renderMultiServerResults(data, result.results || []);

                    // Add to local list
                    state.policies.push({
                        name: data.name,
                        action: data.action,
                        level: data.level,
                        zoneName: data.zoneName,
                        criteria: data.criteria,
                        scopes: data.scopes,
                        condition: data.condition,
                        processingOrder: data.processingOrder,
                        server: targetServers.map(function (s) { return s.name; }).join(', '),
                        fromServer: true
                    });
                    NS.renderPolicies();
                });
                return;
            }

            // Single server execution
            var singleServer = targetServers[0];
            var singlePayload = {
                name: data.name,
                action: data.action,
                zoneName: data.zoneName,
                criteria: data.criteria,
                scopes: data.scopes,
                condition: data.condition,
                processingOrder: data.processingOrder,
                server: singleServer.hostname,
                serverId: singleServer.id,
                credentialMode: singleServer.credentialMode,
                applyOnRecursion: data.applyOnRecursion,
                recursionScope: data.recursionScope
            };

            var apiCall = (data.policyType === 'ZoneTransfer')
                ? NS.api.addZoneTransferPolicy(singlePayload)
                : NS.api.addPolicy(singlePayload);

            apiCall.then(function (result) {
                if (btn) btn.classList.remove('loading');

                if (result.success) {
                    var timestamp = new Date().toLocaleString();
                    var cmd = buildCommand(data, singleServer.hostname);
                    setPowershellOutput(
                        '# Policy Executed on Server - ' + timestamp + '\n' +
                        '# Target: ' + singleServer.name + ' (' + singleServer.hostname + ')\n' +
                        '# Status: SUCCESS\n\n' +
                        cmd
                    );
                    NS.showTab('powershell');

                    state.policies.push({
                        name: data.name,
                        action: data.action,
                        level: data.level,
                        zoneName: data.zoneName,
                        criteria: data.criteria,
                        scopes: data.scopes,
                        condition: data.condition,
                        processingOrder: data.processingOrder,
                        server: singleServer.hostname,
                        fromServer: true
                    });
                    NS.renderPolicies();
                    NS.toast.success('Policy "' + data.name + '" created on ' + singleServer.name + '.');
                } else {
                    NS.toast.error('Failed to create policy: ' + (result.error || 'Unknown error'));
                    showGeneratedCommand(data);
                }
            });
            return;
        }

        // Generate mode — produce command(s)
        if (targetServers.length > 1) {
            // Multi-server command generation
            var timestamp = new Date().toLocaleString();
            var output = '# Generated DNS Policy Commands - ' + timestamp + '\n';
            output += '# Policy: ' + data.name + '\n';
            output += '# Targets: ' + targetServers.length + ' servers\n\n';

            targetServers.forEach(function (srv, idx) {
                output += '# ── Server ' + (idx + 1) + ': ' + srv.name + ' (' + srv.hostname + ') ──\n';
                output += buildCommand(data, srv.hostname) + '\n\n';
            });

            setPowershellOutput(output);
            NS.showTab('powershell');
        } else {
            showGeneratedCommand(data);
        }

        state.policies.push({
            name: data.name,
            action: data.action,
            level: data.level,
            zoneName: data.zoneName,
            criteria: data.criteria,
            scopes: data.scopes,
            condition: data.condition,
            processingOrder: data.processingOrder,
            server: targetServers.length > 0 ? targetServers[0].hostname : data.server,
            fromServer: false
        });

        NS.renderPolicies();
        NS.toast.success('Policy "' + data.name + '" generated successfully.');
    };

    function renderMultiServerResults(data, results) {
        var timestamp = new Date().toLocaleString();
        var successCount = 0;
        var failCount = 0;

        results.forEach(function (r) {
            if (r.success) successCount++;
            else failCount++;
        });

        var output = document.getElementById('powershellOutput');
        output.textContent = '';

        var pre = document.createElement('pre');
        pre.textContent = '# Multi-Server Policy Execution - ' + timestamp + '\n' +
            '# Policy: ' + data.name + '\n' +
            '# Results: ' + successCount + ' succeeded, ' + failCount + ' failed\n';
        output.appendChild(pre);

        var resultList = document.createElement('div');
        resultList.className = 'multi-result-list';

        results.forEach(function (r) {
            var item = document.createElement('div');
            item.className = 'multi-result-item ' + (r.success ? 'success' : 'error');

            var icon = document.createElement('span');
            icon.className = 'multi-result-icon';
            icon.textContent = r.success ? '\u2713' : '\u2717';
            item.appendChild(icon);

            var serverName = document.createElement('span');
            serverName.className = 'multi-result-server';
            serverName.textContent = (r.name || r.hostname || r.serverId);
            item.appendChild(serverName);

            if (!r.success && r.error) {
                var msg = document.createElement('span');
                msg.className = 'multi-result-message';
                msg.textContent = r.error;
                item.appendChild(msg);
            }

            resultList.appendChild(item);
        });

        output.appendChild(resultList);
        NS.showTab('powershell');

        if (failCount === 0) {
            NS.toast.success('Policy created on all ' + successCount + ' servers.');
        } else if (successCount > 0) {
            NS.toast.warning(successCount + ' succeeded, ' + failCount + ' failed.');
        } else {
            NS.toast.error('Policy creation failed on all servers.');
        }
    }

    function showGeneratedCommand(data) {
        var timestamp = new Date().toLocaleString();
        var cmd = buildCommand(data);
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
            if (policy.server) {
                detailLines.push('Server: ' + policy.server);
            }
            if (policy.criteria && policy.criteria.length) {
                var criteriaText = policy.criteria.map(function (c) {
                    return c.type + ': ' + c.values.join(', ');
                }).join(' | ');
                detailLines.push('Criteria: ' + criteriaText);
            }
            detailsEl.textContent = detailLines.join(' \u2022 ');

            // Enabled/Disabled badge
            var isEnabled = policy.IsEnabled !== false && policy.isEnabled !== false;
            if (policy.fromServer && !isEnabled) {
                div.classList.add('policy-disabled');
                var disabledBadge = document.createElement('span');
                disabledBadge.className = 'policy-badge-disabled';
                disabledBadge.textContent = 'DISABLED';
                div.appendChild(disabledBadge);
            }

            div.appendChild(nameEl);
            div.appendChild(actionEl);
            div.appendChild(detailsEl);

            // Enable/Disable toggle for server-sourced policies
            if (policy.fromServer && state.bridgeConnected) {
                var toggleBtn = document.createElement('button');
                toggleBtn.className = 'btn btn-secondary btn-sm';
                toggleBtn.setAttribute('data-action', 'togglePolicyState');
                toggleBtn.setAttribute('data-index', index);
                toggleBtn.textContent = isEnabled ? 'Disable' : 'Enable';
                div.appendChild(toggleBtn);
            }

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

        // Determine server info for removal
        var activeServer = NS.getActiveServer ? NS.getActiveServer() : null;
        var server = policy.server || (activeServer ? activeServer.hostname : 'localhost');

        NS.api.removePolicy(
            policy.name,
            server,
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

    NS.togglePolicyState = function togglePolicyState(index) {
        var policy = state.policies[index];
        if (!policy || !policy.fromServer) return;

        var isEnabled = policy.IsEnabled !== false && policy.isEnabled !== false;
        var newState = !isEnabled;

        var activeServer = NS.getActiveServer ? NS.getActiveServer() : null;
        var server = policy.server || (activeServer ? activeServer.hostname : 'localhost');

        NS.api.setPolicyState(
            policy.name,
            newState,
            server,
            policy.zoneName || policy.ZoneName,
            policy.policyType === 'ZoneTransfer' ? 'transfer' : null
        ).then(function (result) {
            if (result.success) {
                policy.IsEnabled = newState;
                policy.isEnabled = newState;
                NS.renderPolicies();
                NS.toast.success('Policy "' + policy.name + '" ' + (newState ? 'enabled' : 'disabled') + '.');
            } else {
                NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    NS.exportPolicy = function exportPolicy() {
        var output = document.getElementById('powershellOutput');
        var text = output.textContent;

        if (!text.includes('Generated DNS Policy Command') && !text.includes('Policy Executed') && !text.includes('Multi-Server Policy Execution')) {
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

        var server = NS.getActiveServer ? NS.getActiveServer() : null;
        if (!server) {
            NS.toast.info('No active server selected.');
            return;
        }

        var btn = document.querySelector('[data-action="loadPolicies"]');
        if (btn) btn.classList.add('loading');

        var qs = 'server=' + encodeURIComponent(server.hostname);
        qs += '&serverId=' + encodeURIComponent(server.id);
        qs += '&credentialMode=' + encodeURIComponent(server.credentialMode);

        NS.api.listPolicies(server.hostname).then(function (result) {
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
                        server: server.hostname,
                        fromServer: true
                    };
                });
                NS.renderPolicies();
                NS.toast.success('Loaded ' + state.policies.length + ' policies from ' + server.name + '.');
            } else {
                NS.toast.error('Failed to load policies: ' + (result.error || 'Unknown error'));
            }
        });
    };
})();
