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
