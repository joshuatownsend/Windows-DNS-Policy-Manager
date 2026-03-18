/* ── Recursion Scope Management ────────────────────────── */
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
     * Load recursion scopes from the active server.
     */
    NS.loadRecursionScopes = function loadRecursionScopes() {
        if (!state.bridgeConnected || !NS.api) return;

        var params = getServerParams();
        if (!params) return;

        NS.api.listRecursionScopes(params.server, params.serverId, params.credentialMode)
            .then(function (result) {
                if (result.success) {
                    state.recursionScopes = result.scopes || [];
                    NS.renderRecursionScopes();
                    NS.populateRecursionScopeSelect();
                }
            });
    };

    /**
     * Render the recursion scopes list.
     */
    NS.renderRecursionScopes = function renderRecursionScopes() {
        var list = document.getElementById('recursionScopeList');
        if (!list) return;

        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        if (state.recursionScopes.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'dns-objects-empty';
            empty.textContent = 'No recursion scopes found. The default scope "." always exists on the server.';
            list.appendChild(empty);
            return;
        }

        state.recursionScopes.forEach(function (scope) {
            var row = document.createElement('div');
            row.className = 'dns-object-row';

            var nameEl = document.createElement('span');
            nameEl.className = 'dns-object-name';
            nameEl.textContent = scope.Name;

            var statusEl = document.createElement('span');
            statusEl.className = 'dns-object-badge ' + (scope.EnableRecursion ? 'badge-enabled' : 'badge-disabled');
            statusEl.textContent = scope.EnableRecursion ? 'Recursion ON' : 'Recursion OFF';

            var forwarderEl = document.createElement('span');
            forwarderEl.className = 'dns-object-detail';
            var fwd = scope.Forwarder;
            forwarderEl.textContent = fwd ? 'Forwarder: ' + (Array.isArray(fwd) ? fwd.join(', ') : fwd) : '';

            row.appendChild(nameEl);
            row.appendChild(statusEl);
            row.appendChild(forwarderEl);

            // Toggle recursion button
            var toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn btn-secondary btn-sm';
            toggleBtn.setAttribute('data-action', 'toggleRecursionScope');
            toggleBtn.setAttribute('data-name', scope.Name);
            toggleBtn.setAttribute('data-enabled', scope.EnableRecursion ? 'true' : 'false');
            toggleBtn.textContent = scope.EnableRecursion ? 'Disable' : 'Enable';
            row.appendChild(toggleBtn);

            // Delete button (not for default scope ".")
            if (scope.Name !== '.') {
                var deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn btn-danger btn-sm';
                deleteBtn.setAttribute('data-action', 'deleteRecursionScope');
                deleteBtn.setAttribute('data-name', scope.Name);
                deleteBtn.textContent = 'Delete';
                row.appendChild(deleteBtn);
            }

            list.appendChild(row);
        });
    };

    /**
     * Add a recursion scope from the inline form.
     */
    NS.addRecursionScopeFromForm = function addRecursionScopeFromForm() {
        var nameInput = document.getElementById('recursionScopeName');
        var enableCheck = document.getElementById('recursionScopeEnable');
        var forwarderInput = document.getElementById('recursionScopeForwarder');

        var name = nameInput ? nameInput.value.trim() : '';
        var enableRecursion = enableCheck ? enableCheck.checked : true;
        var forwarder = forwarderInput ? forwarderInput.value.trim() : '';

        if (!name) {
            NS.toast.warning('Recursion scope name is required.');
            return;
        }

        var params = getServerParams();
        if (!params) {
            NS.toast.warning('No active server selected.');
            return;
        }

        var body = {
            name: name,
            enableRecursion: enableRecursion,
            server: params.server,
            serverId: params.serverId,
            credentialMode: params.credentialMode
        };
        if (forwarder) body.forwarder = forwarder;

        NS.api.createRecursionScope(body).then(function (result) {
            if (result.success) {
                NS.toast.success('Recursion scope "' + name + '" created.');
                if (nameInput) nameInput.value = '';
                if (forwarderInput) forwarderInput.value = '';
                if (enableCheck) enableCheck.checked = true;
                NS.loadRecursionScopes();
            } else {
                NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    /**
     * Toggle recursion on/off for a scope.
     */
    NS.toggleRecursionScope = function toggleRecursionScope(name, currentlyEnabled) {
        var params = getServerParams();
        if (!params) return;

        var newEnabled = currentlyEnabled !== 'true';

        NS.api.setRecursionScope(name, {
            enableRecursion: newEnabled,
            server: params.server,
            serverId: params.serverId,
            credentialMode: params.credentialMode
        }).then(function (result) {
            if (result.success) {
                NS.toast.success('Recursion ' + (newEnabled ? 'enabled' : 'disabled') + ' for "' + name + '".');
                NS.loadRecursionScopes();
            } else {
                NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    /**
     * Delete a recursion scope.
     */
    NS.removeRecursionScope = function removeRecursionScope(name) {
        if (name === '.') {
            NS.toast.warning('The default recursion scope "." cannot be deleted.');
            return;
        }

        var params = getServerParams();
        if (!params) return;

        NS.api.deleteRecursionScope(name, params.server, params.serverId, params.credentialMode)
            .then(function (result) {
                if (result.success) {
                    NS.toast.success('Recursion scope "' + name + '" deleted.');
                    NS.loadRecursionScopes();
                } else {
                    NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
                }
            });
    };

    /**
     * Populate the recursion scope dropdown in the Create Policy form.
     */
    NS.populateRecursionScopeSelect = function populateRecursionScopeSelect() {
        var select = document.getElementById('recursionScopeSelect');
        if (!select) return;

        var current = select.value;
        while (select.firstChild) {
            select.removeChild(select.firstChild);
        }

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select recursion scope...';
        select.appendChild(placeholder);

        (state.recursionScopes || []).forEach(function (scope) {
            var opt = document.createElement('option');
            opt.value = scope.Name;
            opt.textContent = scope.Name + (scope.EnableRecursion ? ' (recursion on)' : ' (recursion off)');
            if (scope.Name === current) opt.selected = true;
            select.appendChild(opt);
        });
    };
})();
