# PowerShell Commands

The **PowerShell** tab collects every command generated or executed across the application. Use it to review what was done, copy commands for manual use, or document your DNS policy configuration.

## What Appears Here

Commands are added to this tab whenever you:
- Click **Generate PowerShell** on the Create Policy tab
- Click **Generate Commands** in any wizard scenario
- Execute commands through wizards (results with success/failure status appear here)
- Import blocklists

Each entry shows the full PowerShell command text.

## Copying Commands

- **Copy All** — Copies every command in the output to your clipboard. Useful for saving to a script file or pasting into a PowerShell session.
- **Per-command copy** — Hover over any individual command to reveal a copy button for just that command.

## Clearing the Output

Click **Clear Output** to remove all commands from the display. This only clears the view — it does not undo any commands that were already executed on the server.

## Using Commands Manually

If you're running in **Dry Run** mode or without the bridge, you can:
1. Generate commands using the Create Policy form or Wizards
2. Switch to the PowerShell tab
3. Click **Copy All**
4. Paste into an elevated PowerShell session on your DNS server
5. Run the commands
