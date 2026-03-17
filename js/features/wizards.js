/* ── Scenario Wizards ──────────────────────────────────── */
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

    // ── Scenario Definitions ────────────────────────────────

    var scenarios = {
        geolocation: {
            id: 'geolocation',
            title: 'Geo-Location Routing',
            description: 'Route queries to different IPs based on client geographic location using client subnets.',
            icon: '\uD83C\uDF0D',
            steps: [
                { id: 'zone', title: 'Select Zone', fields: ['zone'] },
                { id: 'regions', title: 'Define Regions', fields: ['regions'] },
                { id: 'records', title: 'Configure Records', fields: ['records'] },
                { id: 'review', title: 'Review & Execute', fields: [] }
            ]
        },
        splitbrain: {
            id: 'splitbrain',
            title: 'Split-Brain DNS',
            description: 'Serve different answers to internal vs. external clients for the same zone.',
            icon: '\uD83D\uDD00',
            steps: [
                { id: 'zone', title: 'Select Zone & Internal Subnets', fields: ['zone', 'internalSubnets'] },
                { id: 'records', title: 'Internal Zone Scope & Records', fields: ['internalRecords'] },
                { id: 'recursion', title: 'Configure Recursion', fields: ['recursion'] },
                { id: 'policies', title: 'Create Policies', fields: ['policies'] },
                { id: 'review', title: 'Review & Execute', fields: [] }
            ]
        },
        blocklist: {
            id: 'blocklist',
            title: 'Domain Blocklist',
            description: 'Block or silently drop queries for a list of domains.',
            icon: '\uD83D\uDEAB',
            steps: [
                { id: 'domains', title: 'Import Domains', fields: ['domains'] },
                { id: 'action', title: 'Choose Action & Targets', fields: ['action'] },
                { id: 'review', title: 'Review & Execute', fields: [] }
            ]
        },
        timeofday: {
            id: 'timeofday',
            title: 'Time-of-Day Routing',
            description: 'Route queries to different servers based on time windows (e.g., business hours vs. off-hours).',
            icon: '\u23F0',
            steps: [
                { id: 'zone', title: 'Select Zone & FQDN', fields: ['zone', 'fqdn'] },
                { id: 'windows', title: 'Define Time Windows', fields: ['timeWindows'] },
                { id: 'review', title: 'Review & Execute', fields: [] }
            ]
        },
        loadbalancing: {
            id: 'loadbalancing',
            title: 'Application Load Balancing',
            description: 'Distribute DNS queries across multiple backend servers using weighted zone scopes.',
            icon: '\u2696\uFE0F',
            steps: [
                { id: 'zone', title: 'Select Zone & Record', fields: ['zone', 'recordName'] },
                { id: 'backends', title: 'Define Backends', fields: ['backends'] },
                { id: 'review', title: 'Review & Execute', fields: [] }
            ]
        }
    };

    // ── Wizard Grid ─────────────────────────────────────────

    NS.showWizardGrid = function showWizardGrid() {
        var area = document.getElementById('wizardContent');
        if (!area) return;

        while (area.firstChild) {
            area.removeChild(area.firstChild);
        }

        state.wizardState = { scenarioId: null, currentStep: 0, totalSteps: 0, data: {} };

        var grid = document.createElement('div');
        grid.className = 'wizard-grid';

        Object.keys(scenarios).forEach(function (key) {
            var s = scenarios[key];
            var card = document.createElement('div');
            card.className = 'wizard-card';
            card.setAttribute('data-action', 'startWizard');
            card.setAttribute('data-scenario', s.id);
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');

            var icon = document.createElement('div');
            icon.className = 'wizard-card-icon';
            icon.textContent = s.icon;

            var title = document.createElement('div');
            title.className = 'wizard-card-title';
            title.textContent = s.title;

            var desc = document.createElement('div');
            desc.className = 'wizard-card-desc';
            desc.textContent = s.description;

            card.appendChild(icon);
            card.appendChild(title);
            card.appendChild(desc);
            grid.appendChild(card);
        });

        area.appendChild(grid);
    };

    // ── Wizard Navigation ───────────────────────────────────

    NS.startWizard = function startWizard(scenarioId) {
        var scenario = scenarios[scenarioId];
        if (!scenario) return;

        state.wizardState = {
            scenarioId: scenarioId,
            currentStep: 0,
            totalSteps: scenario.steps.length,
            data: {}
        };

        NS.renderWizardStep();
    };

    NS.wizardNext = function wizardNext() {
        var ws = state.wizardState;
        var scenario = scenarios[ws.scenarioId];
        if (!scenario) return;

        if (!validateCurrentStep()) return;
        collectCurrentStepData();

        if (ws.currentStep < ws.totalSteps - 1) {
            ws.currentStep++;
            NS.renderWizardStep();
        }
    };

    NS.wizardBack = function wizardBack() {
        var ws = state.wizardState;
        if (ws.currentStep > 0) {
            collectCurrentStepData();
            ws.currentStep--;
            NS.renderWizardStep();
        }
    };

    NS.wizardCancel = function wizardCancel() {
        NS.showWizardGrid();
    };

    // ── Step Rendering ──────────────────────────────────────

    NS.renderWizardStep = function renderWizardStep() {
        var area = document.getElementById('wizardContent');
        if (!area) return;

        var ws = state.wizardState;
        var scenario = scenarios[ws.scenarioId];
        if (!scenario) return;

        while (area.firstChild) {
            area.removeChild(area.firstChild);
        }

        // Progress bar
        var progress = document.createElement('div');
        progress.className = 'wizard-progress';

        var progressTitle = document.createElement('div');
        progressTitle.className = 'wizard-progress-title';
        progressTitle.textContent = scenario.title + ' \u2014 Step ' + (ws.currentStep + 1) + ' of ' + ws.totalSteps;
        progress.appendChild(progressTitle);

        var progressBar = document.createElement('div');
        progressBar.className = 'wizard-progress-bar';
        var progressFill = document.createElement('div');
        progressFill.className = 'wizard-progress-fill';
        progressFill.style.width = ((ws.currentStep + 1) / ws.totalSteps * 100) + '%';
        progressBar.appendChild(progressFill);
        progress.appendChild(progressBar);

        // Step indicators
        var stepIndicators = document.createElement('div');
        stepIndicators.className = 'wizard-step-indicators';
        scenario.steps.forEach(function (step, idx) {
            var dot = document.createElement('span');
            dot.className = 'wizard-step-dot' +
                (idx < ws.currentStep ? ' completed' : '') +
                (idx === ws.currentStep ? ' active' : '');
            dot.textContent = step.title;
            stepIndicators.appendChild(dot);
        });
        progress.appendChild(stepIndicators);
        area.appendChild(progress);

        // Step content
        var content = document.createElement('div');
        content.className = 'wizard-step-content';
        content.id = 'wizardStepContent';

        var step = scenario.steps[ws.currentStep];
        var renderFn = stepRenderers[ws.scenarioId + '_' + step.id];
        if (renderFn) {
            renderFn(content, ws.data);
        } else if (step.id === 'review') {
            renderReviewStep(content, ws);
        }

        area.appendChild(content);

        // Navigation buttons
        var nav = document.createElement('div');
        nav.className = 'wizard-nav';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.setAttribute('data-action', 'wizardCancel');
        cancelBtn.textContent = 'Cancel';
        nav.appendChild(cancelBtn);

        if (ws.currentStep > 0) {
            var backBtn = document.createElement('button');
            backBtn.className = 'btn btn-secondary';
            backBtn.setAttribute('data-action', 'wizardBack');
            backBtn.textContent = 'Back';
            nav.appendChild(backBtn);
        }

        if (ws.currentStep < ws.totalSteps - 1) {
            var nextBtn = document.createElement('button');
            nextBtn.className = 'btn btn-primary';
            nextBtn.setAttribute('data-action', 'wizardNext');
            nextBtn.textContent = 'Next';
            nav.appendChild(nextBtn);
        }

        if (step.id === 'review') {
            var genBtn = document.createElement('button');
            genBtn.className = 'btn btn-primary';
            genBtn.setAttribute('data-action', 'wizardGenerate');
            genBtn.textContent = 'Generate Commands';
            nav.appendChild(genBtn);

            if (state.bridgeConnected) {
                var execBtn = document.createElement('button');
                execBtn.className = 'btn btn-success';
                execBtn.setAttribute('data-action', 'wizardExecute');
                execBtn.textContent = 'Execute on Server';
                nav.appendChild(execBtn);
            }
        }

        area.appendChild(nav);
    };

    // ── Step Renderers ──────────────────────────────────────

    var stepRenderers = {};

    // -- Geo-Location --
    stepRenderers.geolocation_zone = function (el, data) {
        addZoneSelector(el, data);
    };

    stepRenderers.geolocation_regions = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Define Geographic Regions';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Each region creates a client subnet, zone scope, and DNS records.';
        el.appendChild(help);

        var regionsContainer = document.createElement('div');
        regionsContainer.id = 'wizardRegions';

        var regions = data.regions || [{ name: '', subnet: '', ip: '' }];
        regions.forEach(function (r, idx) {
            regionsContainer.appendChild(createRegionRow(idx, r));
        });
        el.appendChild(regionsContainer);

        var addBtn = document.createElement('button');
        addBtn.className = 'add-criteria-btn';
        addBtn.setAttribute('data-action', 'wizardAddRegion');
        addBtn.textContent = 'Add Region';
        el.appendChild(addBtn);
    };

    stepRenderers.geolocation_records = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Record Configuration';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Specify the record name that will be resolved differently per region.';
        el.appendChild(help);

        var group = document.createElement('div');
        group.className = 'form-group';
        var label = document.createElement('label');
        label.textContent = 'Record Name (e.g., www)';
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'wizardRecordName';
        input.placeholder = 'www';
        input.value = data.recordName || '';
        group.appendChild(label);
        group.appendChild(input);
        el.appendChild(group);

        var typeGroup = document.createElement('div');
        typeGroup.className = 'form-group';
        var typeLabel = document.createElement('label');
        typeLabel.textContent = 'Record Type';
        var typeSelect = document.createElement('select');
        typeSelect.id = 'wizardRecordType';
        ['A', 'AAAA'].forEach(function (t) {
            var opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            if (data.recordType === t) opt.selected = true;
            typeSelect.appendChild(opt);
        });
        typeGroup.appendChild(typeLabel);
        typeGroup.appendChild(typeSelect);
        el.appendChild(typeGroup);
    };

    // -- Split-Brain --
    stepRenderers.splitbrain_zone = function (el, data) {
        addZoneSelector(el, data);

        var subGroup = document.createElement('div');
        subGroup.className = 'form-group';
        var subLabel = document.createElement('label');
        subLabel.textContent = 'Internal Subnet(s) (comma-separated CIDRs)';
        var subInput = document.createElement('input');
        subInput.type = 'text';
        subInput.id = 'wizardInternalSubnets';
        subInput.placeholder = 'e.g., 10.0.0.0/8, 192.168.0.0/16';
        subInput.value = data.internalSubnets || '';
        subGroup.appendChild(subLabel);
        subGroup.appendChild(subInput);
        el.appendChild(subGroup);

        var nameGroup = document.createElement('div');
        nameGroup.className = 'form-group';
        var nameLabel = document.createElement('label');
        nameLabel.textContent = 'Internal Subnet Name';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'wizardSubnetName';
        nameInput.placeholder = 'e.g., InternalSubnet';
        nameInput.value = data.subnetName || 'InternalSubnet';
        nameGroup.appendChild(nameLabel);
        nameGroup.appendChild(nameInput);
        el.appendChild(nameGroup);
    };

    stepRenderers.splitbrain_records = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Internal Zone Scope Records';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Configure the internal zone scope with records that internal clients should resolve.';
        el.appendChild(help);

        var scopeGroup = document.createElement('div');
        scopeGroup.className = 'form-group';
        var scopeLabel = document.createElement('label');
        scopeLabel.textContent = 'Internal Scope Name';
        var scopeInput = document.createElement('input');
        scopeInput.type = 'text';
        scopeInput.id = 'wizardInternalScopeName';
        scopeInput.value = data.internalScopeName || 'internal';
        scopeGroup.appendChild(scopeLabel);
        scopeGroup.appendChild(scopeInput);
        el.appendChild(scopeGroup);

        var recGroup = document.createElement('div');
        recGroup.className = 'form-group';
        var recLabel = document.createElement('label');
        recLabel.textContent = 'Record Name';
        var recInput = document.createElement('input');
        recInput.type = 'text';
        recInput.id = 'wizardSplitRecordName';
        recInput.placeholder = 'e.g., www';
        recInput.value = data.splitRecordName || '';
        recGroup.appendChild(recLabel);
        recGroup.appendChild(recInput);
        el.appendChild(recGroup);

        var ipGroup = document.createElement('div');
        ipGroup.className = 'form-group';
        var ipLabel = document.createElement('label');
        ipLabel.textContent = 'Internal IP Address';
        var ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.id = 'wizardInternalIP';
        ipInput.placeholder = 'e.g., 10.0.0.5';
        ipInput.value = data.internalIP || '';
        ipGroup.appendChild(ipLabel);
        ipGroup.appendChild(ipInput);
        el.appendChild(ipGroup);
    };

    stepRenderers.splitbrain_recursion = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Recursion Configuration';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Split-brain requires disabling recursion for external clients and enabling it for internal ones.';
        el.appendChild(help);

        var recScopeGroup = document.createElement('div');
        recScopeGroup.className = 'form-group';
        var recScopeLabel = document.createElement('label');
        recScopeLabel.textContent = 'Internal Recursion Scope Name';
        var recScopeInput = document.createElement('input');
        recScopeInput.type = 'text';
        recScopeInput.id = 'wizardInternalRecursionScope';
        recScopeInput.value = data.internalRecursionScope || 'InternalRecursionScope';
        recScopeGroup.appendChild(recScopeLabel);
        recScopeGroup.appendChild(recScopeInput);
        el.appendChild(recScopeGroup);

        var info = document.createElement('div');
        info.className = 'wizard-info-box';
        info.textContent = 'This will: (1) Disable recursion on the default scope ".", (2) Create a new recursion scope with recursion enabled for internal clients.';
        el.appendChild(info);
    };

    stepRenderers.splitbrain_policies = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Policy Configuration';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Two policies will be created: a recursion policy and a query resolution policy.';
        el.appendChild(help);

        var orderGroup = document.createElement('div');
        orderGroup.className = 'form-group';
        var orderLabel = document.createElement('label');
        orderLabel.textContent = 'Base Processing Order';
        var orderInput = document.createElement('input');
        orderInput.type = 'number';
        orderInput.id = 'wizardSplitOrder';
        orderInput.min = '1';
        orderInput.value = data.splitOrder || '1';
        orderGroup.appendChild(orderLabel);
        orderGroup.appendChild(orderInput);
        el.appendChild(orderGroup);
    };

    // -- Blocklist --
    stepRenderers.blocklist_domains = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Import Domains to Block';
        el.appendChild(h);

        var group = document.createElement('div');
        group.className = 'form-group';
        var label = document.createElement('label');
        label.textContent = 'Domains (one per line or comma-separated)';
        var textarea = document.createElement('textarea');
        textarea.id = 'wizardBlocklistDomains';
        textarea.rows = 8;
        textarea.placeholder = '*.malware.com\n*.phishing.net\nbadsite.org';
        textarea.value = data.blocklistDomains || '';
        group.appendChild(label);
        group.appendChild(textarea);
        el.appendChild(group);

        var wildcardGroup = document.createElement('div');
        wildcardGroup.className = 'form-group';
        var wildcardLabel = document.createElement('label');
        var wildcardCheck = document.createElement('input');
        wildcardCheck.type = 'checkbox';
        wildcardCheck.id = 'wizardBlocklistWildcard';
        wildcardCheck.checked = data.blocklistWildcard !== false;
        wildcardLabel.appendChild(wildcardCheck);
        wildcardLabel.appendChild(document.createTextNode(' Add wildcard (*.) prefix to domains'));
        wildcardGroup.appendChild(wildcardLabel);
        el.appendChild(wildcardGroup);
    };

    stepRenderers.blocklist_action = function (el, data) {
        var actionGroup = document.createElement('div');
        actionGroup.className = 'form-group';
        var actionLabel = document.createElement('label');
        actionLabel.textContent = 'Action';
        var actionSelect = document.createElement('select');
        actionSelect.id = 'wizardBlocklistAction';
        [{ v: 'IGNORE', t: 'IGNORE (Drop silently)' }, { v: 'DENY', t: 'DENY (Return refused)' }].forEach(function (a) {
            var opt = document.createElement('option');
            opt.value = a.v;
            opt.textContent = a.t;
            if (data.blocklistAction === a.v) opt.selected = true;
            actionSelect.appendChild(opt);
        });
        actionGroup.appendChild(actionLabel);
        actionGroup.appendChild(actionSelect);
        el.appendChild(actionGroup);

        var nameGroup = document.createElement('div');
        nameGroup.className = 'form-group';
        var nameLabel = document.createElement('label');
        nameLabel.textContent = 'Policy Name Prefix';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'wizardBlocklistPolicyName';
        nameInput.value = data.blocklistPolicyName || 'Blocklist';
        nameGroup.appendChild(nameLabel);
        nameGroup.appendChild(nameInput);
        el.appendChild(nameGroup);
    };

    // -- Time-of-Day --
    stepRenderers.timeofday_zone = function (el, data) {
        addZoneSelector(el, data);

        var fqdnGroup = document.createElement('div');
        fqdnGroup.className = 'form-group';
        var fqdnLabel = document.createElement('label');
        fqdnLabel.textContent = 'FQDN to Route';
        var fqdnInput = document.createElement('input');
        fqdnInput.type = 'text';
        fqdnInput.id = 'wizardTodFqdn';
        fqdnInput.placeholder = 'e.g., *.contoso.com';
        fqdnInput.value = data.todFqdn || '';
        fqdnGroup.appendChild(fqdnLabel);
        fqdnGroup.appendChild(fqdnInput);
        el.appendChild(fqdnGroup);
    };

    stepRenderers.timeofday_windows = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Define Time Windows';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Each window creates a zone scope with records and a policy with time-of-day criteria.';
        el.appendChild(help);

        var container = document.createElement('div');
        container.id = 'wizardTimeWindows';

        var windows = data.timeWindows || [
            { name: 'BusinessHours', timeRange: '09:00-17:00', ip: '' },
            { name: 'OffHours', timeRange: '17:01-08:59', ip: '' }
        ];

        windows.forEach(function (w, idx) {
            var row = document.createElement('div');
            row.className = 'wizard-time-row';

            var nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'wizard-tw-name';
            nameInput.placeholder = 'Scope name';
            nameInput.value = w.name || '';

            var timeInput = document.createElement('input');
            timeInput.type = 'text';
            timeInput.className = 'wizard-tw-time';
            timeInput.placeholder = 'HH:MM-HH:MM';
            timeInput.value = w.timeRange || '';

            var ipInput = document.createElement('input');
            ipInput.type = 'text';
            ipInput.className = 'wizard-tw-ip';
            ipInput.placeholder = 'IP address';
            ipInput.value = w.ip || '';

            row.appendChild(nameInput);
            row.appendChild(timeInput);
            row.appendChild(ipInput);
            container.appendChild(row);
        });

        el.appendChild(container);

        var addBtn = document.createElement('button');
        addBtn.className = 'add-criteria-btn';
        addBtn.setAttribute('data-action', 'wizardAddTimeWindow');
        addBtn.textContent = 'Add Time Window';
        el.appendChild(addBtn);
    };

    // -- Load Balancing --
    stepRenderers.loadbalancing_zone = function (el, data) {
        addZoneSelector(el, data);

        var recGroup = document.createElement('div');
        recGroup.className = 'form-group';
        var recLabel = document.createElement('label');
        recLabel.textContent = 'Record Name (e.g., app)';
        var recInput = document.createElement('input');
        recInput.type = 'text';
        recInput.id = 'wizardLbRecordName';
        recInput.placeholder = 'app';
        recInput.value = data.lbRecordName || '';
        recGroup.appendChild(recLabel);
        recGroup.appendChild(recInput);
        el.appendChild(recGroup);
    };

    stepRenderers.loadbalancing_backends = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Define Backend Servers';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Each backend gets a zone scope with a weighted distribution. Higher weight = more traffic.';
        el.appendChild(help);

        var container = document.createElement('div');
        container.id = 'wizardBackends';

        var backends = data.backends || [
            { name: 'Server1', ip: '', weight: 1 },
            { name: 'Server2', ip: '', weight: 1 }
        ];

        backends.forEach(function (b, idx) {
            container.appendChild(createBackendRow(idx, b));
        });

        el.appendChild(container);

        var addBtn = document.createElement('button');
        addBtn.className = 'add-criteria-btn';
        addBtn.setAttribute('data-action', 'wizardAddBackend');
        addBtn.textContent = 'Add Backend';
        el.appendChild(addBtn);
    };

    // ── Shared Helpers ──────────────────────────────────────

    function addZoneSelector(el, data) {
        var group = document.createElement('div');
        group.className = 'form-group';
        var label = document.createElement('label');
        label.textContent = 'Zone Name';
        var select = document.createElement('select');
        select.id = 'wizardZone';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a zone...';
        select.appendChild(placeholder);

        (state.serverZones || []).forEach(function (z) {
            var zoneName = z.ZoneName || z.zoneName || z;
            var opt = document.createElement('option');
            opt.value = zoneName;
            opt.textContent = zoneName;
            if (data.zone === zoneName) opt.selected = true;
            select.appendChild(opt);
        });

        group.appendChild(label);
        group.appendChild(select);
        el.appendChild(group);
    }

    function createRegionRow(idx, data) {
        var row = document.createElement('div');
        row.className = 'wizard-region-row';

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wizard-region-name';
        nameInput.placeholder = 'Region name (e.g., NorthAmerica)';
        nameInput.value = data.name || '';

        var subnetInput = document.createElement('input');
        subnetInput.type = 'text';
        subnetInput.className = 'wizard-region-subnet';
        subnetInput.placeholder = 'Subnet CIDR (e.g., 10.0.0.0/8)';
        subnetInput.value = data.subnet || '';

        var ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.className = 'wizard-region-ip';
        ipInput.placeholder = 'Target IP for this region';
        ipInput.value = data.ip || '';

        row.appendChild(nameInput);
        row.appendChild(subnetInput);
        row.appendChild(ipInput);
        return row;
    }

    function createBackendRow(idx, data) {
        var row = document.createElement('div');
        row.className = 'wizard-backend-row';

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wizard-be-name';
        nameInput.placeholder = 'Scope name';
        nameInput.value = data.name || '';

        var ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.className = 'wizard-be-ip';
        ipInput.placeholder = 'IP address';
        ipInput.value = data.ip || '';

        var weightInput = document.createElement('input');
        weightInput.type = 'number';
        weightInput.className = 'wizard-be-weight';
        weightInput.placeholder = 'Weight';
        weightInput.min = '1';
        weightInput.value = data.weight || 1;

        row.appendChild(nameInput);
        row.appendChild(ipInput);
        row.appendChild(weightInput);
        return row;
    }

    // ── Dynamic Add Buttons ─────────────────────────────────

    NS.wizardAddRegion = function wizardAddRegion() {
        var container = document.getElementById('wizardRegions');
        if (!container) return;
        var idx = container.children.length;
        container.appendChild(createRegionRow(idx, { name: '', subnet: '', ip: '' }));
    };

    NS.wizardAddTimeWindow = function wizardAddTimeWindow() {
        var container = document.getElementById('wizardTimeWindows');
        if (!container) return;
        var row = document.createElement('div');
        row.className = 'wizard-time-row';

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wizard-tw-name';
        nameInput.placeholder = 'Scope name';

        var timeInput = document.createElement('input');
        timeInput.type = 'text';
        timeInput.className = 'wizard-tw-time';
        timeInput.placeholder = 'HH:MM-HH:MM';

        var ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.className = 'wizard-tw-ip';
        ipInput.placeholder = 'IP address';

        row.appendChild(nameInput);
        row.appendChild(timeInput);
        row.appendChild(ipInput);
        container.appendChild(row);
    };

    NS.wizardAddBackend = function wizardAddBackend() {
        var container = document.getElementById('wizardBackends');
        if (!container) return;
        var idx = container.children.length;
        container.appendChild(createBackendRow(idx, { name: '', ip: '', weight: 1 }));
    };

    // ── Data Collection ─────────────────────────────────────

    function collectCurrentStepData() {
        var ws = state.wizardState;
        var scenario = scenarios[ws.scenarioId];
        if (!scenario) return;

        var step = scenario.steps[ws.currentStep];
        var d = ws.data;

        // Zone selector (shared)
        var zoneEl = document.getElementById('wizardZone');
        if (zoneEl) d.zone = zoneEl.value;

        switch (ws.scenarioId) {
            case 'geolocation':
                if (step.id === 'regions') {
                    d.regions = [];
                    var rows = document.querySelectorAll('.wizard-region-row');
                    for (var i = 0; i < rows.length; i++) {
                        d.regions.push({
                            name: rows[i].querySelector('.wizard-region-name').value.trim(),
                            subnet: rows[i].querySelector('.wizard-region-subnet').value.trim(),
                            ip: rows[i].querySelector('.wizard-region-ip').value.trim()
                        });
                    }
                }
                if (step.id === 'records') {
                    var rnEl = document.getElementById('wizardRecordName');
                    var rtEl = document.getElementById('wizardRecordType');
                    if (rnEl) d.recordName = rnEl.value.trim();
                    if (rtEl) d.recordType = rtEl.value;
                }
                break;

            case 'splitbrain':
                var isEl = document.getElementById('wizardInternalSubnets');
                if (isEl) d.internalSubnets = isEl.value.trim();
                var snEl = document.getElementById('wizardSubnetName');
                if (snEl) d.subnetName = snEl.value.trim();
                var isnEl = document.getElementById('wizardInternalScopeName');
                if (isnEl) d.internalScopeName = isnEl.value.trim();
                var srnEl = document.getElementById('wizardSplitRecordName');
                if (srnEl) d.splitRecordName = srnEl.value.trim();
                var iipEl = document.getElementById('wizardInternalIP');
                if (iipEl) d.internalIP = iipEl.value.trim();
                var irsEl = document.getElementById('wizardInternalRecursionScope');
                if (irsEl) d.internalRecursionScope = irsEl.value.trim();
                var soEl = document.getElementById('wizardSplitOrder');
                if (soEl) d.splitOrder = soEl.value;
                break;

            case 'blocklist':
                var bdEl = document.getElementById('wizardBlocklistDomains');
                if (bdEl) d.blocklistDomains = bdEl.value;
                var bwEl = document.getElementById('wizardBlocklistWildcard');
                if (bwEl) d.blocklistWildcard = bwEl.checked;
                var baEl = document.getElementById('wizardBlocklistAction');
                if (baEl) d.blocklistAction = baEl.value;
                var bpEl = document.getElementById('wizardBlocklistPolicyName');
                if (bpEl) d.blocklistPolicyName = bpEl.value.trim();
                break;

            case 'timeofday':
                var tfEl = document.getElementById('wizardTodFqdn');
                if (tfEl) d.todFqdn = tfEl.value.trim();
                if (step.id === 'windows') {
                    d.timeWindows = [];
                    var twRows = document.querySelectorAll('.wizard-time-row');
                    for (var j = 0; j < twRows.length; j++) {
                        d.timeWindows.push({
                            name: twRows[j].querySelector('.wizard-tw-name').value.trim(),
                            timeRange: twRows[j].querySelector('.wizard-tw-time').value.trim(),
                            ip: twRows[j].querySelector('.wizard-tw-ip').value.trim()
                        });
                    }
                }
                break;

            case 'loadbalancing':
                var lrEl = document.getElementById('wizardLbRecordName');
                if (lrEl) d.lbRecordName = lrEl.value.trim();
                if (step.id === 'backends') {
                    d.backends = [];
                    var beRows = document.querySelectorAll('.wizard-backend-row');
                    for (var k = 0; k < beRows.length; k++) {
                        d.backends.push({
                            name: beRows[k].querySelector('.wizard-be-name').value.trim(),
                            ip: beRows[k].querySelector('.wizard-be-ip').value.trim(),
                            weight: parseInt(beRows[k].querySelector('.wizard-be-weight').value, 10) || 1
                        });
                    }
                }
                break;
        }
    }

    function validateCurrentStep() {
        var ws = state.wizardState;
        var scenario = scenarios[ws.scenarioId];
        var step = scenario.steps[ws.currentStep];

        // Zone validation
        var zoneEl = document.getElementById('wizardZone');
        if (zoneEl && !zoneEl.value) {
            NS.toast.warning('Please select a zone.');
            return false;
        }

        return true;
    }

    // ── Review Step ─────────────────────────────────────────

    function renderReviewStep(el, ws) {
        var h = document.createElement('h4');
        h.textContent = 'Review Generated Commands';
        el.appendChild(h);

        var commands = generateWizardCommands(ws.scenarioId, ws.data);

        var pre = document.createElement('pre');
        pre.className = 'wizard-review-commands';
        pre.textContent = commands;
        el.appendChild(pre);
    }

    // ── Command Generation ──────────────────────────────────

    function generateWizardCommands(scenarioId, data) {
        var params = getServerParams();
        var serverParam = (params && params.server && params.server !== 'localhost')
            ? ' -ComputerName "' + params.server + '"'
            : '';
        var cmds = [];

        switch (scenarioId) {
            case 'geolocation':
                cmds.push('# Geo-Location Routing Configuration');
                cmds.push('# Zone: ' + data.zone);
                cmds.push('');

                (data.regions || []).forEach(function (r, idx) {
                    if (!r.name || !r.subnet) return;
                    cmds.push('# Region: ' + r.name);
                    cmds.push('Add-DnsServerClientSubnet -Name "' + r.name + 'Subnet" -IPv4Subnet "' + r.subnet + '"' + serverParam);
                    cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + r.name + 'Scope"' + serverParam);
                    if (r.ip && data.recordName) {
                        var recType = data.recordType === 'AAAA' ? ' -AAAA -IPv6Address' : ' -A -IPv4Address';
                        cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + r.name + 'Scope" -Name "' + data.recordName + '"' + recType + ' "' + r.ip + '"' + serverParam);
                    }
                    cmds.push('Add-DnsServerQueryResolutionPolicy -Name "' + r.name + 'Policy" -Action ALLOW -ClientSubnet "EQ,' + r.name + 'Subnet" -ZoneScope "' + r.name + 'Scope,1" -ZoneName "' + data.zone + '" -ProcessingOrder ' + (idx + 1) + serverParam);
                    cmds.push('');
                });
                break;

            case 'splitbrain':
                cmds.push('# Split-Brain DNS Configuration');
                cmds.push('# Zone: ' + data.zone);
                cmds.push('');

                cmds.push('# Step 1: Create client subnet for internal network');
                cmds.push('Add-DnsServerClientSubnet -Name "' + (data.subnetName || 'InternalSubnet') + '" -IPv4Subnet "' + data.internalSubnets + '"' + serverParam);
                cmds.push('');

                cmds.push('# Step 2: Create internal zone scope and add records');
                cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + (data.internalScopeName || 'internal') + '"' + serverParam);
                if (data.splitRecordName && data.internalIP) {
                    cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + (data.internalScopeName || 'internal') + '" -A -Name "' + data.splitRecordName + '" -IPv4Address "' + data.internalIP + '"' + serverParam);
                }
                cmds.push('');

                cmds.push('# Step 3: Configure recursion scopes');
                cmds.push('Set-DnsServerRecursionScope -Name "." -EnableRecursion $false' + serverParam);
                cmds.push('Add-DnsServerRecursionScope -Name "' + (data.internalRecursionScope || 'InternalRecursionScope') + '" -EnableRecursion $true' + serverParam);
                cmds.push('');

                var order = parseInt(data.splitOrder, 10) || 1;
                cmds.push('# Step 4: Create recursion policy');
                cmds.push('Add-DnsServerQueryResolutionPolicy -Name "SplitBrainRecursionPolicy" -Action ALLOW -ApplyOnRecursion -RecursionScope "' + (data.internalRecursionScope || 'InternalRecursionScope') + '" -ClientSubnet "EQ,' + (data.subnetName || 'InternalSubnet') + '" -ProcessingOrder ' + order + serverParam);
                cmds.push('');

                cmds.push('# Step 5: Create query resolution policy');
                cmds.push('Add-DnsServerQueryResolutionPolicy -Name "SplitBrainZonePolicy" -Action ALLOW -ClientSubnet "EQ,' + (data.subnetName || 'InternalSubnet') + '" -ZoneScope "' + (data.internalScopeName || 'internal') + ',1" -ZoneName "' + data.zone + '" -ProcessingOrder ' + (order + 1) + serverParam);
                break;

            case 'blocklist':
                cmds.push('# Domain Blocklist Configuration');
                cmds.push('');

                var domains = (data.blocklistDomains || '').split(/[\n,]+/).map(function (d) { return d.trim(); }).filter(function (d) { return d; });
                var action = data.blocklistAction || 'IGNORE';
                var policyName = data.blocklistPolicyName || 'Blocklist';

                if (data.blocklistWildcard) {
                    domains = domains.map(function (d) {
                        return d.indexOf('*.') === 0 ? d : '*.' + d;
                    });
                }

                // Split into groups of 100
                var groupSize = 100;
                for (var i = 0; i < domains.length; i += groupSize) {
                    var batch = domains.slice(i, i + groupSize);
                    var batchNum = Math.floor(i / groupSize) + 1;
                    var name = domains.length > groupSize ? policyName + '_Part' + batchNum : policyName;
                    cmds.push('Add-DnsServerQueryResolutionPolicy -Name "' + name + '" -Action ' + action + ' -FQDN "EQ,' + batch.join(',') + '" -ProcessingOrder ' + batchNum + serverParam);
                }
                break;

            case 'timeofday':
                cmds.push('# Time-of-Day Routing Configuration');
                cmds.push('# Zone: ' + data.zone);
                cmds.push('');

                (data.timeWindows || []).forEach(function (w, idx) {
                    if (!w.name || !w.timeRange) return;
                    cmds.push('# Window: ' + w.name + ' (' + w.timeRange + ')');
                    cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + w.name + 'Scope"' + serverParam);
                    if (w.ip) {
                        cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + w.name + 'Scope" -A -Name "' + (data.todFqdn || '@') + '" -IPv4Address "' + w.ip + '"' + serverParam);
                    }
                    var fqdnParam = data.todFqdn ? ' -FQDN "EQ,' + data.todFqdn + '"' : '';
                    cmds.push('Add-DnsServerQueryResolutionPolicy -Name "' + w.name + 'Policy" -Action ALLOW -ZoneScope "' + w.name + 'Scope,1" -TimeOfDay "EQ,' + w.timeRange + '"' + fqdnParam + ' -ZoneName "' + data.zone + '" -ProcessingOrder ' + (idx + 1) + serverParam);
                    cmds.push('');
                });
                break;

            case 'loadbalancing':
                cmds.push('# Application Load Balancing Configuration');
                cmds.push('# Zone: ' + data.zone);
                cmds.push('');

                var backends = data.backends || [];
                var scopeParts = [];

                backends.forEach(function (b) {
                    if (!b.name || !b.ip) return;
                    cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + b.name + 'Scope"' + serverParam);
                    cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + b.name + 'Scope" -A -Name "' + (data.lbRecordName || '@') + '" -IPv4Address "' + b.ip + '"' + serverParam);
                    scopeParts.push(b.name + 'Scope,' + (b.weight || 1));
                });

                if (scopeParts.length > 0) {
                    cmds.push('');
                    cmds.push('# Weighted policy');
                    cmds.push('Add-DnsServerQueryResolutionPolicy -Name "LoadBalancePolicy" -Action ALLOW -ZoneScope "' + scopeParts.join(';') + '" -ZoneName "' + data.zone + '"' + serverParam);
                }
                break;
        }

        return cmds.join('\n');
    }

    // ── Execute / Generate ──────────────────────────────────

    NS.wizardGenerate = function wizardGenerate() {
        collectCurrentStepData();
        var ws = state.wizardState;
        var commands = generateWizardCommands(ws.scenarioId, ws.data);

        // Show in PowerShell tab
        var output = document.getElementById('powershellOutput');
        var pre = document.createElement('pre');
        pre.textContent = commands;
        output.textContent = '';
        output.appendChild(pre);
        NS.showTab('powershell');
        NS.toast.success('Wizard commands generated. See PowerShell Commands tab.');
    };

    NS.wizardExecute = function wizardExecute() {
        if (!state.bridgeConnected) {
            NS.toast.warning('Bridge is offline. Cannot execute commands.');
            return;
        }

        collectCurrentStepData();
        var ws = state.wizardState;
        var commands = generateWizardCommands(ws.scenarioId, ws.data);

        // Split into individual commands and execute sequentially
        var cmdLines = commands.split('\n').filter(function (line) {
            return line.trim() && line.indexOf('#') !== 0;
        });

        if (cmdLines.length === 0) {
            NS.toast.warning('No commands to execute.');
            return;
        }

        var execBtn = document.querySelector('[data-action="wizardExecute"]');
        if (execBtn) execBtn.classList.add('loading');

        var results = [];
        var idx = 0;

        function executeNext() {
            if (idx >= cmdLines.length) {
                if (execBtn) execBtn.classList.remove('loading');
                showWizardResults(results);
                return;
            }

            var cmd = cmdLines[idx];
            NS.api.execute(cmd).then(function (result) {
                results.push({ command: cmd, success: result.success, output: result.output, error: result.error });
                idx++;
                executeNext();
            });
        }

        executeNext();
    };

    function showWizardResults(results) {
        var successCount = results.filter(function (r) { return r.success; }).length;
        var failCount = results.length - successCount;

        var output = document.getElementById('powershellOutput');
        output.textContent = '';

        var pre = document.createElement('pre');
        var text = '# Wizard Execution Results\n';
        text += '# ' + successCount + ' succeeded, ' + failCount + ' failed\n\n';

        results.forEach(function (r) {
            text += (r.success ? '[OK] ' : '[FAIL] ') + r.command + '\n';
            if (r.error) text += '  Error: ' + r.error + '\n';
            if (r.output) text += '  ' + r.output.trim() + '\n';
            text += '\n';
        });

        pre.textContent = text;
        output.appendChild(pre);
        NS.showTab('powershell');

        if (failCount === 0) {
            NS.toast.success('All ' + successCount + ' wizard commands executed successfully!');
        } else {
            NS.toast.warning(successCount + ' succeeded, ' + failCount + ' failed. Check output.');
        }

        // Refresh DNS objects
        if (NS.loadSubnets) NS.loadSubnets();
        if (NS.loadRecursionScopes) NS.loadRecursionScopes();
    }
})();
