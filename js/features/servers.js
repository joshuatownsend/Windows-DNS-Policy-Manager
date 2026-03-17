/* ── Server Management ─────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;
    var STORAGE_KEY = 'dnspm_servers';

    // ── Persistence ──────────────────────────────────────────

    NS.loadServers = function loadServers() {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                var saved = JSON.parse(raw);
                state.servers = saved.map(function (s) {
                    return {
                        id: s.id,
                        name: s.name,
                        hostname: s.hostname,
                        credentialMode: s.credentialMode || 'currentUser',
                        hasCredential: false,
                        status: 'unknown',
                        lastChecked: null,
                        serverInfo: null,
                        zoneCount: 0
                    };
                });
            } catch (e) {
                state.servers = [];
            }
        }

        // Migration: create default localhost entry if none exist
        if (state.servers.length === 0) {
            state.servers.push({
                id: 'srv_default',
                name: 'localhost',
                hostname: 'localhost',
                credentialMode: 'currentUser',
                hasCredential: false,
                status: 'unknown',
                lastChecked: null,
                serverInfo: null,
                zoneCount: 0
            });
            NS.saveServers();
        }

        // Default active server
        if (!state.activeServerId && state.servers.length > 0) {
            state.activeServerId = state.servers[0].id;
        }
    };

    NS.saveServers = function saveServers() {
        var metadata = state.servers.map(function (s) {
            return {
                id: s.id,
                name: s.name,
                hostname: s.hostname,
                credentialMode: s.credentialMode
            };
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
    };

    // ── CRUD ─────────────────────────────────────────────────

    NS.addServer = function addServer(config) {
        var server = {
            id: 'srv_' + Date.now(),
            name: config.name,
            hostname: config.hostname,
            credentialMode: config.credentialMode || 'currentUser',
            hasCredential: false,
            status: 'unknown',
            lastChecked: null,
            serverInfo: null,
            zoneCount: 0
        };
        state.servers.push(server);
        NS.saveServers();
        NS.renderServerList();
        NS.populateTargetServers();
        NS.populateBackupServerSelect();
        return server;
    };

    NS.editServer = function editServer(id, updates) {
        var server = findServer(id);
        if (!server) return;
        if (updates.name !== undefined) server.name = updates.name;
        if (updates.hostname !== undefined) server.hostname = updates.hostname;
        if (updates.credentialMode !== undefined) server.credentialMode = updates.credentialMode;
        NS.saveServers();
        NS.renderServerList();
        NS.populateTargetServers();
        NS.populateBackupServerSelect();
    };

    NS.removeServer = function removeServer(id) {
        var idx = state.servers.findIndex(function (s) { return s.id === id; });
        if (idx === -1) return;

        // Delete credential from bridge
        if (NS.api && state.bridgeConnected) {
            NS.api.deleteCredential(id);
        }

        state.servers.splice(idx, 1);

        // Reset active if removed
        if (state.activeServerId === id) {
            state.activeServerId = state.servers.length > 0 ? state.servers[0].id : null;
        }

        NS.saveServers();
        NS.renderServerList();
        NS.populateTargetServers();
        NS.populateBackupServerSelect();
    };

    function findServer(id) {
        for (var i = 0; i < state.servers.length; i++) {
            if (state.servers[i].id === id) return state.servers[i];
        }
        return null;
    }

    NS.getActiveServer = function getActiveServer() {
        return findServer(state.activeServerId);
    };

    // ── Connection Testing ───────────────────────────────────

    NS.testServer = function testServer(id) {
        var server = findServer(id);
        if (!server) return;

        if (!state.bridgeConnected || !NS.api) {
            NS.toast.info('Bridge is offline. Cannot test server.');
            return;
        }

        server.status = 'testing';
        NS.renderServerList();

        NS.api.connectServer(server).then(function (result) {
            if (result.success) {
                server.status = 'connected';
                server.zoneCount = result.zoneCount || 0;
                server.serverInfo = result;
                server.lastChecked = new Date().toISOString();

                // If this is the active server, update zones
                if (state.activeServerId === id && result.zones) {
                    state.serverZones = result.zones;
                    if (NS.renderZones) NS.renderZones(result.zones);
                }
            } else {
                server.status = 'error';
                server.lastChecked = new Date().toISOString();
            }
            NS.renderServerList();

            // Show info panel if active
            if (state.activeServerId === id) {
                renderActiveServerInfo();
            }
        });
    };

    NS.testAllServers = function testAllServers() {
        state.servers.forEach(function (s) {
            NS.testServer(s.id);
        });
    };

    // ── Active Server ────────────────────────────────────────

    NS.setActiveServer = function setActiveServer(id) {
        state.activeServerId = id;
        var server = findServer(id);

        NS.renderServerList();
        renderActiveServerInfo();

        // Load zones for this server
        if (server && state.bridgeConnected && NS.api) {
            if (server.status === 'connected' && server.serverInfo && server.serverInfo.zones) {
                state.serverZones = server.serverInfo.zones;
                if (NS.renderZones) NS.renderZones(server.serverInfo.zones);
            } else {
                NS.testServer(id);
            }
        }
    };

    function renderActiveServerInfo() {
        var server = findServer(state.activeServerId);
        var infoPanel = document.getElementById('serverInfoPanel');
        var zonesPanel = document.getElementById('serverZonesPanel');

        if (!server || server.status !== 'connected') {
            if (infoPanel) infoPanel.style.display = 'none';
            if (zonesPanel) zonesPanel.style.display = 'none';
            return;
        }

        // Render server info grid
        if (infoPanel && NS.renderServerInfo) {
            NS.renderServerInfo(server.name, server.serverInfo || { hostname: server.hostname, zoneCount: server.zoneCount }, server);
        }
    }

    // ── Rendering: Server List ───────────────────────────────

    NS.renderServerList = function renderServerList() {
        var list = document.getElementById('serverList');
        if (!list) return;

        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        if (state.servers.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'server-list-empty';
            empty.textContent = 'No servers defined. Click "Add Server" to get started.';
            list.appendChild(empty);
            return;
        }

        state.servers.forEach(function (server) {
            var card = document.createElement('div');
            card.className = 'server-card' + (state.activeServerId === server.id ? ' active' : '');
            card.setAttribute('role', 'listitem');
            card.setAttribute('data-action', 'selectActiveServer');
            card.setAttribute('data-server-id', server.id);

            // Status dot
            var statusDot = document.createElement('span');
            statusDot.className = 'server-card-status ' + server.status;
            card.appendChild(statusDot);

            // Info section
            var info = document.createElement('div');
            info.className = 'server-card-info';

            var nameEl = document.createElement('div');
            nameEl.className = 'server-card-name';
            nameEl.textContent = server.name;
            info.appendChild(nameEl);

            var hostEl = document.createElement('div');
            hostEl.className = 'server-card-host';
            hostEl.textContent = server.hostname;
            if (server.zoneCount > 0) {
                hostEl.textContent += ' \u2022 ' + server.zoneCount + ' zones';
            }
            info.appendChild(hostEl);

            card.appendChild(info);

            // Credential mode badge
            var modeBadge = document.createElement('span');
            modeBadge.className = 'server-card-mode';
            var modeLabels = {
                currentUser: 'Kerberos',
                savedCredential: 'Saved Cred',
                session: 'Session'
            };
            modeBadge.textContent = modeLabels[server.credentialMode] || server.credentialMode;
            card.appendChild(modeBadge);

            // Action buttons
            var actions = document.createElement('div');
            actions.className = 'server-card-actions';

            var testBtn = document.createElement('button');
            testBtn.className = 'btn btn-secondary btn-sm';
            testBtn.setAttribute('data-action', 'testServer');
            testBtn.setAttribute('data-server-id', server.id);
            testBtn.textContent = 'Test';
            actions.appendChild(testBtn);

            var editBtn = document.createElement('button');
            editBtn.className = 'btn btn-secondary btn-sm';
            editBtn.setAttribute('data-action', 'editServer');
            editBtn.setAttribute('data-server-id', server.id);
            editBtn.textContent = 'Edit';
            actions.appendChild(editBtn);

            if (state.servers.length > 1) {
                var removeBtn = document.createElement('button');
                removeBtn.className = 'btn btn-danger btn-sm';
                removeBtn.setAttribute('data-action', 'removeServer');
                removeBtn.setAttribute('data-server-id', server.id);
                removeBtn.textContent = 'Remove';
                actions.appendChild(removeBtn);
            }

            card.appendChild(actions);
            list.appendChild(card);
        });
    };

    // ── Modal ────────────────────────────────────────────────

    NS.showAddServerModal = function showAddServerModal() {
        var modal = document.getElementById('serverModal');
        if (!modal) return;

        document.getElementById('serverModalTitle').textContent = 'Add Server';
        document.getElementById('serverModalName').value = '';
        document.getElementById('serverModalHostname').value = '';
        document.getElementById('serverModalCredMode').value = 'currentUser';
        toggleModalCredFields('currentUser');

        var usernameField = document.getElementById('serverModalUsername');
        var passwordField = document.getElementById('serverModalPassword');
        if (usernameField) usernameField.value = '';
        if (passwordField) passwordField.value = '';

        modal.removeAttribute('data-edit-id');
        modal.style.display = 'flex';
    };

    NS.showEditServerModal = function showEditServerModal(id) {
        var server = findServer(id);
        if (!server) return;

        var modal = document.getElementById('serverModal');
        if (!modal) return;

        document.getElementById('serverModalTitle').textContent = 'Edit Server';
        document.getElementById('serverModalName').value = server.name;
        document.getElementById('serverModalHostname').value = server.hostname;
        document.getElementById('serverModalCredMode').value = server.credentialMode;
        toggleModalCredFields(server.credentialMode);

        var usernameField = document.getElementById('serverModalUsername');
        var passwordField = document.getElementById('serverModalPassword');
        if (usernameField) usernameField.value = '';
        if (passwordField) passwordField.value = '';

        modal.setAttribute('data-edit-id', id);
        modal.style.display = 'flex';
    };

    NS.hideServerModal = function hideServerModal() {
        var modal = document.getElementById('serverModal');
        if (modal) modal.style.display = 'none';
    };

    function toggleModalCredFields(mode) {
        var section = document.getElementById('serverModalCredSection');
        if (!section) return;
        section.style.display = (mode === 'savedCredential' || mode === 'session') ? 'block' : 'none';
    }

    NS.toggleModalCredentialFields = function toggleModalCredentialFields() {
        var mode = document.getElementById('serverModalCredMode').value;
        toggleModalCredFields(mode);
    };

    NS.saveServerFromModal = function saveServerFromModal() {
        var modal = document.getElementById('serverModal');
        var name = document.getElementById('serverModalName').value.trim();
        var hostname = document.getElementById('serverModalHostname').value.trim();
        var credMode = document.getElementById('serverModalCredMode').value;

        if (!name || !hostname) {
            NS.toast.warning('Server name and hostname are required.');
            return;
        }

        var editId = modal.getAttribute('data-edit-id');
        var serverId;

        if (editId) {
            NS.editServer(editId, { name: name, hostname: hostname, credentialMode: credMode });
            serverId = editId;
        } else {
            var newServer = NS.addServer({ name: name, hostname: hostname, credentialMode: credMode });
            serverId = newServer.id;
        }

        // Handle credential storage
        if (credMode === 'savedCredential' || credMode === 'session') {
            var username = document.getElementById('serverModalUsername').value.trim();
            var password = document.getElementById('serverModalPassword').value;

            if (username && password && NS.api && state.bridgeConnected) {
                var storePromise;
                if (credMode === 'savedCredential') {
                    storePromise = NS.api.storeCredential(serverId, username, password);
                } else {
                    storePromise = NS.api.storeSessionCredential(serverId, username, password);
                }

                storePromise.then(function (result) {
                    if (result.success) {
                        var server = findServer(serverId);
                        if (server) server.hasCredential = true;
                        NS.toast.success('Server saved and credentials stored.');
                    } else {
                        NS.toast.error('Server saved but credential storage failed: ' + (result.error || 'Unknown error'));
                    }
                });
            } else if (username && password && !state.bridgeConnected) {
                NS.toast.warning('Server saved. Bridge is offline — credentials will need to be stored when bridge is available.');
            }
        } else {
            NS.toast.success('Server saved.');
        }

        NS.hideServerModal();
    };

    // ── Target Servers (Create Policy Tab) ───────────────────

    NS.populateTargetServers = function populateTargetServers() {
        var container = document.getElementById('targetServerList');
        if (!container) return;

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        if (state.servers.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'form-help';
            empty.textContent = 'No servers defined. Add servers in the Server tab.';
            container.appendChild(empty);
            return;
        }

        // Select All checkbox
        var selectAllItem = document.createElement('div');
        selectAllItem.className = 'target-server-item select-all';
        var selectAllLabel = document.createElement('label');
        var selectAllCb = document.createElement('input');
        selectAllCb.type = 'checkbox';
        selectAllCb.id = 'targetSelectAll';
        selectAllCb.setAttribute('data-action', 'toggleAllTargetServers');
        selectAllLabel.appendChild(selectAllCb);
        var selectAllText = document.createElement('span');
        selectAllText.textContent = ' Select All';
        selectAllText.style.fontWeight = '600';
        selectAllLabel.appendChild(selectAllText);
        selectAllItem.appendChild(selectAllLabel);
        container.appendChild(selectAllItem);

        state.servers.forEach(function (server) {
            var item = document.createElement('div');
            item.className = 'target-server-item';

            var label = document.createElement('label');
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'target-server-cb';
            cb.value = server.id;
            // Pre-check the active server
            if (state.activeServerId === server.id) {
                cb.checked = true;
            }
            label.appendChild(cb);

            var text = document.createElement('span');
            text.className = 'target-server-label';
            text.textContent = ' ' + server.name;

            var host = document.createElement('span');
            host.className = 'target-server-host';
            host.textContent = server.hostname;

            label.appendChild(text);
            item.appendChild(label);
            item.appendChild(host);
            container.appendChild(item);
        });
    };

    NS.toggleAllTargetServers = function toggleAllTargetServers() {
        var selectAll = document.getElementById('targetSelectAll');
        if (!selectAll) return;
        var checkboxes = document.querySelectorAll('.target-server-cb');
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = selectAll.checked;
        }
    };

    NS.getSelectedTargetServers = function getSelectedTargetServers() {
        var checkboxes = document.querySelectorAll('.target-server-cb:checked');
        var result = [];
        for (var i = 0; i < checkboxes.length; i++) {
            var server = findServer(checkboxes[i].value);
            if (server) {
                result.push({
                    id: server.id,
                    name: server.name,
                    hostname: server.hostname,
                    credentialMode: server.credentialMode
                });
            }
        }
        return result;
    };

    // ── Backup Server Select ─────────────────────────────────

    NS.populateBackupServerSelect = function populateBackupServerSelect() {
        var select = document.getElementById('backupServer');
        if (!select || select.tagName !== 'SELECT') return;

        while (select.firstChild) {
            select.removeChild(select.firstChild);
        }

        state.servers.forEach(function (server) {
            var option = document.createElement('option');
            option.value = server.id;
            option.textContent = server.name + ' (' + server.hostname + ')';
            select.appendChild(option);
        });
    };

    // ── Credential Verification ──────────────────────────────

    NS.verifyServerCredentials = function verifyServerCredentials() {
        if (!NS.api || !state.bridgeConnected) return;

        state.servers.forEach(function (server) {
            if (server.credentialMode === 'savedCredential') {
                NS.api.checkCredential(server.id).then(function (result) {
                    if (result.success) {
                        server.hasCredential = result.exists;
                    }
                });
            }
        });
    };

})();
