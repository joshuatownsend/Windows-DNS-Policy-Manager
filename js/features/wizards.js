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
            description: 'Serve different answers to internal vs. external clients for the same zone (MS Scenarios 5 & 6).',
            icon: '\uD83D\uDD00',
            steps: [
                { id: 'method', title: 'Choose Method', fields: ['method'] },
                { id: 'zone', title: 'Select Zone & Network', fields: ['zone', 'internalSubnets'] },
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
            description: 'Route queries using weighted zone scopes based on time of day, with optional geo-location awareness (MS Scenarios 3 & 4).',
            icon: '\u23F0',
            steps: [
                { id: 'zone', title: 'Select Zone & Record', fields: ['zone', 'recordName'] },
                { id: 'datacenters', title: 'Define Datacenters', fields: ['datacenters'] },
                { id: 'peakhours', title: 'Peak Hours & Offload', fields: ['peakhours'] },
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
        },
        geolb: {
            id: 'geolb',
            title: 'Geo-Location + Load Balancing',
            description: 'Combine geographic routing with weighted load balancing across datacenters (MS Scenario 9).',
            icon: '\uD83C\uDF10',
            steps: [
                { id: 'zone', title: 'Select Zone & Record', fields: ['zone', 'recordName'] },
                { id: 'regions', title: 'Define Regions & Subnets', fields: ['regions'] },
                { id: 'datacenters', title: 'Datacenters & Weights per Region', fields: ['datacenters'] },
                { id: 'review', title: 'Review & Execute', fields: [] }
            ]
        },
        primarysecondary: {
            id: 'primarysecondary',
            title: 'Primary-Secondary Geo-Location',
            description: 'Configure geo-location on primary, replicate to secondary DNS servers (MS Scenario 2).',
            icon: '\uD83D\uDD04',
            steps: [
                { id: 'primary', title: 'Primary Server Geo Setup', fields: ['zone', 'regions'] },
                { id: 'secondaries', title: 'Define Secondary Servers', fields: ['secondaries'] },
                { id: 'review', title: 'Review & Execute', fields: [] }
            ]
        },
        queryfilter: {
            id: 'queryfilter',
            title: 'Query Filters (Block/Allow)',
            description: 'Block or allow DNS queries by domain, subnet, query type, or combinations (MS Scenario 7).',
            icon: '\uD83D\uDEE1\uFE0F',
            steps: [
                { id: 'mode', title: 'Filter Mode & Criteria', fields: ['mode', 'criteriaType'] },
                { id: 'values', title: 'Define Filter Values', fields: ['values'] },
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

        // Default / Fallback record for unmatched clients
        var fallbackGroup = document.createElement('div');
        fallbackGroup.className = 'form-group';
        var fallbackLabel = document.createElement('label');
        fallbackLabel.textContent = 'Default / Fallback IP (for clients not matching any region)';
        var fallbackInput = document.createElement('input');
        fallbackInput.type = 'text';
        fallbackInput.id = 'wizardFallbackIP';
        fallbackInput.placeholder = 'e.g., 198.51.100.1 (added to default zone scope)';
        fallbackInput.value = data.fallbackIP || '';
        fallbackGroup.appendChild(fallbackLabel);
        fallbackGroup.appendChild(fallbackInput);
        el.appendChild(fallbackGroup);

        var fallbackHelp = document.createElement('p');
        fallbackHelp.className = 'form-help';
        fallbackHelp.textContent = 'Microsoft recommends adding a record to the default zone scope so clients from unmatched regions still receive a response.';
        el.appendChild(fallbackHelp);
    };

    // -- Split-Brain --
    stepRenderers.splitbrain_method = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Choose Split-Brain Method';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Microsoft documents two approaches for identifying internal vs. external clients:';
        el.appendChild(help);

        var methodGroup = document.createElement('div');
        methodGroup.className = 'form-group';
        var methodLabel = document.createElement('label');
        methodLabel.textContent = 'Method';
        var methodSelect = document.createElement('select');
        methodSelect.id = 'wizardSplitMethod';
        [
            { v: 'subnet', t: 'By Client Subnet \u2014 Match internal clients by subnet CIDR (MS Scenario 5a)' },
            { v: 'interface', t: 'By Server Interface \u2014 Match by which NIC receives the query (MS Scenario 5b/6)' }
        ].forEach(function (m) {
            var opt = document.createElement('option');
            opt.value = m.v;
            opt.textContent = m.t;
            if (data.splitMethod === m.v) opt.selected = true;
            methodSelect.appendChild(opt);
        });
        methodGroup.appendChild(methodLabel);
        methodGroup.appendChild(methodSelect);
        el.appendChild(methodGroup);

        // AD option
        var adGroup = document.createElement('div');
        adGroup.className = 'form-group';
        var adLabel = document.createElement('label');
        adLabel.className = 'checkbox-label';
        var adCheck = document.createElement('input');
        adCheck.type = 'checkbox';
        adCheck.id = 'wizardSplitAD';
        adCheck.checked = data.splitAD === true;
        adLabel.appendChild(adCheck);
        adLabel.appendChild(document.createTextNode(' Active Directory integrated zone (MS Scenario 6)'));
        adGroup.appendChild(adLabel);
        el.appendChild(adGroup);

        var adHelp = document.createElement('p');
        adHelp.className = 'form-help';
        adHelp.textContent = 'AD-integrated zones replicate zone scopes automatically, but policies do NOT replicate. This option adds zone creation and policy copy commands.';
        el.appendChild(adHelp);
    };

    stepRenderers.splitbrain_zone = function (el, data) {
        addZoneSelector(el, data);

        if (data.splitMethod === 'interface') {
            // Server Interface method
            var ifGroup = document.createElement('div');
            ifGroup.className = 'form-group';
            var ifLabel = document.createElement('label');
            ifLabel.textContent = 'Internal (Private) Interface IP';
            var ifInput = document.createElement('input');
            ifInput.type = 'text';
            ifInput.id = 'wizardInternalInterface';
            ifInput.placeholder = 'e.g., 10.0.0.1';
            ifInput.value = data.internalInterface || '';
            ifGroup.appendChild(ifLabel);
            ifGroup.appendChild(ifInput);
            el.appendChild(ifGroup);

            var ifHelp = document.createElement('p');
            ifHelp.className = 'form-help';
            ifHelp.textContent = 'The IP address of the network interface connected to the internal network. Queries arriving on this interface will receive internal answers.';
            el.appendChild(ifHelp);
        } else {
            // Client Subnet method (original)
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
        }
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

        var recGroup = document.createElement('div');
        recGroup.className = 'form-group';
        var recLabel = document.createElement('label');
        recLabel.textContent = 'Record Name (e.g., www)';
        var recInput = document.createElement('input');
        recInput.type = 'text';
        recInput.id = 'wizardTodRecordName';
        recInput.placeholder = 'www';
        recInput.value = data.todRecordName || '';
        recGroup.appendChild(recLabel);
        recGroup.appendChild(recInput);
        el.appendChild(recGroup);

        var ttlGroup = document.createElement('div');
        ttlGroup.className = 'form-group';
        var ttlLabel = document.createElement('label');
        ttlLabel.textContent = 'Record TTL (seconds, optional \u2014 use low value like 600 for cloud offload)';
        var ttlInput = document.createElement('input');
        ttlInput.type = 'number';
        ttlInput.id = 'wizardTodTtl';
        ttlInput.placeholder = '3600';
        ttlInput.min = '0';
        ttlInput.value = data.todTtl || '';
        ttlGroup.appendChild(ttlLabel);
        ttlGroup.appendChild(ttlInput);
        el.appendChild(ttlGroup);
    };

    stepRenderers.timeofday_datacenters = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Define Datacenters';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Each datacenter gets a zone scope with records. During peak hours, traffic is distributed between them using weights.';
        el.appendChild(help);

        var container = document.createElement('div');
        container.id = 'wizardTodDatacenters';

        var dcs = data.todDatacenters || [
            { name: 'Primary', ip: '', subnet: '' },
            { name: 'Cloud', ip: '', subnet: '' }
        ];

        dcs.forEach(function (dc, idx) {
            var row = document.createElement('div');
            row.className = 'wizard-backend-row';

            var nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'wizard-tod-dc-name';
            nameInput.placeholder = 'Datacenter name (e.g., Seattle)';
            nameInput.value = dc.name || '';

            var ipInput = document.createElement('input');
            ipInput.type = 'text';
            ipInput.className = 'wizard-tod-dc-ip';
            ipInput.placeholder = 'IP address';
            ipInput.value = dc.ip || '';

            var subnetInput = document.createElement('input');
            subnetInput.type = 'text';
            subnetInput.className = 'wizard-tod-dc-subnet';
            subnetInput.placeholder = 'Client subnet CIDR (optional)';
            subnetInput.value = dc.subnet || '';

            row.appendChild(nameInput);
            row.appendChild(ipInput);
            row.appendChild(subnetInput);
            container.appendChild(row);
        });

        el.appendChild(container);

        var addBtn = document.createElement('button');
        addBtn.className = 'add-criteria-btn';
        addBtn.setAttribute('data-action', 'wizardAddTodDatacenter');
        addBtn.textContent = 'Add Datacenter';
        el.appendChild(addBtn);

        var subnetHelp = document.createElement('p');
        subnetHelp.className = 'form-help';
        subnetHelp.textContent = 'Client subnet is optional. If provided, creates region-aware time-of-day routing (MS Scenario 3). If omitted, creates simple time-based cloud offload (MS Scenario 4).';
        el.appendChild(subnetHelp);
    };

    stepRenderers.timeofday_peakhours = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Peak Hours & Traffic Distribution';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'During peak hours, traffic is distributed across datacenters using weights. Outside peak hours, each region uses its own datacenter (or the default scope).';
        el.appendChild(help);

        var peakGroup = document.createElement('div');
        peakGroup.className = 'form-group';
        var peakLabel = document.createElement('label');
        peakLabel.textContent = 'Peak Hours (e.g., 18:00-21:00)';
        var peakInput = document.createElement('input');
        peakInput.type = 'text';
        peakInput.id = 'wizardTodPeakHours';
        peakInput.placeholder = '18:00-21:00';
        peakInput.value = data.todPeakHours || '';
        peakGroup.appendChild(peakLabel);
        peakGroup.appendChild(peakInput);
        el.appendChild(peakGroup);

        // Weight configuration per datacenter
        var weightHeader = document.createElement('h4');
        weightHeader.textContent = 'Peak-Hour Weights per Datacenter';
        el.appendChild(weightHeader);

        var weightHelp = document.createElement('p');
        weightHelp.className = 'form-help';
        weightHelp.textContent = 'Higher weight = more traffic. E.g., Primary=4, Cloud=1 means 80/20 split.';
        el.appendChild(weightHelp);

        var weightContainer = document.createElement('div');
        weightContainer.id = 'wizardTodWeights';

        var dcs = data.todDatacenters || [];
        var weights = data.todWeights || {};
        dcs.forEach(function (dc) {
            if (!dc.name) return;
            var row = document.createElement('div');
            row.className = 'wizard-time-row';

            var nameSpan = document.createElement('span');
            nameSpan.className = 'wizard-weight-label';
            nameSpan.textContent = dc.name;
            nameSpan.style.minWidth = '150px';
            nameSpan.style.display = 'inline-block';

            var weightInput = document.createElement('input');
            weightInput.type = 'number';
            weightInput.className = 'wizard-tod-weight';
            weightInput.setAttribute('data-dc', dc.name);
            weightInput.min = '1';
            weightInput.value = weights[dc.name] || 1;
            weightInput.style.width = '80px';

            row.appendChild(nameSpan);
            row.appendChild(weightInput);
            weightContainer.appendChild(row);
        });

        el.appendChild(weightContainer);
    };

    // -- Load Balancing --
    stepRenderers.loadbalancing_zone = function (el, data) {
        addZoneSelector(el, data);

        var recGroup = document.createElement('div');
        recGroup.className = 'form-group';
        var recLabel = document.createElement('label');
        recLabel.textContent = 'Record Name (e.g., app, www, or @ for zone apex)';
        var recInput = document.createElement('input');
        recInput.type = 'text';
        recInput.id = 'wizardLbRecordName';
        recInput.placeholder = 'www (or @ for zone apex)';
        recInput.value = data.lbRecordName || '';
        recGroup.appendChild(recLabel);
        recGroup.appendChild(recInput);
        el.appendChild(recGroup);

        var ttlGroup = document.createElement('div');
        ttlGroup.className = 'form-group';
        var ttlLabel = document.createElement('label');
        ttlLabel.textContent = 'Record TTL (seconds, optional)';
        var ttlInput = document.createElement('input');
        ttlInput.type = 'number';
        ttlInput.id = 'wizardLbTtl';
        ttlInput.placeholder = '300';
        ttlInput.min = '0';
        ttlInput.value = data.lbTtl || '';
        ttlGroup.appendChild(ttlLabel);
        ttlGroup.appendChild(ttlInput);
        el.appendChild(ttlGroup);

        var ttlHelp = document.createElement('p');
        ttlHelp.className = 'form-help';
        ttlHelp.textContent = 'Microsoft recommends a low TTL (e.g., 300s) for load-balanced records so clients re-resolve frequently and traffic is distributed evenly.';
        el.appendChild(ttlHelp);
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

    // -- Geo + Load Balancing (Scenario 9) --
    stepRenderers.geolb_zone = function (el, data) {
        addZoneSelector(el, data);

        var recGroup = document.createElement('div');
        recGroup.className = 'form-group';
        var recLabel = document.createElement('label');
        recLabel.textContent = 'Record Name (e.g., www)';
        var recInput = document.createElement('input');
        recInput.type = 'text';
        recInput.id = 'wizardGeolbRecordName';
        recInput.placeholder = 'www';
        recInput.value = data.geolbRecordName || '';
        recGroup.appendChild(recLabel);
        recGroup.appendChild(recInput);
        el.appendChild(recGroup);
    };

    stepRenderers.geolb_regions = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Define Geographic Regions';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Each region gets a client subnet. In the next step, you\'ll assign datacenters and weights per region.';
        el.appendChild(help);

        var container = document.createElement('div');
        container.id = 'wizardGeolbRegions';

        var regions = data.geolbRegions || [{ name: '', subnet: '' }];
        regions.forEach(function (r) {
            var row = document.createElement('div');
            row.className = 'wizard-region-row';

            var nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'wizard-geolb-region-name';
            nameInput.placeholder = 'Region name (e.g., NorthAmerica)';
            nameInput.value = r.name || '';

            var subnetInput = document.createElement('input');
            subnetInput.type = 'text';
            subnetInput.className = 'wizard-geolb-region-subnet';
            subnetInput.placeholder = 'Subnet CIDR (e.g., 10.0.0.0/8)';
            subnetInput.value = r.subnet || '';

            row.appendChild(nameInput);
            row.appendChild(subnetInput);
            container.appendChild(row);
        });

        el.appendChild(container);

        var addBtn = document.createElement('button');
        addBtn.className = 'add-criteria-btn';
        addBtn.setAttribute('data-action', 'wizardAddGeolbRegion');
        addBtn.textContent = 'Add Region';
        el.appendChild(addBtn);
    };

    stepRenderers.geolb_datacenters = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Datacenters & Weights per Region';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Define datacenters (each gets a zone scope). Then set weights for how traffic from each region is distributed.';
        el.appendChild(help);

        // Datacenter definitions
        var dcHeader = document.createElement('h4');
        dcHeader.textContent = 'Datacenters';
        dcHeader.style.marginTop = '16px';
        el.appendChild(dcHeader);

        var dcContainer = document.createElement('div');
        dcContainer.id = 'wizardGeolbDatacenters';

        var dcs = data.geolbDatacenters || [{ name: '', ip: '' }];
        dcs.forEach(function (dc) {
            var row = document.createElement('div');
            row.className = 'wizard-backend-row';

            var nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'wizard-geolb-dc-name';
            nameInput.placeholder = 'Datacenter name (e.g., Seattle)';
            nameInput.value = dc.name || '';

            var ipInput = document.createElement('input');
            ipInput.type = 'text';
            ipInput.className = 'wizard-geolb-dc-ip';
            ipInput.placeholder = 'IP address';
            ipInput.value = dc.ip || '';

            row.appendChild(nameInput);
            row.appendChild(ipInput);
            dcContainer.appendChild(row);
        });
        el.appendChild(dcContainer);

        var addDcBtn = document.createElement('button');
        addDcBtn.className = 'add-criteria-btn';
        addDcBtn.setAttribute('data-action', 'wizardAddGeolbDatacenter');
        addDcBtn.textContent = 'Add Datacenter';
        el.appendChild(addDcBtn);

        // Per-region weight table
        var regions = data.geolbRegions || [];
        var validDcs = dcs.filter(function (d) { return d.name; });
        var regionWeights = data.geolbRegionWeights || {};

        if (regions.length > 0 && validDcs.length > 0) {
            var wHeader = document.createElement('h4');
            wHeader.textContent = 'Weights per Region';
            wHeader.style.marginTop = '16px';
            el.appendChild(wHeader);

            var wHelp = document.createElement('p');
            wHelp.className = 'form-help';
            wHelp.textContent = 'Set the weight for each datacenter in each region. Higher weight = more traffic.';
            el.appendChild(wHelp);

            var wContainer = document.createElement('div');
            wContainer.id = 'wizardGeolbWeights';

            regions.forEach(function (reg) {
                if (!reg.name) return;
                var regDiv = document.createElement('div');
                regDiv.className = 'wizard-info-box';
                regDiv.style.marginBottom = '8px';

                var regTitle = document.createElement('strong');
                regTitle.textContent = reg.name + ':';
                regDiv.appendChild(regTitle);

                var rWeights = regionWeights[reg.name] || {};
                validDcs.forEach(function (dc) {
                    var label = document.createElement('span');
                    label.style.marginLeft = '12px';
                    label.textContent = ' ' + dc.name + ': ';
                    var wInput = document.createElement('input');
                    wInput.type = 'number';
                    wInput.className = 'wizard-geolb-weight';
                    wInput.setAttribute('data-region', reg.name);
                    wInput.setAttribute('data-dc', dc.name);
                    wInput.min = '1';
                    wInput.value = rWeights[dc.name] || 1;
                    wInput.style.width = '60px';
                    regDiv.appendChild(label);
                    regDiv.appendChild(wInput);
                });
                wContainer.appendChild(regDiv);
            });
            el.appendChild(wContainer);
        }

        // Worldwide fallback
        var fbHeader = document.createElement('h4');
        fbHeader.textContent = 'Worldwide Fallback';
        fbHeader.style.marginTop = '16px';
        el.appendChild(fbHeader);
        var fbHelp = document.createElement('p');
        fbHelp.className = 'form-help';
        fbHelp.textContent = 'A catch-all policy distributes traffic equally to all datacenters for clients not matching any region.';
        el.appendChild(fbHelp);

        var fbCheck = document.createElement('label');
        fbCheck.className = 'checkbox-label';
        var fbInput = document.createElement('input');
        fbInput.type = 'checkbox';
        fbInput.id = 'wizardGeolbWorldwide';
        fbInput.checked = data.geolbWorldwide !== false;
        fbCheck.appendChild(fbInput);
        fbCheck.appendChild(document.createTextNode(' Include worldwide catch-all policy'));
        el.appendChild(fbCheck);
    };

    // -- Primary-Secondary (Scenario 2) --
    stepRenderers.primarysecondary_primary = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Primary Server Geo-Location Setup';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Configure geo-location routing on the primary server. This reuses the same setup as the Geo-Location wizard.';
        el.appendChild(help);

        addZoneSelector(el, data);

        var recGroup = document.createElement('div');
        recGroup.className = 'form-group';
        var recLabel = document.createElement('label');
        recLabel.textContent = 'Record Name';
        var recInput = document.createElement('input');
        recInput.type = 'text';
        recInput.id = 'wizardPsRecordName';
        recInput.placeholder = 'www';
        recInput.value = data.psRecordName || '';
        recGroup.appendChild(recLabel);
        recGroup.appendChild(recInput);
        el.appendChild(recGroup);

        var regionHeader = document.createElement('h4');
        regionHeader.textContent = 'Regions';
        regionHeader.style.marginTop = '16px';
        el.appendChild(regionHeader);

        var container = document.createElement('div');
        container.id = 'wizardPsRegions';

        var regions = data.psRegions || [{ name: '', subnet: '', ip: '' }];
        regions.forEach(function (r) {
            container.appendChild(createRegionRow(container.children.length, r));
        });
        el.appendChild(container);

        var addBtn = document.createElement('button');
        addBtn.className = 'add-criteria-btn';
        addBtn.setAttribute('data-action', 'wizardAddPsRegion');
        addBtn.textContent = 'Add Region';
        el.appendChild(addBtn);
    };

    stepRenderers.primarysecondary_secondaries = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Define Secondary DNS Servers';
        el.appendChild(h);

        var help = document.createElement('p');
        help.className = 'form-help';
        help.textContent = 'Secondary servers will receive zone transfers from the primary. Subnets, scopes, and policies will be copied.';
        el.appendChild(help);

        var container = document.createElement('div');
        container.id = 'wizardPsSecondaries';

        var secondaries = data.psSecondaries || [{ name: '', ip: '' }];
        secondaries.forEach(function (s) {
            var row = document.createElement('div');
            row.className = 'wizard-backend-row';

            var nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'wizard-ps-sec-name';
            nameInput.placeholder = 'Secondary server hostname';
            nameInput.value = s.name || '';

            var ipInput = document.createElement('input');
            ipInput.type = 'text';
            ipInput.className = 'wizard-ps-sec-ip';
            ipInput.placeholder = 'Secondary server IP';
            ipInput.value = s.ip || '';

            row.appendChild(nameInput);
            row.appendChild(ipInput);
            container.appendChild(row);
        });
        el.appendChild(container);

        var addBtn = document.createElement('button');
        addBtn.className = 'add-criteria-btn';
        addBtn.setAttribute('data-action', 'wizardAddPsSecondary');
        addBtn.textContent = 'Add Secondary Server';
        el.appendChild(addBtn);
    };

    // -- Query Filter (Scenario 7) --
    stepRenderers.queryfilter_mode = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Filter Mode & Criteria Type';
        el.appendChild(h);

        // Mode: blocklist or allowlist
        var modeGroup = document.createElement('div');
        modeGroup.className = 'form-group';
        var modeLabel = document.createElement('label');
        modeLabel.textContent = 'Filter Mode';
        var modeSelect = document.createElement('select');
        modeSelect.id = 'wizardFilterMode';
        [
            { v: 'blocklist', t: 'Blocklist \u2014 Block matching queries (DENY/IGNORE)' },
            { v: 'allowlist', t: 'Allowlist \u2014 Block non-matching queries (IGNORE with NE)' }
        ].forEach(function (m) {
            var opt = document.createElement('option');
            opt.value = m.v;
            opt.textContent = m.t;
            if (data.filterMode === m.v) opt.selected = true;
            modeSelect.appendChild(opt);
        });
        modeGroup.appendChild(modeLabel);
        modeGroup.appendChild(modeSelect);
        el.appendChild(modeGroup);

        // Action (for blocklist mode)
        var actionGroup = document.createElement('div');
        actionGroup.className = 'form-group';
        var actionLabel = document.createElement('label');
        actionLabel.textContent = 'Action (for blocklist mode)';
        var actionSelect = document.createElement('select');
        actionSelect.id = 'wizardFilterAction';
        [
            { v: 'IGNORE', t: 'IGNORE (Drop silently)' },
            { v: 'DENY', t: 'DENY (Return refused)' }
        ].forEach(function (a) {
            var opt = document.createElement('option');
            opt.value = a.v;
            opt.textContent = a.t;
            if (data.filterAction === a.v) opt.selected = true;
            actionSelect.appendChild(opt);
        });
        actionGroup.appendChild(actionLabel);
        actionGroup.appendChild(actionSelect);
        el.appendChild(actionGroup);

        // Criteria type
        var critGroup = document.createElement('div');
        critGroup.className = 'form-group';
        var critLabel = document.createElement('label');
        critLabel.textContent = 'Criteria Type(s)';
        var critContainer = document.createElement('div');
        critContainer.id = 'wizardFilterCriteriaTypes';

        var types = [
            { v: 'FQDN', t: 'FQDN (Domain Names)', checked: true },
            { v: 'ClientSubnet', t: 'Client Subnet' },
            { v: 'QType', t: 'Query Type (A, AAAA, ANY, etc.)' },
            { v: 'ServerInterfaceIP', t: 'Server Interface IP' }
        ];
        var selectedCriteria = data.filterCriteria || ['FQDN'];
        types.forEach(function (t) {
            var cLabel = document.createElement('label');
            cLabel.className = 'checkbox-label';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'wizard-filter-crit-cb';
            cb.value = t.v;
            cb.checked = selectedCriteria.indexOf(t.v) !== -1;
            cLabel.appendChild(cb);
            cLabel.appendChild(document.createTextNode(' ' + t.t));
            critContainer.appendChild(cLabel);
        });
        critGroup.appendChild(critLabel);
        critGroup.appendChild(critContainer);
        el.appendChild(critGroup);

        // Policy name
        var nameGroup = document.createElement('div');
        nameGroup.className = 'form-group';
        var nameLabel2 = document.createElement('label');
        nameLabel2.textContent = 'Policy Name';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'wizardFilterPolicyName';
        nameInput.value = data.filterPolicyName || 'QueryFilter';
        nameGroup.appendChild(nameLabel2);
        nameGroup.appendChild(nameInput);
        el.appendChild(nameGroup);
    };

    stepRenderers.queryfilter_values = function (el, data) {
        var h = document.createElement('h4');
        h.textContent = 'Define Filter Values';
        el.appendChild(h);

        var selectedCriteria = data.filterCriteria || ['FQDN'];

        if (selectedCriteria.indexOf('FQDN') !== -1) {
            var fqdnGroup = document.createElement('div');
            fqdnGroup.className = 'form-group';
            var fqdnLabel = document.createElement('label');
            fqdnLabel.textContent = 'Domains (one per line or comma-separated)';
            var fqdnArea = document.createElement('textarea');
            fqdnArea.id = 'wizardFilterFqdns';
            fqdnArea.rows = 5;
            fqdnArea.placeholder = '*.malware.com\n*.phishing.net\nbadsite.org';
            fqdnArea.value = data.filterFqdns || '';
            fqdnGroup.appendChild(fqdnLabel);
            fqdnGroup.appendChild(fqdnArea);
            el.appendChild(fqdnGroup);
        }

        if (selectedCriteria.indexOf('ClientSubnet') !== -1) {
            var subGroup = document.createElement('div');
            subGroup.className = 'form-group';
            var subLabel = document.createElement('label');
            subLabel.textContent = 'Client Subnets (comma-separated CIDRs or subnet names)';
            var subInput = document.createElement('input');
            subInput.type = 'text';
            subInput.id = 'wizardFilterSubnets';
            subInput.placeholder = '10.0.0.0/8, BlockedSubnet';
            subInput.value = data.filterSubnets || '';
            subGroup.appendChild(subLabel);
            subGroup.appendChild(subInput);
            el.appendChild(subGroup);
        }

        if (selectedCriteria.indexOf('QType') !== -1) {
            var qtGroup = document.createElement('div');
            qtGroup.className = 'form-group';
            var qtLabel = document.createElement('label');
            qtLabel.textContent = 'Query Types (comma-separated)';
            var qtInput = document.createElement('input');
            qtInput.type = 'text';
            qtInput.id = 'wizardFilterQTypes';
            qtInput.placeholder = 'ANY, AXFR';
            qtInput.value = data.filterQTypes || '';
            qtGroup.appendChild(qtLabel);
            qtGroup.appendChild(qtInput);
            el.appendChild(qtGroup);
        }

        if (selectedCriteria.indexOf('ServerInterfaceIP') !== -1) {
            var siGroup = document.createElement('div');
            siGroup.className = 'form-group';
            var siLabel = document.createElement('label');
            siLabel.textContent = 'Server Interface IPs (comma-separated)';
            var siInput = document.createElement('input');
            siInput.type = 'text';
            siInput.id = 'wizardFilterServerIPs';
            siInput.placeholder = '10.0.0.1, 192.168.1.10';
            siInput.value = data.filterServerIPs || '';
            siGroup.appendChild(siLabel);
            siGroup.appendChild(siInput);
            el.appendChild(siGroup);
        }

        var condGroup = document.createElement('div');
        condGroup.className = 'form-group';
        var condLabel = document.createElement('label');
        condLabel.textContent = 'Condition (when using multiple criteria)';
        var condSelect = document.createElement('select');
        condSelect.id = 'wizardFilterCondition';
        ['AND', 'OR'].forEach(function (c) {
            var opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            if (data.filterCondition === c) opt.selected = true;
            condSelect.appendChild(opt);
        });
        condGroup.appendChild(condLabel);
        condGroup.appendChild(condSelect);
        el.appendChild(condGroup);
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
        // Legacy — redirect to datacenter add for ToD wizard
        NS.wizardAddTodDatacenter();
    };

    NS.wizardAddTodDatacenter = function wizardAddTodDatacenter() {
        var container = document.getElementById('wizardTodDatacenters');
        if (!container) return;
        var row = document.createElement('div');
        row.className = 'wizard-backend-row';

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wizard-tod-dc-name';
        nameInput.placeholder = 'Datacenter name';

        var ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.className = 'wizard-tod-dc-ip';
        ipInput.placeholder = 'IP address';

        var subnetInput = document.createElement('input');
        subnetInput.type = 'text';
        subnetInput.className = 'wizard-tod-dc-subnet';
        subnetInput.placeholder = 'Client subnet CIDR (optional)';

        row.appendChild(nameInput);
        row.appendChild(ipInput);
        row.appendChild(subnetInput);
        container.appendChild(row);
    };

    NS.wizardAddBackend = function wizardAddBackend() {
        var container = document.getElementById('wizardBackends');
        if (!container) return;
        var idx = container.children.length;
        container.appendChild(createBackendRow(idx, { name: '', ip: '', weight: 1 }));
    };

    NS.wizardAddGeolbRegion = function wizardAddGeolbRegion() {
        var container = document.getElementById('wizardGeolbRegions');
        if (!container) return;
        var row = document.createElement('div');
        row.className = 'wizard-region-row';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wizard-geolb-region-name';
        nameInput.placeholder = 'Region name';
        var subnetInput = document.createElement('input');
        subnetInput.type = 'text';
        subnetInput.className = 'wizard-geolb-region-subnet';
        subnetInput.placeholder = 'Subnet CIDR';
        row.appendChild(nameInput);
        row.appendChild(subnetInput);
        container.appendChild(row);
    };

    NS.wizardAddGeolbDatacenter = function wizardAddGeolbDatacenter() {
        var container = document.getElementById('wizardGeolbDatacenters');
        if (!container) return;
        var row = document.createElement('div');
        row.className = 'wizard-backend-row';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wizard-geolb-dc-name';
        nameInput.placeholder = 'Datacenter name';
        var ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.className = 'wizard-geolb-dc-ip';
        ipInput.placeholder = 'IP address';
        row.appendChild(nameInput);
        row.appendChild(ipInput);
        container.appendChild(row);
    };

    NS.wizardAddPsRegion = function wizardAddPsRegion() {
        var container = document.getElementById('wizardPsRegions');
        if (!container) return;
        container.appendChild(createRegionRow(container.children.length, { name: '', subnet: '', ip: '' }));
    };

    NS.wizardAddPsSecondary = function wizardAddPsSecondary() {
        var container = document.getElementById('wizardPsSecondaries');
        if (!container) return;
        var row = document.createElement('div');
        row.className = 'wizard-backend-row';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wizard-ps-sec-name';
        nameInput.placeholder = 'Secondary server hostname';
        var ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.className = 'wizard-ps-sec-ip';
        ipInput.placeholder = 'Secondary server IP';
        row.appendChild(nameInput);
        row.appendChild(ipInput);
        container.appendChild(row);
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
                    var fbEl = document.getElementById('wizardFallbackIP');
                    if (rnEl) d.recordName = rnEl.value.trim();
                    if (rtEl) d.recordType = rtEl.value;
                    if (fbEl) d.fallbackIP = fbEl.value.trim();
                }
                break;

            case 'splitbrain':
                var smEl = document.getElementById('wizardSplitMethod');
                if (smEl) d.splitMethod = smEl.value;
                var adEl = document.getElementById('wizardSplitAD');
                if (adEl) d.splitAD = adEl.checked;
                var iiEl = document.getElementById('wizardInternalInterface');
                if (iiEl) d.internalInterface = iiEl.value.trim();
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
                var trEl = document.getElementById('wizardTodRecordName');
                if (trEl) d.todRecordName = trEl.value.trim();
                var ttlEl2 = document.getElementById('wizardTodTtl');
                if (ttlEl2) d.todTtl = ttlEl2.value.trim();
                if (step.id === 'datacenters') {
                    d.todDatacenters = [];
                    var dcRows = document.querySelectorAll('.wizard-backend-row');
                    for (var j = 0; j < dcRows.length; j++) {
                        var nameEl2 = dcRows[j].querySelector('.wizard-tod-dc-name');
                        var ipEl2 = dcRows[j].querySelector('.wizard-tod-dc-ip');
                        var subEl2 = dcRows[j].querySelector('.wizard-tod-dc-subnet');
                        if (nameEl2 && ipEl2) {
                            d.todDatacenters.push({
                                name: nameEl2.value.trim(),
                                ip: ipEl2.value.trim(),
                                subnet: subEl2 ? subEl2.value.trim() : ''
                            });
                        }
                    }
                }
                if (step.id === 'peakhours') {
                    var phEl = document.getElementById('wizardTodPeakHours');
                    if (phEl) d.todPeakHours = phEl.value.trim();
                    d.todWeights = {};
                    var weightInputs = document.querySelectorAll('.wizard-tod-weight');
                    for (var w = 0; w < weightInputs.length; w++) {
                        var dcName = weightInputs[w].getAttribute('data-dc');
                        d.todWeights[dcName] = parseInt(weightInputs[w].value, 10) || 1;
                    }
                }
                break;

            case 'loadbalancing':
                var lrEl = document.getElementById('wizardLbRecordName');
                if (lrEl) d.lbRecordName = lrEl.value.trim();
                var ltEl = document.getElementById('wizardLbTtl');
                if (ltEl) d.lbTtl = ltEl.value.trim();
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

            case 'geolb':
                var glrEl = document.getElementById('wizardGeolbRecordName');
                if (glrEl) d.geolbRecordName = glrEl.value.trim();
                if (step.id === 'regions') {
                    d.geolbRegions = [];
                    var glRegRows = document.querySelectorAll('.wizard-region-row');
                    for (var gl1 = 0; gl1 < glRegRows.length; gl1++) {
                        var glNameEl = glRegRows[gl1].querySelector('.wizard-geolb-region-name');
                        var glSubEl = glRegRows[gl1].querySelector('.wizard-geolb-region-subnet');
                        if (glNameEl && glSubEl) {
                            d.geolbRegions.push({
                                name: glNameEl.value.trim(),
                                subnet: glSubEl.value.trim()
                            });
                        }
                    }
                }
                if (step.id === 'datacenters') {
                    d.geolbDatacenters = [];
                    var glDcRows = document.querySelectorAll('.wizard-backend-row');
                    for (var gl2 = 0; gl2 < glDcRows.length; gl2++) {
                        var glDcName = glDcRows[gl2].querySelector('.wizard-geolb-dc-name');
                        var glDcIp = glDcRows[gl2].querySelector('.wizard-geolb-dc-ip');
                        if (glDcName && glDcIp) {
                            d.geolbDatacenters.push({
                                name: glDcName.value.trim(),
                                ip: glDcIp.value.trim()
                            });
                        }
                    }
                    // Collect weights
                    d.geolbRegionWeights = {};
                    var glWeightInputs = document.querySelectorAll('.wizard-geolb-weight');
                    for (var gl3 = 0; gl3 < glWeightInputs.length; gl3++) {
                        var wReg = glWeightInputs[gl3].getAttribute('data-region');
                        var wDc = glWeightInputs[gl3].getAttribute('data-dc');
                        if (!d.geolbRegionWeights[wReg]) d.geolbRegionWeights[wReg] = {};
                        d.geolbRegionWeights[wReg][wDc] = parseInt(glWeightInputs[gl3].value, 10) || 1;
                    }
                    var wwEl = document.getElementById('wizardGeolbWorldwide');
                    d.geolbWorldwide = wwEl ? wwEl.checked : true;
                }
                break;

            case 'primarysecondary':
                var psRnEl = document.getElementById('wizardPsRecordName');
                if (psRnEl) d.psRecordName = psRnEl.value.trim();
                if (step.id === 'primary') {
                    d.psRegions = [];
                    var psRegRows = document.querySelectorAll('.wizard-region-row');
                    for (var ps1 = 0; ps1 < psRegRows.length; ps1++) {
                        d.psRegions.push({
                            name: psRegRows[ps1].querySelector('.wizard-region-name').value.trim(),
                            subnet: psRegRows[ps1].querySelector('.wizard-region-subnet').value.trim(),
                            ip: psRegRows[ps1].querySelector('.wizard-region-ip').value.trim()
                        });
                    }
                }
                if (step.id === 'secondaries') {
                    d.psSecondaries = [];
                    var psSecRows = document.querySelectorAll('.wizard-backend-row');
                    for (var ps2 = 0; ps2 < psSecRows.length; ps2++) {
                        var psSecName = psSecRows[ps2].querySelector('.wizard-ps-sec-name');
                        var psSecIp = psSecRows[ps2].querySelector('.wizard-ps-sec-ip');
                        if (psSecName && psSecIp) {
                            d.psSecondaries.push({
                                name: psSecName.value.trim(),
                                ip: psSecIp.value.trim()
                            });
                        }
                    }
                }
                break;

            case 'queryfilter':
                if (step.id === 'mode') {
                    var fmEl = document.getElementById('wizardFilterMode');
                    if (fmEl) d.filterMode = fmEl.value;
                    var faEl = document.getElementById('wizardFilterAction');
                    if (faEl) d.filterAction = faEl.value;
                    var fpEl = document.getElementById('wizardFilterPolicyName');
                    if (fpEl) d.filterPolicyName = fpEl.value.trim();
                    d.filterCriteria = [];
                    var critCbs = document.querySelectorAll('.wizard-filter-crit-cb:checked');
                    for (var fc = 0; fc < critCbs.length; fc++) {
                        d.filterCriteria.push(critCbs[fc].value);
                    }
                }
                if (step.id === 'values') {
                    var ffEl = document.getElementById('wizardFilterFqdns');
                    if (ffEl) d.filterFqdns = ffEl.value;
                    var fsEl = document.getElementById('wizardFilterSubnets');
                    if (fsEl) d.filterSubnets = fsEl.value.trim();
                    var fqEl = document.getElementById('wizardFilterQTypes');
                    if (fqEl) d.filterQTypes = fqEl.value.trim();
                    var fsiEl = document.getElementById('wizardFilterServerIPs');
                    if (fsiEl) d.filterServerIPs = fsiEl.value.trim();
                    var fcndEl = document.getElementById('wizardFilterCondition');
                    if (fcndEl) d.filterCondition = fcndEl.value;
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

                // Default zone scope record (fallback for unmatched clients)
                if (data.fallbackIP && data.recordName) {
                    var fbRecType = data.recordType === 'AAAA' ? ' -AAAA -IPv6Address' : ' -A -IPv4Address';
                    cmds.push('# Default zone scope record (fallback for clients not matching any region)');
                    cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -Name "' + data.recordName + '"' + fbRecType + ' "' + data.fallbackIP + '"' + serverParam);
                    cmds.push('');
                }

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
                var useInterface = data.splitMethod === 'interface';
                var methodLabel = useInterface ? 'Server Interface' : 'Client Subnet';
                cmds.push('# Split-Brain DNS Configuration (' + methodLabel + ' method)');
                cmds.push('# Zone: ' + data.zone);
                if (data.splitAD) cmds.push('# Active Directory integrated');
                cmds.push('');

                // AD zone creation
                if (data.splitAD) {
                    cmds.push('# Step 0: Create AD-integrated primary zone');
                    cmds.push('Add-DnsServerPrimaryZone -Name "' + data.zone + '" -ReplicationScope "Domain"' + serverParam);
                    cmds.push('');
                }

                // Criteria for policies
                var splitCriteria;
                if (useInterface) {
                    splitCriteria = '-ServerInterfaceIP "EQ,' + (data.internalInterface || '10.0.0.1') + '"';
                    cmds.push('# Step 1: (No client subnet needed for interface-based method)');
                } else {
                    splitCriteria = '-ClientSubnet "EQ,' + (data.subnetName || 'InternalSubnet') + '"';
                    cmds.push('# Step 1: Create client subnet for internal network');
                    cmds.push('Add-DnsServerClientSubnet -Name "' + (data.subnetName || 'InternalSubnet') + '" -IPv4Subnet "' + data.internalSubnets + '"' + serverParam);
                }
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
                cmds.push('Add-DnsServerQueryResolutionPolicy -Name "SplitBrainRecursionPolicy" -Action ALLOW -ApplyOnRecursion -RecursionScope "' + (data.internalRecursionScope || 'InternalRecursionScope') + '" ' + splitCriteria + ' -ProcessingOrder ' + order + serverParam);
                cmds.push('');

                cmds.push('# Step 5: Create query resolution policy');
                cmds.push('Add-DnsServerQueryResolutionPolicy -Name "SplitBrainZonePolicy" -Action ALLOW ' + splitCriteria + ' -ZoneScope "' + (data.internalScopeName || 'internal') + ',1" -ZoneName "' + data.zone + '" -ProcessingOrder ' + (order + 1) + serverParam);

                // AD policy copy guidance
                if (data.splitAD) {
                    cmds.push('');
                    cmds.push('# ── AD Policy Replication ──');
                    cmds.push('# Zone scopes replicate automatically in AD, but policies do NOT.');
                    cmds.push('# Run the following on each additional DC to copy policies:');
                    cmds.push('# Get-DnsServerQueryResolutionPolicy' + (serverParam ? serverParam : '') + ' | ForEach-Object {');
                    cmds.push('#     Add-DnsServerQueryResolutionPolicy -Name $_.Name -Action $_.Action -ComputerName "TARGET_DC"');
                    cmds.push('# }');
                }
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
                cmds.push('# Time-of-Day Routing Configuration (MS Scenarios 3/4)');
                cmds.push('# Zone: ' + data.zone);
                cmds.push('');

                var dcs = data.todDatacenters || [];
                var weights = data.todWeights || {};
                var recName = data.todRecordName || '@';
                var ttlParam = (data.todTtl && parseInt(data.todTtl, 10) > 0)
                    ? ' -TimeToLive ([System.TimeSpan]::FromSeconds(' + data.todTtl + '))'
                    : '';
                var hasSubnets = dcs.some(function (dc) { return dc.subnet; });
                var processingOrder = 1;

                // Step 1: Create client subnets (if any)
                if (hasSubnets) {
                    cmds.push('# Step 1: Create client subnets');
                    dcs.forEach(function (dc) {
                        if (dc.name && dc.subnet) {
                            cmds.push('Add-DnsServerClientSubnet -Name "' + dc.name + 'Subnet" -IPv4Subnet "' + dc.subnet + '"' + serverParam);
                        }
                    });
                    cmds.push('');
                }

                // Step 2: Create zone scopes and records per datacenter
                cmds.push('# Step 2: Create zone scopes and records');
                dcs.forEach(function (dc) {
                    if (!dc.name || !dc.ip) return;
                    cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + dc.name + 'ZoneScope"' + serverParam);
                    cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + dc.name + 'ZoneScope" -A -Name "' + recName + '" -IPv4Address "' + dc.ip + '"' + ttlParam + serverParam);
                });
                cmds.push('');

                // Step 3: Peak-hour policy with weighted distribution
                if (data.todPeakHours) {
                    cmds.push('# Step 3: Peak-hour policy (weighted distribution)');

                    if (hasSubnets) {
                        // Per-region peak policies (Scenario 3 style)
                        dcs.forEach(function (dc) {
                            if (!dc.name || !dc.subnet) return;
                            var scopeParts = dcs.filter(function (d) { return d.name; }).map(function (d) {
                                return d.name + 'ZoneScope,' + (weights[d.name] || 1);
                            });
                            cmds.push('Add-DnsServerQueryResolutionPolicy -Name "' + dc.name + 'PeakPolicy" -Action ALLOW' +
                                ' -ClientSubnet "EQ,' + dc.name + 'Subnet"' +
                                ' -TimeOfDay "EQ,' + data.todPeakHours + '"' +
                                ' -ZoneScope "' + scopeParts.join(';') + '"' +
                                ' -ZoneName "' + data.zone + '"' +
                                ' -ProcessingOrder ' + processingOrder + serverParam);
                            processingOrder++;
                        });
                    } else {
                        // Simple peak policy without subnets (Scenario 4 style)
                        var peakScopeParts = dcs.filter(function (d) { return d.name; }).map(function (d) {
                            return d.name + 'ZoneScope,' + (weights[d.name] || 1);
                        });
                        cmds.push('Add-DnsServerQueryResolutionPolicy -Name "PeakHoursPolicy" -Action ALLOW' +
                            ' -TimeOfDay "EQ,' + data.todPeakHours + '"' +
                            ' -ZoneScope "' + peakScopeParts.join(';') + '"' +
                            ' -ZoneName "' + data.zone + '"' +
                            ' -ProcessingOrder ' + processingOrder + serverParam);
                        processingOrder++;
                    }
                    cmds.push('');
                }

                // Step 4: Normal-hour / regional policies
                if (hasSubnets) {
                    cmds.push('# Step 4: Normal-hour per-region policies');
                    dcs.forEach(function (dc) {
                        if (!dc.name || !dc.subnet) return;
                        cmds.push('Add-DnsServerQueryResolutionPolicy -Name "' + dc.name + 'NormalPolicy" -Action ALLOW' +
                            ' -ClientSubnet "EQ,' + dc.name + 'Subnet"' +
                            ' -ZoneScope "' + dc.name + 'ZoneScope,1"' +
                            ' -ZoneName "' + data.zone + '"' +
                            ' -ProcessingOrder ' + processingOrder + serverParam);
                        processingOrder++;
                    });
                    cmds.push('');
                }

                // Step 5: Worldwide catch-all (equal distribution)
                cmds.push('# Step ' + (hasSubnets ? '5' : '4') + ': Worldwide catch-all policy');
                var catchAllParts = dcs.filter(function (d) { return d.name; }).map(function (d) {
                    return d.name + 'ZoneScope,1';
                });
                cmds.push('Add-DnsServerQueryResolutionPolicy -Name "WorldwideCatchAllPolicy" -Action ALLOW' +
                    ' -ZoneScope "' + catchAllParts.join(';') + '"' +
                    ' -ZoneName "' + data.zone + '"' +
                    ' -ProcessingOrder ' + processingOrder + serverParam);
                break;

            case 'loadbalancing':
                cmds.push('# Application Load Balancing Configuration (MS Scenario 8)');
                cmds.push('# Zone: ' + data.zone);
                if (data.lbTtl) cmds.push('# Recommended low TTL: ' + data.lbTtl + 's');
                cmds.push('');

                var backends = data.backends || [];
                var lbScopeParts = [];
                var lbTtlParam = (data.lbTtl && parseInt(data.lbTtl, 10) > 0)
                    ? ' -TimeToLive ([System.TimeSpan]::FromSeconds(' + data.lbTtl + '))'
                    : '';

                backends.forEach(function (b) {
                    if (!b.name || !b.ip) return;
                    cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + b.name + 'Scope"' + serverParam);
                    cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + b.name + 'Scope" -A -Name "' + (data.lbRecordName || '@') + '" -IPv4Address "' + b.ip + '"' + lbTtlParam + serverParam);
                    lbScopeParts.push(b.name + 'Scope,' + (b.weight || 1));
                });

                if (lbScopeParts.length > 0) {
                    cmds.push('');
                    cmds.push('# Weighted policy');
                    cmds.push('Add-DnsServerQueryResolutionPolicy -Name "LoadBalancePolicy" -Action ALLOW -ZoneScope "' + lbScopeParts.join(';') + '" -ZoneName "' + data.zone + '"' + serverParam);
                }
                break;

            case 'geolb':
                cmds.push('# Geo-Location + Load Balancing Configuration (MS Scenario 9)');
                cmds.push('# Zone: ' + data.zone);
                cmds.push('');

                var glRegions = data.geolbRegions || [];
                var glDcs = data.geolbDatacenters || [];
                var glWeights = data.geolbRegionWeights || {};
                var glRecName = data.geolbRecordName || 'www';
                var glOrder = 1;

                // Step 1: Client subnets
                cmds.push('# Step 1: Create client subnets');
                glRegions.forEach(function (r) {
                    if (r.name && r.subnet) {
                        cmds.push('Add-DnsServerClientSubnet -Name "' + r.name + 'Subnet" -IPv4Subnet "' + r.subnet + '"' + serverParam);
                    }
                });
                cmds.push('');

                // Step 2: Zone scopes and records per datacenter
                cmds.push('# Step 2: Create zone scopes and records per datacenter');
                glDcs.forEach(function (dc) {
                    if (!dc.name || !dc.ip) return;
                    cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + dc.name + 'ZoneScope"' + serverParam);
                    cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + dc.name + 'ZoneScope" -A -Name "' + glRecName + '" -IPv4Address "' + dc.ip + '"' + serverParam);
                });
                cmds.push('');

                // Step 3: Per-region weighted policies
                cmds.push('# Step 3: Per-region weighted policies');
                glRegions.forEach(function (r) {
                    if (!r.name || !r.subnet) return;
                    var rWeights = glWeights[r.name] || {};
                    var scopeEntries = glDcs.filter(function (d) { return d.name; }).map(function (d) {
                        return d.name + 'ZoneScope,' + (rWeights[d.name] || 1);
                    });
                    cmds.push('Add-DnsServerQueryResolutionPolicy -Name "' + r.name + 'Policy" -Action ALLOW' +
                        ' -ClientSubnet "EQ,' + r.name + 'Subnet"' +
                        ' -ZoneScope "' + scopeEntries.join(';') + '"' +
                        ' -ZoneName "' + data.zone + '"' +
                        ' -ProcessingOrder ' + glOrder + serverParam);
                    glOrder++;
                });
                cmds.push('');

                // Step 4: Worldwide catch-all
                if (data.geolbWorldwide !== false) {
                    cmds.push('# Step 4: Worldwide catch-all policy (equal distribution)');
                    var glCatchAll = glDcs.filter(function (d) { return d.name; }).map(function (d) {
                        return d.name + 'ZoneScope,1';
                    });
                    cmds.push('Add-DnsServerQueryResolutionPolicy -Name "WorldwidePolicy" -Action ALLOW' +
                        ' -ZoneScope "' + glCatchAll.join(';') + '"' +
                        ' -ZoneName "' + data.zone + '"' +
                        ' -ProcessingOrder ' + glOrder + serverParam);
                }
                break;

            case 'primarysecondary':
                cmds.push('# Primary-Secondary Geo-Location Configuration (MS Scenario 2)');
                cmds.push('# Zone: ' + data.zone);
                cmds.push('');

                var psRegions = data.psRegions || [];
                var psSecondaries = data.psSecondaries || [];
                var psRecName = data.psRecordName || 'www';
                var secIPs = psSecondaries.filter(function (s) { return s.ip; }).map(function (s) { return '"' + s.ip + '"'; });

                // Part A: Primary server setup
                cmds.push('# ── Part A: Primary Server Configuration ──');
                cmds.push('');

                // Configure zone transfer on primary
                if (secIPs.length > 0) {
                    cmds.push('# Configure zone transfer and notification');
                    cmds.push('Set-DnsServerPrimaryZone -Name "' + data.zone + '" -Notify Notify -NotifyServers ' + secIPs.join(',') + ' -SecondaryServers ' + secIPs.join(',') + serverParam);
                    cmds.push('');
                }

                // Geo setup on primary (same as geo wizard)
                psRegions.forEach(function (r, idx) {
                    if (!r.name || !r.subnet) return;
                    cmds.push('# Region: ' + r.name);
                    cmds.push('Add-DnsServerClientSubnet -Name "' + r.name + 'Subnet" -IPv4Subnet "' + r.subnet + '"' + serverParam);
                    cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + r.name + 'Scope"' + serverParam);
                    if (r.ip) {
                        cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + r.name + 'Scope" -A -Name "' + psRecName + '" -IPv4Address "' + r.ip + '"' + serverParam);
                    }
                    cmds.push('Add-DnsServerQueryResolutionPolicy -Name "' + r.name + 'Policy" -Action ALLOW -ClientSubnet "EQ,' + r.name + 'Subnet" -ZoneScope "' + r.name + 'Scope,1" -ZoneName "' + data.zone + '" -ProcessingOrder ' + (idx + 1) + serverParam);
                    cmds.push('');
                });

                // Part B: Secondary server setup
                cmds.push('# ── Part B: Secondary Server Configuration ──');
                cmds.push('');

                psSecondaries.forEach(function (sec) {
                    if (!sec.name) return;
                    var secParam = ' -ComputerName "' + sec.name + '"';

                    cmds.push('# Secondary: ' + sec.name);
                    cmds.push('Add-DnsServerSecondaryZone -Name "' + data.zone + '" -ZoneFile "' + data.zone + '.dns" -MasterServers ' + (params && params.server ? '"' + params.server + '"' : '"localhost"') + secParam);
                    cmds.push('');

                    // Copy subnets to secondary
                    cmds.push('# Copy client subnets to ' + sec.name);
                    psRegions.forEach(function (r) {
                        if (r.name && r.subnet) {
                            cmds.push('Add-DnsServerClientSubnet -Name "' + r.name + 'Subnet" -IPv4Subnet "' + r.subnet + '"' + secParam);
                        }
                    });
                    cmds.push('');

                    // Copy zone scopes to secondary
                    cmds.push('# Copy zone scopes to ' + sec.name);
                    psRegions.forEach(function (r) {
                        if (r.name) {
                            cmds.push('Add-DnsServerZoneScope -ZoneName "' + data.zone + '" -Name "' + r.name + 'Scope"' + secParam);
                        }
                    });
                    cmds.push('');

                    // Copy records to secondary scopes
                    cmds.push('# Copy records to ' + sec.name);
                    psRegions.forEach(function (r) {
                        if (r.name && r.ip) {
                            cmds.push('Add-DnsServerResourceRecord -ZoneName "' + data.zone + '" -ZoneScope "' + r.name + 'Scope" -A -Name "' + psRecName + '" -IPv4Address "' + r.ip + '"' + secParam);
                        }
                    });
                    cmds.push('');

                    // Copy policies to secondary
                    cmds.push('# Copy policies to ' + sec.name);
                    psRegions.forEach(function (r, idx) {
                        if (r.name && r.subnet) {
                            cmds.push('Add-DnsServerQueryResolutionPolicy -Name "' + r.name + 'Policy" -Action ALLOW -ClientSubnet "EQ,' + r.name + 'Subnet" -ZoneScope "' + r.name + 'Scope,1" -ZoneName "' + data.zone + '" -ProcessingOrder ' + (idx + 1) + secParam);
                        }
                    });
                    cmds.push('');
                });
                break;

            case 'queryfilter':
                var filterMode = data.filterMode || 'blocklist';
                var filterAction = filterMode === 'blocklist' ? (data.filterAction || 'IGNORE') : 'IGNORE';
                var filterOp = filterMode === 'blocklist' ? 'EQ' : 'NE';
                var filterName = data.filterPolicyName || 'QueryFilter';
                var filterCriteria = data.filterCriteria || ['FQDN'];
                var condition = data.filterCondition || 'AND';

                cmds.push('# Query Filter Configuration (MS Scenario 7)');
                cmds.push('# Mode: ' + (filterMode === 'blocklist' ? 'Blocklist (block matching)' : 'Allowlist (block non-matching)'));
                cmds.push('');

                var criteriaParams = [];

                if (filterCriteria.indexOf('FQDN') !== -1 && data.filterFqdns) {
                    var fqdns = data.filterFqdns.split(/[\n,]+/).map(function (d) { return d.trim(); }).filter(function (d) { return d; });
                    if (fqdns.length > 0) {
                        criteriaParams.push('-FQDN "' + filterOp + ',' + fqdns.join(',') + '"');
                    }
                }

                if (filterCriteria.indexOf('ClientSubnet') !== -1 && data.filterSubnets) {
                    var subnets = data.filterSubnets.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
                    if (subnets.length > 0) {
                        criteriaParams.push('-ClientSubnet "' + filterOp + ',' + subnets.join(',') + '"');
                    }
                }

                if (filterCriteria.indexOf('QType') !== -1 && data.filterQTypes) {
                    var qtypes = data.filterQTypes.split(',').map(function (q) { return q.trim(); }).filter(function (q) { return q; });
                    if (qtypes.length > 0) {
                        criteriaParams.push('-QType "' + filterOp + ',' + qtypes.join(',') + '"');
                    }
                }

                if (filterCriteria.indexOf('ServerInterfaceIP') !== -1 && data.filterServerIPs) {
                    var sips = data.filterServerIPs.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
                    if (sips.length > 0) {
                        criteriaParams.push('-ServerInterfaceIP "' + filterOp + ',' + sips.join(',') + '"');
                    }
                }

                if (criteriaParams.length > 0) {
                    var cmd = 'Add-DnsServerQueryResolutionPolicy -Name "' + filterName + '" -Action ' + filterAction;
                    cmd += ' ' + criteriaParams.join(' ');
                    if (criteriaParams.length > 1) {
                        cmd += ' -Condition ' + condition;
                    }
                    cmd += ' -ProcessingOrder 1' + serverParam;
                    cmds.push(cmd);
                } else {
                    cmds.push('# No criteria specified');
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
