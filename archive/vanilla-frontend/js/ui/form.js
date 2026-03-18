/* ── Form Helpers ──────────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    /* ── Validation ─────────────────────────────────────── */

    var namePattern = /^[a-zA-Z0-9_-]+$/;

    /**
     * Set or clear an error state on a form group.
     * @param {string} inputId    — the id of the input element
     * @param {string|null} msg   — error message, or null to clear
     */
    function setFieldError(inputId, msg) {
        var input = document.getElementById(inputId);
        if (!input) return;
        var group = input.closest('.form-group');
        if (!group) return;

        var errorEl = group.querySelector('.form-error-message');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.className = 'form-error-message';
            group.appendChild(errorEl);
        }

        if (msg) {
            group.classList.add('form-group--error');
            input.setAttribute('aria-invalid', 'true');
            errorEl.textContent = msg;
        } else {
            group.classList.remove('form-group--error');
            input.removeAttribute('aria-invalid');
            errorEl.textContent = '';
        }
    }

    /**
     * Validate the policy form before generation.
     * Returns true if valid, false otherwise (with error states applied).
     */
    NS.validatePolicyForm = function validatePolicyForm() {
        var valid = true;

        // Policy name
        var name = document.getElementById('policyName').value.trim();
        if (!name) {
            setFieldError('policyName', 'Policy name is required.');
            valid = false;
        } else if (!namePattern.test(name)) {
            setFieldError('policyName', 'Only letters, numbers, hyphens, and underscores allowed.');
            valid = false;
        } else {
            setFieldError('policyName', null);
        }

        // Action
        var action = document.getElementById('policyAction').value;
        if (!action) {
            setFieldError('policyAction', 'Please select an action.');
            valid = false;
        } else {
            setFieldError('policyAction', null);
        }

        // Zone name when level is Zone
        var level = document.getElementById('policyLevel').value;
        if (level === 'Zone') {
            var zone = document.getElementById('zoneName').value.trim();
            if (!zone) {
                setFieldError('zoneName', 'Zone name is required when policy level is Zone.');
                valid = false;
            } else {
                setFieldError('zoneName', null);
            }
        }

        // At least one criteria with values
        var criteriaItems = document.querySelectorAll('.criteria-item');
        var hasValues = false;
        for (var i = 0; i < criteriaItems.length; i++) {
            var vals = criteriaItems[i].querySelector('.criteria-values').value.trim();
            if (vals) { hasValues = true; break; }
        }
        if (!hasValues) {
            NS.toast.warning('Add at least one criteria with values.');
            valid = false;
        }

        // Recursion scope required for Recursion policy type
        var policyTypeEl = document.getElementById('policyType');
        var policyType = policyTypeEl ? policyTypeEl.value : 'QueryResolution';
        if (policyType === 'Recursion') {
            var recScope = document.getElementById('recursionScopeSelect');
            if (recScope && !recScope.value) {
                NS.toast.warning('Recursion scope is required for recursion policies.');
                valid = false;
            }
        }

        // Scope names for ALLOW
        if (action === 'ALLOW') {
            var scopeNames = [];
            var scopeItems = document.querySelectorAll('.scope-item');
            for (var j = 0; j < scopeItems.length; j++) {
                var sn = scopeItems[j].querySelector('.scope-name').value.trim();
                if (!sn) {
                    NS.toast.warning('All scope names must be non-empty for ALLOW action.');
                    valid = false;
                    break;
                }
                if (scopeNames.indexOf(sn) !== -1) {
                    NS.toast.warning('Scope names must be unique. Duplicate: "' + sn + '"');
                    valid = false;
                    break;
                }
                scopeNames.push(sn);
            }
        }

        return valid;
    };

    /* ── Policy Type Toggle ───────────────────────────── */

    NS.togglePolicyType = function togglePolicyType() {
        var policyType = document.getElementById('policyType').value;
        var levelGroup = document.getElementById('policyLevel');
        var scopeConfig = document.getElementById('scopeConfig');
        var recursionScopeGroup = document.getElementById('recursionScopeGroup');
        var actionSelect = document.getElementById('policyAction');
        var zoneNameGroup = document.getElementById('zoneNameGroup');

        // Reset visibility
        if (recursionScopeGroup) recursionScopeGroup.style.display = 'none';
        if (scopeConfig) scopeConfig.style.display = 'none';

        switch (policyType) {
            case 'Recursion':
                // Force server-level, show recursion scope dropdown
                if (levelGroup) {
                    levelGroup.value = 'Server';
                    levelGroup.disabled = true;
                }
                if (zoneNameGroup) zoneNameGroup.style.display = 'none';
                if (recursionScopeGroup) recursionScopeGroup.style.display = 'block';
                // Restore all actions
                restoreActionOptions(actionSelect);
                break;

            case 'ZoneTransfer':
                // Only DENY/IGNORE actions
                if (levelGroup) levelGroup.disabled = false;
                filterActionOptions(actionSelect, ['DENY', 'IGNORE']);
                break;

            default: // QueryResolution
                if (levelGroup) levelGroup.disabled = false;
                restoreActionOptions(actionSelect);
                NS.toggleScopeConfig();
                break;
        }
    };

    function filterActionOptions(select, allowed) {
        if (!select) return;
        var current = select.value;
        var options = select.querySelectorAll('option');
        for (var i = 0; i < options.length; i++) {
            var val = options[i].value;
            if (val === '') continue; // placeholder
            options[i].style.display = allowed.indexOf(val) !== -1 ? '' : 'none';
        }
        // Reset selection if current is not allowed
        if (current && allowed.indexOf(current) === -1) {
            select.value = '';
        }
    }

    function restoreActionOptions(select) {
        if (!select) return;
        var options = select.querySelectorAll('option');
        for (var i = 0; i < options.length; i++) {
            options[i].style.display = '';
        }
    }

    /* ── Toggle helpers ─────────────────────────────────── */

    NS.toggleZoneField = function toggleZoneField() {
        var policyLevel = document.getElementById('policyLevel').value;
        var zoneNameGroup = document.getElementById('zoneNameGroup');

        if (policyLevel === 'Zone') {
            zoneNameGroup.style.display = 'block';
            document.getElementById('zoneName').setAttribute('aria-required', 'true');
        } else {
            zoneNameGroup.style.display = 'none';
            document.getElementById('zoneName').removeAttribute('aria-required');
            setFieldError('zoneName', null);
        }
    };

    NS.toggleScopeConfig = function toggleScopeConfig() {
        var policyAction = document.getElementById('policyAction').value;
        var scopeConfig = document.getElementById('scopeConfig');

        if (policyAction === 'ALLOW') {
            scopeConfig.style.display = 'block';
        } else {
            scopeConfig.style.display = 'none';
        }
    };

    /* ── Clear form ─────────────────────────────────────── */

    NS.clearForm = function clearForm() {
        document.getElementById('policyForm').reset();
        document.getElementById('criteriaList').textContent = '';
        document.getElementById('scopeList').textContent = '';

        state.selectedPolicy = null;
        state.criteriaCount = 0;
        state.scopeCount = 1;

        document.getElementById('policyLevel').value = 'Server';
        document.getElementById('condition').value = 'AND';
        document.getElementById('processingOrder').value = '1';

        // Clear any validation errors
        var errorGroups = document.querySelectorAll('.form-group--error');
        for (var i = 0; i < errorGroups.length; i++) {
            errorGroups[i].classList.remove('form-group--error');
            var errMsg = errorGroups[i].querySelector('.form-error-message');
            if (errMsg) errMsg.textContent = '';
        }

        NS.toggleZoneField();
        NS.toggleScopeConfig();
        NS.addCriteria();
        NS.addScope();
        NS.renderPolicies();
    };
})();
