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
            'gap:8px',
            'max-width:380px',
            'pointer-events:none'
        ].join(';');
        document.body.appendChild(container);
        return container;
    }

    var icons = {
        success: '\u2713',
        error:   '\u2717',
        warning: '\u26A0',
        info:    '\u2139'
    };

    var bgColors = {
        success: 'rgba(16, 185, 129, 0.12)',
        error:   'rgba(244, 63, 94, 0.12)',
        warning: 'rgba(245, 158, 11, 0.12)',
        info:    'rgba(6, 182, 212, 0.12)'
    };

    var textColors = {
        success: '#34d399',
        error:   '#fb7185',
        warning: '#fbbf24',
        info:    '#22d3ee'
    };

    var borderColors = {
        success: 'rgba(16, 185, 129, 0.2)',
        error:   'rgba(244, 63, 94, 0.2)',
        warning: 'rgba(245, 158, 11, 0.2)',
        info:    'rgba(6, 182, 212, 0.2)'
    };

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
            'padding:12px 16px',
            'border-radius:8px',
            'font-family:inherit',
            'font-size:13px',
            'line-height:1.4',
            'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
            'pointer-events:auto',
            'opacity:0',
            'transform:translateX(20px)',
            'transition:opacity 0.25s cubic-bezier(0.16,1,0.3,1), transform 0.25s cubic-bezier(0.16,1,0.3,1)',
            'background:#18181b',
            'color:#fafafa',
            'border:1px solid ' + (borderColors[type] || borderColors.info),
            'backdrop-filter:blur(12px)'
        ].join(';');

        var icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = icons[type] || icons.info;
        icon.style.cssText = 'flex-shrink:0;font-size:14px;line-height:1.4;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:' + (bgColors[type] || bgColors.info) + ';color:' + (textColors[type] || textColors.info);

        var text = document.createElement('span');
        text.style.cssText = 'flex:1;color:#d4d4d8';
        text.textContent = message;

        var close = document.createElement('button');
        close.setAttribute('aria-label', 'Dismiss notification');
        close.textContent = '\u00D7';
        close.style.cssText = [
            'background:none',
            'border:none',
            'font-size:16px',
            'cursor:pointer',
            'line-height:1',
            'padding:0 0 0 6px',
            'color:#52525b',
            'flex-shrink:0'
        ].join(';');

        function dismiss() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 250);
        }

        close.addEventListener('click', dismiss);
        close.addEventListener('mouseenter', function() { close.style.color = '#a1a1aa'; });
        close.addEventListener('mouseleave', function() { close.style.color = '#52525b'; });

        toast.appendChild(icon);
        toast.appendChild(text);
        toast.appendChild(close);
        host.appendChild(toast);

        requestAnimationFrame(function () {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });

        if (duration > 0) {
            setTimeout(dismiss, duration);
        }
    };

    NS.toast.success = function (msg, dur) { NS.toast.show(msg, 'success', dur); };
    NS.toast.error   = function (msg, dur) { NS.toast.show(msg, 'error', dur); };
    NS.toast.warning = function (msg, dur) { NS.toast.show(msg, 'warning', dur); };
    NS.toast.info    = function (msg, dur) { NS.toast.show(msg, 'info', dur); };
})();
