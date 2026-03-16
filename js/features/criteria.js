/* ── Criteria Management ───────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    var criteriaTypes = [
        { value: 'ClientSubnet',     label: 'Client Subnet' },
        { value: 'FQDN',            label: 'FQDN (Domain Name)' },
        { value: 'QType',           label: 'Query Type' },
        { value: 'ServerInterface',  label: 'Server Interface IP' },
        { value: 'InternetProtocol', label: 'Internet Protocol' },
        { value: 'TransportProtocol',label: 'Transport Protocol' },
        { value: 'TimeOfDay',       label: 'Time of Day' }
    ];

    var examples = {
        ClientSubnet:      'Example: 192.168.1.0/24, 10.0.0.0/8, SubnetName',
        FQDN:              'Example: *.contoso.com, www.example.com, *.malware.net',
        QType:             'Example: A, AAAA, CNAME, MX, NS, PTR, SOA, SRV, TXT, ANY',
        ServerInterface:   'Example: 192.168.1.10, 10.0.0.1',
        InternetProtocol:  'Example: IPv4, IPv6',
        TransportProtocol: 'Example: UDP, TCP',
        TimeOfDay:         'Example: 09:00-17:00, 18:00-23:59'
    };

    /**
     * Build a criteria item using safe DOM methods instead of innerHTML.
     * All content is developer-controlled (not user input).
     */
    NS.addCriteria = function addCriteria(existingCriteria) {
        var criteriaList = document.getElementById('criteriaList');
        var id = 'criteria-' + state.criteriaCount;

        var div = document.createElement('div');
        div.className = 'criteria-item';
        div.id = id;

        // Remove button
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-criteria';
        removeBtn.setAttribute('data-action', 'removeCriteria');
        removeBtn.setAttribute('data-target', id);
        removeBtn.setAttribute('aria-label', 'Remove this criteria');
        removeBtn.textContent = '\u00D7';

        // Top row: type + operator
        var topRow = document.createElement('div');
        topRow.className = 'form-row';

        // Type select
        var typeGroup = document.createElement('div');
        typeGroup.className = 'form-group';
        var typeLabel = document.createElement('label');
        typeLabel.textContent = 'Criteria Type';
        var typeSelect = document.createElement('select');
        typeSelect.className = 'criteria-type';
        typeSelect.setAttribute('data-action', 'updateCriteriaHelp');
        criteriaTypes.forEach(function (t) {
            var opt = document.createElement('option');
            opt.value = t.value;
            opt.textContent = t.label;
            if (existingCriteria && existingCriteria.type === t.value) opt.selected = true;
            typeSelect.appendChild(opt);
        });
        typeGroup.appendChild(typeLabel);
        typeGroup.appendChild(typeSelect);

        // Operator select
        var opGroup = document.createElement('div');
        opGroup.className = 'form-group';
        var opLabel = document.createElement('label');
        opLabel.textContent = 'Operator';
        var opSelect = document.createElement('select');
        opSelect.className = 'criteria-operator';
        var eqOpt = document.createElement('option');
        eqOpt.value = 'EQ';
        eqOpt.textContent = 'EQ (Equals)';
        if (!existingCriteria || existingCriteria.operator === 'EQ') eqOpt.selected = true;
        var neOpt = document.createElement('option');
        neOpt.value = 'NE';
        neOpt.textContent = 'NE (Not Equals)';
        if (existingCriteria && existingCriteria.operator === 'NE') neOpt.selected = true;
        opSelect.appendChild(eqOpt);
        opSelect.appendChild(neOpt);
        opGroup.appendChild(opLabel);
        opGroup.appendChild(opSelect);

        topRow.appendChild(typeGroup);
        topRow.appendChild(opGroup);

        // Values group
        var valGroup = document.createElement('div');
        valGroup.className = 'form-group';
        var valLabel = document.createElement('label');
        valLabel.textContent = 'Values (comma-separated)';
        var valArea = document.createElement('textarea');
        valArea.className = 'criteria-values';
        valArea.rows = 2;
        valArea.placeholder = 'Enter values separated by commas';
        if (existingCriteria) valArea.value = existingCriteria.values.join(', ');
        var helpSmall = document.createElement('small');
        helpSmall.className = 'criteria-help';
        helpSmall.textContent = 'Examples will appear here based on selected criteria type';
        valGroup.appendChild(valLabel);
        valGroup.appendChild(valArea);
        valGroup.appendChild(helpSmall);

        // Assemble
        div.appendChild(removeBtn);
        div.appendChild(topRow);
        div.appendChild(valGroup);

        criteriaList.appendChild(div);
        NS.updateCriteriaHelp(typeSelect);
        state.criteriaCount++;

        // Focus the new criteria's type select
        typeSelect.focus();
    };

    NS.updateCriteriaHelp = function updateCriteriaHelp(selectElement) {
        var helpText = selectElement.closest('.criteria-item').querySelector('.criteria-help');
        helpText.textContent = examples[selectElement.value] || 'Enter appropriate values for the selected criteria type';
    };

    NS.removeCriteria = function removeCriteria(criteriaId) {
        var el = document.getElementById(criteriaId);
        if (!el) return;

        // Focus the Add Criteria button after removal
        var addBtn = document.querySelector('[data-action="addCriteria"]');
        el.remove();
        if (addBtn) addBtn.focus();
    };
})();
