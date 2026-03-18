/* ── Zone Management ───────────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    // ── Helpers ───────────────────────────────────────────

    function getActiveServerInfo() {
        var server = NS.getActiveServer ? NS.getActiveServer() : null;
        if (!server) return null;
        return {
            server: server.hostname,
            serverId: server.id,
            credentialMode: server.credentialMode
        };
    }

    var RECORD_TYPE_COLORS = {
        A: 'var(--accent)', AAAA: '#5b9bd5', CNAME: '#b07dd6',
        MX: '#4caf88', TXT: '#e89b4f', SRV: '#d4c74a',
        NS: '#e06060', PTR: '#8a8a9a', SOA: '#666680'
    };

    var EDITABLE_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'SRV', 'TXT', 'NS', 'PTR'];

    /**
     * Build a RegExp from user search input.
     * Supports: plain substring, glob wildcards (* and ?), or /regex/ syntax.
     * Returns null on invalid regex so callers can fall back gracefully.
     */
    function buildSearchRegex(input) {
        if (!input) return null;
        var trimmed = input.trim();
        if (!trimmed) return null;

        // Explicit regex: /pattern/flags
        var rxMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
        if (rxMatch) {
            try { return new RegExp(rxMatch[1], rxMatch[2] || 'i'); }
            catch (e) { return null; }
        }

        // Glob-style: contains unescaped * or ?
        if (/[*?]/.test(trimmed)) {
            // Escape regex-special chars except * and ?, then convert globs
            var escaped = trimmed.replace(/([.+^${}()|[\]\\])/g, '\\$1');
            escaped = escaped.replace(/\*/g, '.*');
            escaped = escaped.replace(/\?/g, '.');
            try { return new RegExp(escaped, 'i'); }
            catch (e) { return null; }
        }

        // Plain substring — escape everything, case-insensitive
        var plain = trimmed.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
        return new RegExp(plain, 'i');
    }

    function formatTTL(seconds) {
        if (!seconds) return '—';
        if (seconds >= 86400) return Math.floor(seconds / 86400) + 'd';
        if (seconds >= 3600) return Math.floor(seconds / 3600) + 'h';
        if (seconds >= 60) return Math.floor(seconds / 60) + 'm';
        return seconds + 's';
    }

    // ── Zone List ─────────────────────────────────────────

    NS.renderZoneList = function renderZoneList() {
        var container = document.getElementById('zoneListItems');
        if (!container) return;

        while (container.firstChild) container.removeChild(container.firstChild);

        var zones = state.serverZones || [];
        var filterEl = document.getElementById('zoneListFilter');
        var filterText = filterEl ? filterEl.value : '';
        var zoneRx = buildSearchRegex(filterText);

        if (zoneRx) {
            zones = zones.filter(function (z) {
                return zoneRx.test(z.ZoneName);
            });
        }

        if (zones.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'zone-list-empty';
            empty.textContent = state.serverZones.length === 0
                ? 'No server connected'
                : 'No zones match filter';
            container.appendChild(empty);
            return;
        }

        zones.forEach(function (z) {
            var item = document.createElement('div');
            item.className = 'zone-list-item';
            if (state.selectedZone && state.selectedZone.ZoneName === z.ZoneName) {
                item.classList.add('active');
            }
            item.setAttribute('data-action', 'selectZone');
            item.setAttribute('data-zone', z.ZoneName);
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');

            var nameEl = document.createElement('div');
            nameEl.className = 'zone-list-item-name';
            nameEl.textContent = z.ZoneName;

            var metaEl = document.createElement('div');
            metaEl.className = 'zone-list-item-meta';

            var typeBadge = document.createElement('span');
            typeBadge.className = 'zone-badge type-primary';
            typeBadge.textContent = z.ZoneType || 'Primary';
            metaEl.appendChild(typeBadge);

            if (z.IsDsIntegrated) {
                var adBadge = document.createElement('span');
                adBadge.className = 'zone-badge type-ad';
                adBadge.textContent = 'AD';
                metaEl.appendChild(adBadge);
            }

            if (z.IsReverseLookupZone) {
                var revBadge = document.createElement('span');
                revBadge.className = 'zone-badge type-secondary';
                revBadge.textContent = 'Rev';
                metaEl.appendChild(revBadge);
            }

            item.appendChild(nameEl);
            item.appendChild(metaEl);
            container.appendChild(item);
        });
    };

    NS.filterZoneList = function filterZoneList() {
        NS.renderZoneList();
    };

    NS.refreshZoneList = function refreshZoneList() {
        if (!state.bridgeConnected || !NS.api) {
            NS.toast.info('Bridge is offline.');
            return;
        }
        var server = NS.getActiveServer ? NS.getActiveServer() : null;
        if (!server) {
            NS.toast.info('No active server selected.');
            return;
        }

        NS.api.connectServer(server).then(function (result) {
            if (result.success && result.zones) {
                state.serverZones = result.zones;
                NS.renderZoneList();
                NS.toast.success('Zone list refreshed.');
            } else {
                NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    // ── Zone Selection ────────────────────────────────────

    NS.selectZone = function selectZone(zoneName) {
        var info = getActiveServerInfo();
        if (!info) {
            NS.toast.info('No active server selected.');
            return;
        }

        // Show loading state
        var detailPanel = document.getElementById('zoneDetailPanel');
        if (detailPanel) detailPanel.style.display = 'block';

        var headerEl = document.getElementById('zoneDetailName');
        if (headerEl) headerEl.textContent = zoneName;

        // Load details and records in parallel
        Promise.all([
            NS.api.getZoneDetails(zoneName, info.server, info.serverId, info.credentialMode),
            NS.api.getZoneRecords(zoneName, info.server, info.serverId, info.credentialMode)
        ]).then(function (results) {
            var detailResult = results[0];
            var recordsResult = results[1];

            if (detailResult.success && detailResult.zone) {
                state.selectedZone = detailResult.zone;
                NS.renderZoneDetails();
            } else {
                NS.toast.error('Zone details: ' + (detailResult.error || 'Failed'));
            }

            if (recordsResult.success) {
                state.zoneRecords = recordsResult.records || [];
                state.zoneRecordFilter = { type: '', search: '' };
                // Reset filter UI
                var typeFilter = document.getElementById('recordTypeFilter');
                var searchFilter = document.getElementById('recordSearchFilter');
                if (typeFilter) typeFilter.value = '';
                if (searchFilter) searchFilter.value = '';
                NS.renderZoneRecords();
            } else {
                NS.toast.error('Zone records: ' + (recordsResult.error || 'Failed'));
            }

            NS.renderZoneList();
        });
    };

    NS.navigateToZone = function navigateToZone(zoneName) {
        NS.showTab('zones');
        NS.selectZone(zoneName);
    };

    // ── Zone Details ──────────────────────────────────────

    NS.renderZoneDetails = function renderZoneDetails() {
        var zone = state.selectedZone;
        if (!zone) return;

        var headerEl = document.getElementById('zoneDetailName');
        if (headerEl) headerEl.textContent = zone.ZoneName;

        // Badges
        var badgeContainer = document.getElementById('zoneDetailBadges');
        if (badgeContainer) {
            while (badgeContainer.firstChild) badgeContainer.removeChild(badgeContainer.firstChild);

            var badges = [
                { text: zone.ZoneType || 'Primary', cls: 'type-primary' }
            ];
            if (zone.IsDsIntegrated) badges.push({ text: 'AD-Integrated', cls: 'type-ad' });
            if (zone.IsReverseLookupZone) badges.push({ text: 'Reverse', cls: 'type-secondary' });
            if (zone.IsSigned) badges.push({ text: 'DNSSEC Signed', cls: 'type-ad' });

            badges.forEach(function (b) {
                var span = document.createElement('span');
                span.className = 'zone-badge ' + b.cls;
                span.textContent = b.text;
                badgeContainer.appendChild(span);
            });
        }

        // Settings grid
        var grid = document.getElementById('zoneSettingsGrid');
        if (grid) {
            while (grid.firstChild) grid.removeChild(grid.firstChild);

            var items = [
                { label: 'Dynamic Update', value: zone.DynamicUpdate || 'None' },
                { label: 'Replication Scope', value: zone.ReplicationScope || 'N/A' },
                { label: 'Zone File', value: zone.ZoneFile || '(AD-integrated)' },
                { label: 'Notify', value: zone.Notify || 'N/A' },
                { label: 'Secure Secondaries', value: zone.SecureSecondaries || 'N/A' }
            ];

            items.forEach(function (item) {
                var card = document.createElement('div');
                card.className = 'server-info-item';

                var labelEl = document.createElement('div');
                labelEl.className = 'server-info-label';
                labelEl.textContent = item.label;

                var valueEl = document.createElement('div');
                valueEl.className = 'server-info-value';
                valueEl.textContent = item.value;

                card.appendChild(labelEl);
                card.appendChild(valueEl);
                grid.appendChild(card);
            });
        }

        // Show/hide settings form based on zone type
        var settingsForm = document.getElementById('zoneSettingsForm');
        if (settingsForm) {
            var isPrimary = zone.ZoneType === 'Primary' || zone.IsDsIntegrated;
            settingsForm.style.display = isPrimary ? 'block' : 'none';
            if (isPrimary) {
                var dynSelect = document.getElementById('zoneSettingsDynUpdate');
                var replSelect = document.getElementById('zoneSettingsReplScope');
                if (dynSelect) dynSelect.value = zone.DynamicUpdate || 'None';
                if (replSelect) replSelect.value = zone.ReplicationScope || '';
            }
        }
    };

    NS.saveZoneSettings = function saveZoneSettings() {
        var zone = state.selectedZone;
        if (!zone) return;

        var info = getActiveServerInfo();
        if (!info) {
            NS.toast.info('No active server.');
            return;
        }

        var dynUpdate = document.getElementById('zoneSettingsDynUpdate');
        var replScope = document.getElementById('zoneSettingsReplScope');

        var data = {
            server: info.server,
            serverId: info.serverId,
            credentialMode: info.credentialMode
        };
        if (dynUpdate) data.dynamicUpdate = dynUpdate.value;
        if (replScope && replScope.value) data.replicationScope = replScope.value;

        NS.api.setZoneSettings(zone.ZoneName, data).then(function (result) {
            if (result.success) {
                NS.toast.success('Zone settings updated.');
                NS.selectZone(zone.ZoneName);
            } else {
                NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    // ── Zone Records ──────────────────────────────────────

    NS.renderZoneRecords = function renderZoneRecords() {
        var container = document.getElementById('zoneRecordsBody');
        var countEl = document.getElementById('zoneRecordCount');
        if (!container) return;

        while (container.firstChild) container.removeChild(container.firstChild);

        var records = state.zoneRecords || [];
        var filter = state.zoneRecordFilter;

        // Apply filters
        var searchRx = buildSearchRegex(filter.search);
        var filtered = records.filter(function (r) {
            if (filter.type && r.RecordType !== filter.type) return false;
            if (searchRx) {
                if (!searchRx.test(r.HostName) && !searchRx.test(r.Data)) return false;
            }
            return true;
        });

        if (countEl) {
            countEl.textContent = filtered.length + ' of ' + records.length + ' records';
        }

        if (filtered.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'zone-records-empty';
            empty.textContent = records.length === 0
                ? 'No records in this zone'
                : 'No records match filters';
            container.appendChild(empty);
            return;
        }

        filtered.forEach(function (rec, idx) {
            var row = document.createElement('div');
            row.className = 'zone-record-row';

            // Find original index for edit/delete
            var origIdx = state.zoneRecords.indexOf(rec);

            // Name cell
            var nameCell = document.createElement('div');
            nameCell.className = 'zone-record-cell zr-name';
            nameCell.textContent = rec.HostName;

            // Type badge
            var typeCell = document.createElement('div');
            typeCell.className = 'zone-record-cell zr-type';
            var badge = document.createElement('span');
            badge.className = 'record-type-badge';
            badge.textContent = rec.RecordType;
            badge.style.backgroundColor = RECORD_TYPE_COLORS[rec.RecordType] || '#666';
            typeCell.appendChild(badge);

            // TTL
            var ttlCell = document.createElement('div');
            ttlCell.className = 'zone-record-cell zr-ttl';
            ttlCell.textContent = formatTTL(rec.TTL);

            // Data
            var dataCell = document.createElement('div');
            dataCell.className = 'zone-record-cell zr-data';
            dataCell.textContent = rec.Data;

            // Actions
            var actCell = document.createElement('div');
            actCell.className = 'zone-record-cell zr-actions';

            if (EDITABLE_TYPES.indexOf(rec.RecordType) !== -1) {
                var editBtn = document.createElement('button');
                editBtn.className = 'btn btn-secondary btn-xs';
                editBtn.textContent = 'Edit';
                editBtn.setAttribute('data-action', 'showEditRecordModal');
                editBtn.setAttribute('data-index', origIdx);

                var delBtn = document.createElement('button');
                delBtn.className = 'btn btn-danger btn-xs';
                delBtn.textContent = 'Del';
                delBtn.setAttribute('data-action', 'deleteZoneRecord');
                delBtn.setAttribute('data-index', origIdx);

                actCell.appendChild(editBtn);
                actCell.appendChild(delBtn);
            }

            row.appendChild(nameCell);
            row.appendChild(typeCell);
            row.appendChild(ttlCell);
            row.appendChild(dataCell);
            row.appendChild(actCell);
            container.appendChild(row);
        });
    };

    NS.filterZoneRecords = function filterZoneRecords() {
        var typeEl = document.getElementById('recordTypeFilter');
        var searchEl = document.getElementById('recordSearchFilter');
        state.zoneRecordFilter.type = typeEl ? typeEl.value : '';
        state.zoneRecordFilter.search = searchEl ? searchEl.value : '';
        NS.renderZoneRecords();
    };

    // ── Record Modal ──────────────────────────────────────

    NS.showAddRecordModal = function showAddRecordModal() {
        var modal = document.getElementById('recordModal');
        if (!modal) return;

        document.getElementById('recordModalTitle').textContent = 'Add Record';
        document.getElementById('recordModalMode').value = 'add';
        document.getElementById('recordModalOrigIndex').value = '';

        // Clear fields
        document.getElementById('recordModalName').value = '';
        document.getElementById('recordModalType').value = 'A';
        document.getElementById('recordModalType').disabled = false;
        document.getElementById('recordModalTTL').value = '3600';

        clearRecordDataFields();
        NS.toggleRecordTypeFields();

        modal.style.display = 'flex';
    };

    NS.showEditRecordModal = function showEditRecordModal(idx) {
        var rec = state.zoneRecords[idx];
        if (!rec) return;

        var modal = document.getElementById('recordModal');
        if (!modal) return;

        document.getElementById('recordModalTitle').textContent = 'Edit Record';
        document.getElementById('recordModalMode').value = 'edit';
        document.getElementById('recordModalOrigIndex').value = idx;

        document.getElementById('recordModalName').value = rec.HostName;
        document.getElementById('recordModalType').value = rec.RecordType;
        document.getElementById('recordModalType').disabled = true;
        document.getElementById('recordModalTTL').value = rec.TTL || 3600;

        clearRecordDataFields();
        NS.toggleRecordTypeFields();

        // Fill type-specific fields
        var rd = rec.RecordData || {};
        switch (rec.RecordType) {
            case 'A':
                setField('recordFieldIPv4', rd.IPv4Address);
                break;
            case 'AAAA':
                setField('recordFieldIPv6', rd.IPv6Address);
                break;
            case 'CNAME':
                setField('recordFieldAlias', rd.HostNameAlias);
                break;
            case 'MX':
                setField('recordFieldMX', rd.MailExchange);
                setField('recordFieldMXPref', rd.Preference);
                break;
            case 'SRV':
                setField('recordFieldSRVTarget', rd.DomainName);
                setField('recordFieldSRVPriority', rd.Priority);
                setField('recordFieldSRVWeight', rd.Weight);
                setField('recordFieldSRVPort', rd.Port);
                break;
            case 'TXT':
                setField('recordFieldTXT', Array.isArray(rd.DescriptiveText) ? rd.DescriptiveText.join('\n') : rd.DescriptiveText);
                break;
            case 'NS':
                setField('recordFieldNS', rd.NameServer);
                break;
            case 'PTR':
                setField('recordFieldPTR', rd.PtrDomainName);
                break;
        }

        modal.style.display = 'flex';
    };

    function setField(id, val) {
        var el = document.getElementById(id);
        if (el && val !== undefined && val !== null) el.value = val;
    }

    function clearRecordDataFields() {
        var ids = [
            'recordFieldIPv4', 'recordFieldIPv6', 'recordFieldAlias',
            'recordFieldMX', 'recordFieldMXPref',
            'recordFieldSRVTarget', 'recordFieldSRVPriority', 'recordFieldSRVWeight', 'recordFieldSRVPort',
            'recordFieldTXT', 'recordFieldNS', 'recordFieldPTR'
        ];
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    NS.hideRecordModal = function hideRecordModal() {
        var modal = document.getElementById('recordModal');
        if (modal) modal.style.display = 'none';
    };

    NS.toggleRecordTypeFields = function toggleRecordTypeFields() {
        var typeEl = document.getElementById('recordModalType');
        if (!typeEl) return;
        var type = typeEl.value;

        var sections = document.querySelectorAll('.record-type-fields');
        for (var i = 0; i < sections.length; i++) {
            sections[i].style.display = 'none';
        }

        var target = document.getElementById('recordFields-' + type);
        if (target) target.style.display = 'block';
    };

    NS.saveRecordFromModal = function saveRecordFromModal() {
        var zone = state.selectedZone;
        if (!zone) return;

        var info = getActiveServerInfo();
        if (!info) {
            NS.toast.info('No active server.');
            return;
        }

        var mode = document.getElementById('recordModalMode').value;
        var name = document.getElementById('recordModalName').value.trim();
        var type = document.getElementById('recordModalType').value;
        var ttl = parseInt(document.getElementById('recordModalTTL').value, 10) || 3600;

        if (!name) {
            NS.toast.error('Record name is required.');
            return;
        }

        var recordData = buildRecordData(type);
        if (!recordData) return;

        if (mode === 'edit') {
            var origIdx = parseInt(document.getElementById('recordModalOrigIndex').value, 10);
            var origRec = state.zoneRecords[origIdx];
            if (!origRec) return;

            NS.api.updateZoneRecord(zone.ZoneName, {
                recordName: name,
                recordType: type,
                oldRecordData: origRec.RecordData,
                newRecordData: recordData,
                newTtl: ttl,
                server: info.server,
                serverId: info.serverId,
                credentialMode: info.credentialMode
            }).then(function (result) {
                if (result.success) {
                    NS.toast.success('Record updated.');
                    NS.hideRecordModal();
                    NS.loadZoneRecords(zone.ZoneName);
                } else {
                    NS.toast.error('Update failed: ' + (result.error || 'Unknown'));
                }
            });
        } else {
            NS.api.addZoneRecord(zone.ZoneName, {
                recordName: name,
                recordType: type,
                recordData: recordData,
                ttl: ttl,
                server: info.server,
                serverId: info.serverId,
                credentialMode: info.credentialMode
            }).then(function (result) {
                if (result.success) {
                    NS.toast.success('Record added.');
                    NS.hideRecordModal();
                    NS.loadZoneRecords(zone.ZoneName);
                } else {
                    NS.toast.error('Add failed: ' + (result.error || 'Unknown'));
                }
            });
        }
    };

    function buildRecordData(type) {
        switch (type) {
            case 'A':
                var ipv4 = document.getElementById('recordFieldIPv4').value.trim();
                if (!ipv4) { NS.toast.error('IPv4 address required.'); return null; }
                return { ipv4Address: ipv4 };
            case 'AAAA':
                var ipv6 = document.getElementById('recordFieldIPv6').value.trim();
                if (!ipv6) { NS.toast.error('IPv6 address required.'); return null; }
                return { ipv6Address: ipv6 };
            case 'CNAME':
                var alias = document.getElementById('recordFieldAlias').value.trim();
                if (!alias) { NS.toast.error('Alias required.'); return null; }
                return { hostNameAlias: alias };
            case 'MX':
                var mx = document.getElementById('recordFieldMX').value.trim();
                var pref = parseInt(document.getElementById('recordFieldMXPref').value, 10);
                if (!mx) { NS.toast.error('Mail exchange required.'); return null; }
                return { mailExchange: mx, preference: pref || 10 };
            case 'SRV':
                var target = document.getElementById('recordFieldSRVTarget').value.trim();
                var port = parseInt(document.getElementById('recordFieldSRVPort').value, 10);
                if (!target || !port) { NS.toast.error('Target and port required.'); return null; }
                return {
                    domainName: target,
                    priority: parseInt(document.getElementById('recordFieldSRVPriority').value, 10) || 0,
                    weight: parseInt(document.getElementById('recordFieldSRVWeight').value, 10) || 0,
                    port: port
                };
            case 'TXT':
                var txt = document.getElementById('recordFieldTXT').value.trim();
                if (!txt) { NS.toast.error('Text required.'); return null; }
                return { descriptiveText: txt };
            case 'NS':
                var ns = document.getElementById('recordFieldNS').value.trim();
                if (!ns) { NS.toast.error('Name server required.'); return null; }
                return { nameServer: ns };
            case 'PTR':
                var ptr = document.getElementById('recordFieldPTR').value.trim();
                if (!ptr) { NS.toast.error('PTR domain required.'); return null; }
                return { ptrDomainName: ptr };
            default:
                NS.toast.error('Unsupported record type.');
                return null;
        }
    }

    // ── Record CRUD helpers ───────────────────────────────

    NS.removeZoneRecord = function removeZoneRecord(idx) {
        var rec = state.zoneRecords[idx];
        if (!rec) return;

        var zone = state.selectedZone;
        if (!zone) return;

        if (!confirm('Delete ' + rec.RecordType + ' record "' + rec.HostName + '" (' + rec.Data + ')?')) return;

        var info = getActiveServerInfo();
        if (!info) return;

        NS.api.removeZoneRecord(zone.ZoneName, {
            recordName: rec.HostName,
            recordType: rec.RecordType,
            recordData: rec.RecordData,
            server: info.server,
            serverId: info.serverId,
            credentialMode: info.credentialMode
        }).then(function (result) {
            if (result.success) {
                NS.toast.success('Record deleted.');
                NS.loadZoneRecords(zone.ZoneName);
            } else {
                NS.toast.error('Delete failed: ' + (result.error || 'Unknown'));
            }
        });
    };

    NS.loadZoneRecords = function loadZoneRecords(zoneName) {
        var info = getActiveServerInfo();
        if (!info) return;

        NS.api.getZoneRecords(zoneName, info.server, info.serverId, info.credentialMode)
            .then(function (result) {
                if (result.success) {
                    state.zoneRecords = result.records || [];
                    NS.renderZoneRecords();
                }
            });
    };

    NS.loadZoneDetails = function loadZoneDetails(zoneName) {
        var info = getActiveServerInfo();
        if (!info) return;

        NS.api.getZoneDetails(zoneName, info.server, info.serverId, info.credentialMode)
            .then(function (result) {
                if (result.success && result.zone) {
                    state.selectedZone = result.zone;
                    NS.renderZoneDetails();
                }
            });
    };
})();
