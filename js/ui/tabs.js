/* ── Tab Switching ─────────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};

    /**
     * Switch to the named tab.
     *
     * BUG FIX: The original showTab() referenced `event.target` to highlight
     * the active button, but `event` was never passed as a parameter.
     * This relied on Chrome's non-standard implicit `window.event` and
     * broke in Firefox. It also failed when called programmatically
     * (e.g. from testConnection or importBlocklist).
     *
     * Fix: find the button via its `data-tab` attribute instead.
     *
     * @param {string} tabName — 'create' | 'backup' | 'powershell'
     */
    NS.showTab = function showTab(tabName) {
        // Deactivate all panels
        var panels = document.querySelectorAll('.tab-content');
        for (var i = 0; i < panels.length; i++) {
            panels[i].classList.remove('active');
            panels[i].setAttribute('aria-hidden', 'true');
        }

        // Deactivate all buttons
        var buttons = document.querySelectorAll('.tab-button');
        for (var j = 0; j < buttons.length; j++) {
            buttons[j].classList.remove('active');
            buttons[j].setAttribute('aria-selected', 'false');
            buttons[j].setAttribute('tabindex', '-1');
        }

        // Activate target panel
        var panel = document.getElementById(tabName + 'Tab');
        if (panel) {
            panel.classList.add('active');
            panel.setAttribute('aria-hidden', 'false');
        }

        // Activate matching button via data-tab attribute
        var activeBtn = document.querySelector('.tab-button[data-tab="' + tabName + '"]');
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.setAttribute('aria-selected', 'true');
            activeBtn.setAttribute('tabindex', '0');
        }

        // Tab-specific data loading
        if (tabName === 'objects') {
            if (NS.loadSubnets) NS.loadSubnets();
            if (NS.loadRecursionScopes) NS.loadRecursionScopes();
            if (NS.populateZoneScopeZoneSelect) NS.populateZoneScopeZoneSelect();
        }
        if (tabName === 'wizards') {
            if (NS.showWizardGrid) NS.showWizardGrid();
        }
    };

    /**
     * Keyboard navigation for tab buttons (arrow keys).
     */
    NS.handleTabKeydown = function handleTabKeydown(e) {
        var buttons = Array.prototype.slice.call(
            document.querySelectorAll('.tab-button')
        );
        var index = buttons.indexOf(e.target);
        if (index === -1) return;

        var next = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            next = (index + 1) % buttons.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            next = (index - 1 + buttons.length) % buttons.length;
        } else if (e.key === 'Home') {
            next = 0;
        } else if (e.key === 'End') {
            next = buttons.length - 1;
        }

        if (next !== -1) {
            e.preventDefault();
            buttons[next].focus();
            var tab = buttons[next].getAttribute('data-tab');
            if (tab) NS.showTab(tab);
        }
    };
})();
