# News / Release Notes

## antigravity-vscode 0.1.5

- **Execution Mode Selector**: Added `Shift+Tab` keyboard shortcut in prompt input to cycle execution modes (Default, Plan Mode, Auto Accept).
- **Live Security & Mode Indicators**: Added live prompt footer status text indicating execution mode and environment sandboxing state (`sandbox on`, `sandbox off`, `auto accept`, `plan`).
- **Slash Command Controls**: Added `/sandbox <on|off>`, `/dangerous <on|off>`, `/help`, `/settings`, and `/plan` slash command toggles.
- **Persistent Permission Locking**: Permission denial and approval status badges lock in place permanently upon user choice and cancel backend tasks cleanly.
- **Sandboxing Setting**: Added `antigravity.bypassSandbox` configuration setting for controlling container isolation.

## antigravity-vscode 0.1.4

- **Interactive Plan Mode**: Added dedicated step-by-step planning interface with inline review & modification forms, top-pinned execution progress tracking, and interactive clarification cards.
- **Empty State Welcome Screen**: Added centered glowing SVG vector hero logo and interactive 2x2 prompt suggestion cards grid.
- **Clean Tool Argument Formatting**: Unescaped quotes/backslashes and replaced raw JSON with formatted command code blocks for tool execution cards.
- **Transcript History Linking**: Associated transcript step logs back to tool call outputs so past commands render complete output upon reload.
- **Case-Insensitive `@` Completion**: Made `@` file autocomplete matching case-insensitive across the workspace.

## antigravity-vscode 0.1.3

- **Session Management**: Added inline session renaming in history dropdown and main header title bar.
- **Session Search**: Integrated real-time search filtering in the session history dropdown.
- **Session Persistence**: Improved automatic session restoration and state synchronization across editor reloads.
- **New Conversation Handling**: Refined session initialization to seamlessly generate new conversation IDs on first prompt submission.
