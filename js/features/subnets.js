/* ── Client Subnet Management ──────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    var state = NS.state;

    /**
     * Get active server connection params for API calls.
     */
    function getServerParams() {
        var server = NS.getActiveServer ? NS.getActiveServer() : null;
        if (!server) return null;
        return {
            server: server.hostname,
            serverId: server.id,
            credentialMode: server.credentialMode
        };
    }

    /**
     * Load client subnets from the active server.
     */
    NS.loadSubnets = function loadSubnets() {
        if (!state.bridgeConnected || !NS.api) return;

        var params = getServerParams();
        if (!params) return;

        NS.api.listSubnets(params.server, params.serverId, params.credentialMode)
            .then(function (result) {
                if (result.success) {
                    state.clientSubnets = result.subnets || [];
                    NS.renderSubnets();
                }
            });
    };

    /**
     * Render the client subnets list.
     */
    NS.renderSubnets = function renderSubnets() {
        var list = document.getElementById('subnetList');
        if (!list) return;

        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        if (state.clientSubnets.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'dns-objects-empty';
            empty.textContent = 'No client subnets found. Create one to use in policy criteria.';
            list.appendChild(empty);
            return;
        }

        state.clientSubnets.forEach(function (subnet) {
            var row = document.createElement('div');
            row.className = 'dns-object-row';

            var nameEl = document.createElement('span');
            nameEl.className = 'dns-object-name';
            nameEl.textContent = subnet.Name;

            var ipv4El = document.createElement('span');
            ipv4El.className = 'dns-object-detail';
            var ipv4 = subnet.IPv4Subnet;
            ipv4El.textContent = 'IPv4: ' + (Array.isArray(ipv4) ? ipv4.join(', ') : (ipv4 || 'none'));

            var ipv6El = document.createElement('span');
            ipv6El.className = 'dns-object-detail';
            var ipv6 = subnet.IPv6Subnet;
            ipv6El.textContent = 'IPv6: ' + (Array.isArray(ipv6) ? ipv6.join(', ') : (ipv6 || 'none'));

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger btn-sm';
            deleteBtn.setAttribute('data-action', 'deleteSubnet');
            deleteBtn.setAttribute('data-name', subnet.Name);
            deleteBtn.textContent = 'Delete';

            row.appendChild(nameEl);
            row.appendChild(ipv4El);
            row.appendChild(ipv6El);
            row.appendChild(deleteBtn);
            list.appendChild(row);
        });
    };

    /**
     * Add a client subnet from the inline form.
     */
    NS.addSubnetFromForm = function addSubnetFromForm() {
        var nameInput = document.getElementById('subnetName');
        var ipv4Input = document.getElementById('subnetIPv4');
        var ipv6Input = document.getElementById('subnetIPv6');

        var name = nameInput.value.trim();
        var ipv4 = ipv4Input.value.trim();
        var ipv6 = ipv6Input.value.trim();

        if (!name) {
            NS.toast.warning('Subnet name is required.');
            return;
        }
        if (!ipv4 && !ipv6) {
            NS.toast.warning('At least one IPv4 or IPv6 subnet is required.');
            return;
        }

        var params = getServerParams();
        if (!params) {
            NS.toast.warning('No active server selected.');
            return;
        }

        var body = {
            name: name,
            server: params.server,
            serverId: params.serverId,
            credentialMode: params.credentialMode
        };
        if (ipv4) body.ipv4Subnet = ipv4;
        if (ipv6) body.ipv6Subnet = ipv6;

        NS.api.createSubnet(body).then(function (result) {
            if (result.success) {
                NS.toast.success('Subnet "' + name + '" created.');
                nameInput.value = '';
                ipv4Input.value = '';
                ipv6Input.value = '';
                NS.loadSubnets();
            } else {
                NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
            }
        });
    };

    /**
     * Remove a client subnet by name.
     */
    NS.removeSubnet = function removeSubnet(name) {
        var params = getServerParams();
        if (!params) return;

        NS.api.deleteSubnet(name, params.server, params.serverId, params.credentialMode)
            .then(function (result) {
                if (result.success) {
                    NS.toast.success('Subnet "' + name + '" deleted.');
                    NS.loadSubnets();
                } else {
                    NS.toast.error('Failed: ' + (result.error || 'Unknown error'));
                }
            });
    };
})();
