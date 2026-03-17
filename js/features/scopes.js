/* ── Scope Management ──────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    /**
     * Build scope item using safe DOM methods.
     */
    NS.addScope = function addScope(existingScope) {
        var scopeList = document.getElementById('scopeList');
        var div = document.createElement('div');
        div.className = 'scope-item';

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Scope Name';
        nameInput.className = 'scope-name';
        nameInput.value = existingScope ? existingScope.name : '';
        nameInput.setAttribute('list', 'scopeNameDatalist');

        var weightInput = document.createElement('input');
        weightInput.type = 'number';
        weightInput.placeholder = 'Weight';
        weightInput.className = 'scope-weight';
        weightInput.min = '1';
        weightInput.value = existingScope ? existingScope.weight : 1;

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.setAttribute('data-action', 'removeScope');
        removeBtn.setAttribute('aria-label', 'Remove this scope');
        removeBtn.textContent = 'Remove';

        div.appendChild(nameInput);
        div.appendChild(weightInput);
        div.appendChild(removeBtn);

        scopeList.appendChild(div);
        state.scopeCount++;

        // Focus the new scope name input
        nameInput.focus();
    };

    NS.removeScope = function removeScope(button) {
        var scopeItem = button.parentElement;
        var addBtn = document.querySelector('[data-action="addScope"]');
        scopeItem.remove();
        if (addBtn) addBtn.focus();
    };
})();
