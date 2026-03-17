/* ── Zone Scope Management ─────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    function getServerParams() {
        var server = NS.getActiveServer ? NS.getActiveServer() : null;
        if (!server) return null;
        return {
            server: server.hostname,
            serverId: server.id,
            credentialMode: server.credentialMode
        };
    }

    /**
     * Load zone scopes for a given zone.
     */
    NS.loadZoneScopes = function loadZoneScopes(zone) {
        if (!state.bridgeConnected || !NS.api || !zone) return;

        var params = getServerParams();
        if (!params) return;

        NS.api.listZoneScopes(zone, params.server, params.serverId, params.credentialMode)
            .then(function (result) {
                if (result.success) {
                    state.zoneScopes[zone] = result.scopes || [];
                    NS.renderZoneScopes();
                    NS.updateScopeDatalist();
                }
            });
    };

    /**
     * Load zone scopes for the currently selected zone in the zone scope selector.
     */
    NS.loadZoneScopesForSelected = function loadZoneScopesForSelected() {
        var select = document.getElementById('zoneScopeZoneSelect');
        if (!select || !select.value) return;
        NS.loadZoneScopes(select.value);
    };

    /**
     * Render the zone scopes list.
     */
    NS.renderZoneScopes = function renderZoneScopes() {
        var list = document.getElementById('zoneScopeList');
        if (!list) return;

        var select = document.getElementById('zoneScopeZoneSelect');
        var zone = select ? select.value : '';

        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        var scopes = zone ? (state.zoneScopes[zone] || []) : [];

        if (!zone) {
            var msg = document.createElement('p');
            msg.className = 'dns-objects-empty';
            msg.textContent = 'Select a zone above to view its scopes.';
            list.appendChild(msg);
            return;
        }

        if (scopes.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'dns-objects-empty';
            empty.textContent = 'No zone scopes found for "' + zone + '". The default scope always exists.';
            list.appendChild(empty);
            return;
        }

        scopes.forEach(function (scope) {
            var row = document.createElement('div');
            row.className = 'dns-object-row';

            var nameEl = document.createElement('span');
            nameEl.className = 'dns-object-name';
            nameEl.textContent = scope.ZoneScope || scope.Name;

            var fileEl = document.createElement('span');
            fileEl.className = 'dns-object-detail';
            fileEl.textContent = scope.FileName ? 'File: ' + scope.FileName : '';

            row.appendChild(nameEl);
            row.appendChild(fileEl);

            // Don't show delete for default scope
            var scopeName = scope.ZoneScope || scope.Name;
            if (scopeName !== zone && scopeName !== '.') {
                var deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn btn-danger btn-sm';
                deleteBtn.setAttribute('data-action', 'deleteZoneScope');
                deleteBtn.setAttribute('data-name', scopeName);
                deleteBtn.setAttribute('data-zone', zone);
                deleteBtn.textContent = 'Delete';
                row.appendChild(deleteBtn);
            }

            // Add record button
            var addRecordBtn = document.createElement('button');
            addRecordBtn.className = 'btn btn-secondary btn-sm';
            addRecordBtn.setAttribute('data-action', 'showAddRecordForm');
            addRecordBtn.setAttribute('data-scope', scopeName);
            addRecordBtn.setAttribute('data-zone', zone);
            addRecordBtn.textContent = 'Add Record';
            row.appendChild(addRecordBtn);

            list.appendChild(row);
        });
    };

    /**
     * Update the scope datalist in the Create Policy form.
     */
    NS.updateScopeDatalist = function updateScopeDatalist() {
        var datalist = document.getElementById('scopeNameDatalist');
        if (!datalist) return;

        while (datalist.firstChild) {
            datalist.removeChild(datalist.firstChild);
        }

        // Collect all known zone scopes
        Object.keys(state.zoneScopes).forEach(function (zone) {
            (state.zoneScopes[zone] || []).forEach(function (scope) {
                var name = scope.ZoneScope || scope.Name;
                var opt = document.createElement('option');
                opt.value = name;
                datalist.appendChild(opt);
            });
        });
    };

    /**
     * Add a zone scope from the inline form.
     */
    NS.addZoneScopeFromForm = function addZoneScopeFromForm() {
        var zoneSelect = document.getElementById('zoneScopeZoneSelect');
        var nameInput = document.getElementById('newZoneScopeName');

        var zone = zoneSelect ? zoneSelect.value : '';
        var name = nameInput ? nameInput.value.trim() : '';

        if (!zone) {
            NS.toast.warning('Select a zone first.');
            return;
        }
        if (!name) {
            NS.toast.warning('Scope name is required.');
            return;
        }

        var params = getServerParams();
        if (!params) {
            NS.toast.warning('No active server selected.');
            return;
        }

        NS.api.createZoneScope({
            zoneName: zone,
            name: name,
            server: params.server,
            serverId: params.serverId,
            credentialMode: params.credentialMode
        }).then(function (result) {
            if (result.success) {
                NS.toast.success('Zone scope "' + name + '" created in ' + zone + '.');
                if (nameInput) nameInput.value = '';
                NS.loadZoneScopes(zone);
            } else {
                NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    /**
     * Remove a zone scope.
     */
    NS.removeZoneScope = function removeZoneScope(name, zone) {
        var params = getServerParams();
        if (!params) return;

        NS.api.deleteZoneScope(name, zone, params.server, params.serverId, params.credentialMode)
            .then(function (result) {
                if (result.success) {
                    NS.toast.success('Zone scope "' + name + '" deleted.');
                    NS.loadZoneScopes(zone);
                } else {
                    NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
                }
            });
    };

    /**
     * Show inline add-record form for a scope.
     */
    NS.showAddRecordForm = function showAddRecordForm(scopeName, zone) {
        // Remove any existing record form
        var existing = document.getElementById('addRecordInlineForm');
        if (existing) existing.remove();

        var form = document.createElement('div');
        form.id = 'addRecordInlineForm';
        form.className = 'dns-inline-form record-form';

        var typeSelect = document.createElement('select');
        typeSelect.id = 'recordTypeSelect';
        ['A', 'AAAA', 'CNAME'].forEach(function (t) {
            var opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            typeSelect.appendChild(opt);
        });

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'recordNameInput';
        nameInput.placeholder = 'Record name (e.g., www)';

        var valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.id = 'recordValueInput';
        valueInput.placeholder = 'IP address or hostname';

        var addBtn = document.createElement('button');
        addBtn.className = 'btn btn-primary btn-sm';
        addBtn.setAttribute('data-action', 'addRecordToScope');
        addBtn.setAttribute('data-scope', scopeName);
        addBtn.setAttribute('data-zone', zone);
        addBtn.textContent = 'Add';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary btn-sm';
        cancelBtn.setAttribute('data-action', 'cancelAddRecord');
        cancelBtn.textContent = 'Cancel';

        form.appendChild(typeSelect);
        form.appendChild(nameInput);
        form.appendChild(valueInput);
        form.appendChild(addBtn);
        form.appendChild(cancelBtn);

        var list = document.getElementById('zoneScopeList');
        if (list) list.appendChild(form);
        nameInput.focus();
    };

    /**
     * Add a resource record to a zone scope.
     */
    NS.addRecordToScope = function addRecordToScope(scopeName, zone) {
        var recordType = document.getElementById('recordTypeSelect').value;
        var recordName = document.getElementById('recordNameInput').value.trim();
        var recordValue = document.getElementById('recordValueInput').value.trim();

        if (!recordName || !recordValue) {
            NS.toast.warning('Record name and value are required.');
            return;
        }

        var params = getServerParams();
        if (!params) return;

        NS.api.addZoneScopeRecord({
            zoneName: zone,
            scopeName: scopeName,
            recordName: recordName,
            recordType: recordType,
            recordValue: recordValue,
            server: params.server,
            serverId: params.serverId,
            credentialMode: params.credentialMode
        }).then(function (result) {
            if (result.success) {
                NS.toast.success(recordType + ' record added to scope "' + scopeName + '".');
                var form = document.getElementById('addRecordInlineForm');
                if (form) form.remove();
            } else {
                NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    NS.cancelAddRecord = function cancelAddRecord() {
        var form = document.getElementById('addRecordInlineForm');
        if (form) form.remove();
    };

    /**
     * Populate zone scope zone selector from state.serverZones.
     */
    NS.populateZoneScopeZoneSelect = function populateZoneScopeZoneSelect() {
        var select = document.getElementById('zoneScopeZoneSelect');
        if (!select) return;

        var current = select.value;
        while (select.firstChild) {
            select.removeChild(select.firstChild);
        }

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a zone...';
        select.appendChild(placeholder);

        (state.serverZones || []).forEach(function (z) {
            var zoneName = z.ZoneName || z.zoneName || z;
            var opt = document.createElement('option');
            opt.value = zoneName;
            opt.textContent = zoneName;
            if (zoneName === current) opt.selected = true;
            select.appendChild(opt);
        });
    };
})();
