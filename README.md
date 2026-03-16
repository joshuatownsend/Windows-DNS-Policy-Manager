# Windows DNS Policy Manager

A zero-dependency, browser-based GUI for creating and managing Windows Server DNS Query Resolution Policies. Open `index.html` directly in any browser — no server, no build tools, no installs.

## Features

- Visual policy builder with form validation
- Support for all DNS policy criteria types (FQDN, Client Subnet, Query Type, etc.)
- PowerShell command generation with copy-to-clipboard
- Policy backup and export (JSON)
- Blocklist import from TXT/CSV files with preview
- Toast notifications (replaces alert dialogs)
- Keyboard-accessible tab navigation (arrow keys, Enter/Space)
- Screen-reader-friendly ARIA attributes
- Responsive layout (desktop, tablet, phone)

## Usage

1. Double-click `index.html` (or open it in Chrome, Firefox, or Edge)
2. Use the **Create Policy** tab to build DNS policies visually
3. Click **Generate Policy** to produce the PowerShell command
4. Copy the command from the **PowerShell Commands** tab

## Project Structure

```
index.html                    HTML shell with ARIA attributes
css/
  variables.css               Design tokens (colors, spacing, radii, shadows)
  base.css                    Reset, typography, form elements, validation states
  layout.css                  Container, header, grid, sidebar
  components.css              Buttons, tabs, cards, badges, tooltips, upload
  powershell.css              Dark-themed code output panel
  responsive.css              Media queries (1024px, 768px, 480px)
js/
  state.js                    App state object (replaces global variables)
  app.js                      Entry point: event delegation, init
  ui/
    tabs.js                   Tab switching (fixed showTab bug)
    toast.js                  Toast notifications (replaces alert())
    form.js                   Validation, toggles, clearForm
  features/
    policy.js                 Generate, render, select, export policies
    criteria.js               Add/remove criteria, help text
    scopes.js                 Add/remove zone scopes
    connection.js             Test connection, toggle credentials
    backup.js                 Backup script generation, policy export
    blocklist.js              File import, parsing, preview, policy generation
  utils/
    download.js               File download helper
dns-policy-manager.html       Original single-file version (kept as reference)
```

## Architecture

- **Namespace pattern** (`window.DNSPolicyManager`): Works with `file://` protocol (ES modules are blocked by CORS when opening HTML files directly)
- **Event delegation**: A single click/change listener on `document` routes actions via `data-action` attributes — no inline `onclick` handlers
- **CSS custom properties**: All colors, spacing, and typography are defined as tokens in `variables.css`

## Browser Support

Chrome, Firefox, and Edge (current versions). Works when opened via `file://` or any HTTP server.
