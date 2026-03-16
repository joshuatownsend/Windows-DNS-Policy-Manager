/* ── Toast Notifications ───────────────────────────────── */
(function () {
    'use strict';

    var NS = window.DNSPolicyManager = window.DNSPolicyManager || {};
    NS.toast = {};

    var container = null;

    function getContainer() {
        if (container) return container;

        container = document.createElement('div');
        container.id = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        container.style.cssText = [
            'position:fixed',
            'top:20px',
            'right:20px',
            'z-index:10000',
            'display:flex',
            'flex-direction:column',
            'gap:10px',
            'max-width:400px',
            'pointer-events:none'
        ].join(';');
        document.body.appendChild(container);
        return container;
    }

    var icons = {
        success: '\u2705',
        error:   '\u274C',
        warning: '\u26A0\uFE0F',
        info:    '\u2139\uFE0F'
    };

    var bgColors = {
        success: '#d4edda',
        error:   '#f8d7da',
        warning: '#fff3cd',
        info:    '#d1ecf1'
    };

    var textColors = {
        success: '#155724',
        error:   '#721c24',
        warning: '#856404',
        info:    '#0c5460'
    };

    /**
     * Show a toast notification.
     * @param {string} message  — text to display
     * @param {string} [type]   — 'success' | 'error' | 'warning' | 'info'
     * @param {number} [duration] — ms before auto-dismiss (0 = manual only)
     */
    NS.toast.show = function show(message, type, duration) {
        type = type || 'info';
        duration = duration !== undefined ? duration : 4000;

        var host = getContainer();
        var toast = document.createElement('div');
        toast.setAttribute('role', 'status');
        toast.style.cssText = [
            'display:flex',
            'align-items:flex-start',
            'gap:10px',
            'padding:14px 18px',
            'border-radius:8px',
            'font-family:inherit',
            'font-size:14px',
            'line-height:1.4',
            'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
            'pointer-events:auto',
            'opacity:0',
            'transform:translateX(40px)',
            'transition:opacity 0.3s ease, transform 0.3s ease',
            'background:' + (bgColors[type] || bgColors.info),
            'color:' + (textColors[type] || textColors.info),
            'border:1px solid ' + (textColors[type] || textColors.info) + '33'
        ].join(';');

        var icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = icons[type] || icons.info;
        icon.style.cssText = 'flex-shrink:0;font-size:18px;line-height:1';

        var text = document.createElement('span');
        text.style.cssText = 'flex:1';
        text.textContent = message;

        var close = document.createElement('button');
        close.setAttribute('aria-label', 'Dismiss notification');
        close.textContent = '\u00D7';
        close.style.cssText = [
            'background:none',
            'border:none',
            'font-size:20px',
            'cursor:pointer',
            'line-height:1',
            'padding:0 0 0 8px',
            'color:inherit',
            'opacity:0.7',
            'flex-shrink:0'
        ].join(';');

        function dismiss() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }

        close.addEventListener('click', dismiss);

        toast.appendChild(icon);
        toast.appendChild(text);
        toast.appendChild(close);
        host.appendChild(toast);

        // Trigger entrance animation
        requestAnimationFrame(function () {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });

        if (duration > 0) {
            setTimeout(dismiss, duration);
        }
    };

    // Convenience methods
    NS.toast.success = function (msg, dur) { NS.toast.show(msg, 'success', dur); };
    NS.toast.error   = function (msg, dur) { NS.toast.show(msg, 'error', dur); };
    NS.toast.warning = function (msg, dur) { NS.toast.show(msg, 'warning', dur); };
    NS.toast.info    = function (msg, dur) { NS.toast.show(msg, 'info', dur); };
})();
