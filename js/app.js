/* ── Application Entry Point ───────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager;
    var state = NS.state;

    /**
     * Wire all event listeners using event delegation.
     */
    function bindEvents() {
        // ── Delegated click handler on document ──────────────
        document.addEventListener('click', function (e) {
            var target = e.target;
            var action = target.getAttribute('data-action');

            // Walk up for buttons inside other elements
            if (!action && target.parentElement) {
                action = target.parentElement.getAttribute('data-action');
                if (action) target = target.parentElement;
            }

            switch (action) {
                case 'showTab':
                    NS.showTab(target.getAttribute('data-tab'));
                    break;
                case 'generatePolicy':
                    NS.generatePolicy();
                    break;
                case 'exportPolicy':
                    NS.exportPolicy();
                    break;
                case 'clearForm':
                    NS.clearForm();
                    break;
                case 'loadPolicies':
                    NS.loadPolicies();
                    break;
                case 'testConnection':
                    NS.testConnection();
                    break;
                case 'addCriteria':
                    NS.addCriteria();
                    break;
                case 'removeCriteria':
                    NS.removeCriteria(target.getAttribute('data-target'));
                    break;
                case 'addScope':
                    NS.addScope();
                    break;
                case 'removeScope':
                    NS.removeScope(target);
                    break;
                case 'generateBackupScript':
                    NS.generateBackupScript();
                    break;
                case 'exportCurrentPolicies':
                    NS.exportCurrentPolicies();
                    break;
                case 'backupFromServer':
                    NS.backupFromServer();
                    break;
                case 'previewBlocklist':
                    NS.previewBlocklist();
                    break;
                case 'importBlocklist':
                    NS.importBlocklist();
                    break;
                case 'selectPolicy':
                    NS.selectPolicy(parseInt(target.getAttribute('data-index'), 10));
                    break;
                case 'removePolicy':
                    NS.removePolicy(parseInt(target.getAttribute('data-index'), 10));
                    break;
                case 'triggerFileSelect':
                    document.getElementById('blocklistFile').click();
                    break;
                default:
                    break;
            }
        });

        // ── Change handlers ──────────────────────────────────
        document.addEventListener('change', function (e) {
            var target = e.target;
            var action = target.getAttribute('data-action');

            switch (action) {
                case 'toggleCredentialFields':
                    NS.toggleCredentialFields();
                    break;
                case 'toggleScopeConfig':
                    NS.toggleScopeConfig();
                    break;
                case 'toggleZoneField':
                    NS.toggleZoneField();
                    break;
                case 'updateCriteriaHelp':
                    NS.updateCriteriaHelp(target);
                    break;
                case 'handleFileSelect':
                    NS.handleFileSelect(target);
                    break;
                case 'toggleExecutionMode':
                    NS.toggleExecutionMode(target);
                    break;
                default:
                    break;
            }
        });

        // ── Keyboard: tab navigation ─────────────────────────
        var tabList = document.querySelector('[role="tablist"]');
        if (tabList) {
            tabList.addEventListener('keydown', NS.handleTabKeydown);
        }

        // ── Keyboard: Enter/Space on policy items ────────────
        document.getElementById('policyList').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                var item = e.target.closest('[data-action="selectPolicy"]');
                if (item) {
                    e.preventDefault();
                    NS.selectPolicy(parseInt(item.getAttribute('data-index'), 10));
                }
            }
        });

        // ── Keyboard: Enter/Space on file upload area ────────
        var uploadArea = document.querySelector('.file-upload-area');
        if (uploadArea) {
            uploadArea.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    document.getElementById('blocklistFile').click();
                }
            });
        }

        // ── Drag-and-drop on file upload area ────────────────
        if (uploadArea) {
            uploadArea.addEventListener('dragover', function (e) {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });
            uploadArea.addEventListener('dragleave', function () {
                uploadArea.classList.remove('dragover');
            });
            uploadArea.addEventListener('drop', function (e) {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                var fileInput = document.getElementById('blocklistFile');
                if (e.dataTransfer.files.length > 0) {
                    fileInput.files = e.dataTransfer.files;
                    NS.handleFileSelect(fileInput);
                }
            });
        }
    }

    /**
     * Toggle execution mode between 'generate' and 'execute'.
     */
    NS.toggleExecutionMode = function toggleExecutionMode(checkbox) {
        state.executionMode = checkbox.checked ? 'execute' : 'generate';

        // Update button labels
        var genBtn = document.querySelector('[data-action="generatePolicy"]');
        if (genBtn) {
            genBtn.textContent = checkbox.checked ? 'Create Policy on Server' : 'Generate Policy';
        }

        var importBtn = document.getElementById('importBtn');
        if (importBtn) {
            importBtn.textContent = checkbox.checked ? 'Execute Policies on Server' : 'Generate Policies';
        }
    };

    /**
     * Initialize the application.
     */
    function init() {
        bindEvents();

        // Check bridge availability, then set up accordingly
        if (NS.api) {
            NS.api.checkBridge().then(function (result) {
                if (result.success && result.status === 'ok') {
                    // Bridge is available - start health monitoring, skip samples
                    NS.api.startHealthCheck();
                } else {
                    // Bridge offline - load samples as usual
                    NS.loadSamplePolicies();
                }
            });
        } else {
            NS.loadSamplePolicies();
        }

        NS.addCriteria();

        // Set initial PowerShell output
        var output = document.getElementById('powershellOutput');
        var pre = document.createElement('pre');
        pre.textContent =
            '# DNS Policy Manager Ready\n' +
            '# This tool helps you create Windows DNS Query Resolution Policies\n' +
            '# \n' +
            '# Features:\n' +
            '# - Visual policy builder with form validation\n' +
            '# - Support for all DNS policy criteria types\n' +
            '# - PowerShell command generation\n' +
            '# - Live server management via PowerShell bridge\n' +
            '# - Policy backup and restore capabilities\n' +
            '# - Blocklist import from TXT/CSV files\n' +
            '# \n' +
            '# Click "Create Policy" tab to start building your DNS policy.\n' +
            '# Click "Backup & Import" tab to backup existing policies or import blocklists.';
        output.textContent = '';
        output.appendChild(pre);

        // Set initial tab ARIA state
        NS.showTab('create');
    }

    // Boot on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
