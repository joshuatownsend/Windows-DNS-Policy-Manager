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

    NS.generatePolicy = function generatePolicy() {
        // Validate first
        if (!NS.validatePolicyForm()) return;

        var dnsServer = document.getElementById('dnsServer').value;
        var policyName = document.getElementById('policyName').value.trim();
        var policyAction = document.getElementById('policyAction').value;
        var policyLevel = document.getElementById('policyLevel').value;
        var zoneName = document.getElementById('zoneName').value.trim();
        var condition = document.getElementById('condition').value;
        var processingOrder = document.getElementById('processingOrder').value;

        // Collect criteria
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

        // Collect scopes for ALLOW action
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

        // Generate PowerShell command
        var cmd = 'Add-DnsServerQueryResolutionPolicy -Name "' + policyName + '" -Action ' + policyAction;

        if (policyLevel === 'Zone' && zoneName) {
            cmd += ' -ZoneName "' + zoneName + '"';
        }

        criteria.forEach(function (c) {
            cmd += ' -' + getCriteriaParameterName(c.type) + ' "' + c.operator + ',' + c.values.join(',') + '"';
        });

        if (criteria.length > 1) {
            cmd += ' -Condition ' + condition;
        }

        if (processingOrder) {
            cmd += ' -ProcessingOrder ' + processingOrder;
        }

        if (policyAction === 'ALLOW' && scopes.length > 0) {
            var scopeStr = scopes.map(function (s) { return s.name + ',' + s.weight; }).join(';');
            cmd += ' -ZoneScope "' + scopeStr + '"';
        }

        if (dnsServer !== 'localhost') {
            cmd += ' -ComputerName "' + dnsServer + '"';
        }

        cmd += ' -PassThru';

        // Display the command
        var timestamp = new Date().toLocaleString();
        var zoneParam = (policyLevel === 'Zone' && zoneName) ? ' -ZoneName "' + zoneName + '"' : '';
        var serverParam = dnsServer !== 'localhost' ? ' -ComputerName "' + dnsServer + '"' : '';

        setPowershellOutput(
            '# Generated DNS Policy Command - ' + timestamp + '\n' +
            '# Target DNS Server: ' + dnsServer + '\n\n' +
            cmd + '\n\n' +
            '# To remove this policy, use:\n' +
            'Remove-DnsServerQueryResolutionPolicy -Name "' + policyName + '"' + zoneParam + serverParam + '\n\n' +
            '# To view existing policies, use:\n' +
            'Get-DnsServerQueryResolutionPolicy' + zoneParam + serverParam
        );

        NS.showTab('powershell');

        // Add to policies list
        state.policies.push({
            name: policyName,
            action: policyAction,
            level: policyLevel,
            zoneName: zoneName || null,
            criteria: criteria,
            scopes: scopes,
            condition: condition,
            processingOrder: parseInt(processingOrder, 10) || 1,
            server: dnsServer
        });

        NS.renderPolicies();
        NS.toast.success('Policy "' + policyName + '" generated successfully.');
    };

    /**
     * Render policy list using safe DOM methods (no innerHTML with user data).
     */
    NS.renderPolicies = function renderPolicies() {
        var policyList = document.getElementById('policyList');
        // Clear safely
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

            var criteriaText = policy.criteria.map(function (c) {
                return c.type + ': ' + c.values.join(', ');
            }).join(' | ');

            var detailsEl = document.createElement('div');
            detailsEl.className = 'policy-details';
            var detailLines = ['Level: ' + policy.level];
            if (policy.zoneName) detailLines.push('Zone: ' + policy.zoneName);
            detailLines.push('Criteria: ' + criteriaText);
            detailsEl.textContent = detailLines.join(' \u2022 ');

            div.appendChild(nameEl);
            div.appendChild(actionEl);
            div.appendChild(detailsEl);

            policyList.appendChild(div);
        });
    };

    NS.selectPolicy = function selectPolicy(index) {
        state.selectedPolicy = index;
        NS.renderPolicies();
    };

    NS.exportPolicy = function exportPolicy() {
        var output = document.getElementById('powershellOutput');
        var text = output.textContent;

        if (!text.includes('Generated DNS Policy Command')) {
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

    /**
     * Clipboard fallback using a hidden textarea.
     */
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
                processingOrder: 1
            },
            {
                name: 'GeoRouting',
                action: 'ALLOW',
                level: 'Zone',
                zoneName: 'contoso.com',
                criteria: [{ type: 'ClientSubnet', operator: 'EQ', values: ['USSubnet'] }],
                scopes: [{ name: 'USScope', weight: 3 }, { name: 'EuropeScope', weight: 1 }],
                condition: 'AND',
                processingOrder: 2
            }
        ];
        NS.renderPolicies();
    };

    NS.loadPolicies = function loadPolicies() {
        NS.toast.info('In a real implementation, this would connect to the DNS server and load existing policies.');
    };
})();
