/* ── Application Entry Point ───────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager;
    var state = NS.state;

    /**
     * Resolve a data-server-id from a click target (walks up to 3 levels).
     */
    function getServerId(target) {
        var el = target;
        for (var i = 0; i < 3 && el; i++) {
            var id = el.getAttribute('data-server-id');
            if (id) return id;
            el = el.parentElement;
        }
        return null;
    }

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
                case 'refreshZones':
                    NS.refreshZones();
                    break;
                case 'triggerFileSelect':
                    document.getElementById('blocklistFile').click();
                    break;

                // ── Server Management ────────────────────────
                case 'addServerModal':
                    NS.showAddServerModal();
                    break;
                case 'editServer':
                    NS.showEditServerModal(getServerId(target));
                    break;
                case 'removeServer':
                    e.stopPropagation();
                    var removeId = getServerId(target);
                    if (removeId && confirm('Remove this server?')) {
                        NS.removeServer(removeId);
                    }
                    break;
                case 'testServer':
                    e.stopPropagation();
                    NS.testServer(getServerId(target));
                    break;
                case 'testAllServers':
                    NS.testAllServers();
                    break;
                case 'saveServerModal':
                    NS.saveServerFromModal();
                    break;
                case 'cancelServerModal':
                    NS.hideServerModal();
                    break;
                case 'selectActiveServer':
                    NS.setActiveServer(getServerId(target));
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
                case 'toggleModalCredentialFields':
                    NS.toggleModalCredentialFields();
                    break;
                case 'toggleAllTargetServers':
                    NS.toggleAllTargetServers();
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

        // ── Close modal on backdrop click ────────────────────
        var modal = document.getElementById('serverModal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) {
                    NS.hideServerModal();
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
     * Update policies empty state visibility.
     */
    NS.updatePoliciesEmptyState = function updatePoliciesEmptyState() {
        var emptyEl = document.getElementById('policiesEmpty');
        if (emptyEl) {
            emptyEl.style.display = state.policies.length === 0 ? 'block' : 'none';
        }
    };

    /**
     * Initialize the application.
     */
    function init() {
        // Load server registry from localStorage first
        if (NS.loadServers) {
            NS.loadServers();
        }

        bindEvents();

        // Render server list from localStorage (works offline)
        if (NS.renderServerList) {
            NS.renderServerList();
        }

        // Populate target server checkboxes
        if (NS.populateTargetServers) {
            NS.populateTargetServers();
        }

        // Populate backup server select
        if (NS.populateBackupServerSelect) {
            NS.populateBackupServerSelect();
        }

        // Check bridge availability, then set up accordingly
        if (NS.api) {
            NS.api.checkBridge().then(function (result) {
                if (result.success && result.status === 'ok') {
                    // Bridge is available - start health monitoring
                    NS.api.startHealthCheck();

                    // Re-render server list (status indicators may update)
                    if (NS.renderServerList) {
                        NS.renderServerList();
                    }

                    // Verify stored credentials
                    if (NS.verifyServerCredentials) {
                        NS.verifyServerCredentials();
                    }
                } else {
                    // Bridge offline - load samples
                    NS.loadSamplePolicies();
                    NS.updatePoliciesEmptyState();
                }
            });
        } else {
            NS.loadSamplePolicies();
            NS.updatePoliciesEmptyState();
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
            '# - Multi-server management with secure credentials\n' +
            '# - Visual policy builder with form validation\n' +
            '# - Support for all DNS policy criteria types\n' +
            '# - PowerShell command generation\n' +
            '# - Live server management via PowerShell bridge\n' +
            '# - Policy backup and restore capabilities\n' +
            '# - Blocklist import from TXT/CSV files\n' +
            '# \n' +
            '# Use the Server tab to manage your DNS servers.\n' +
            '# Use the Create Policy tab to build DNS policies.\n' +
            '# Use Backup & Import to backup existing policies or import blocklists.';
        output.textContent = '';
        output.appendChild(pre);

        // Set initial tab
        NS.showTab('server');
    }

    // Boot on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
