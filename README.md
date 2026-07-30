# Antigravity for VS Code

[![Version](https://img.shields.io/badge/version-0.1.5-blue.png)](https://github.com/kyleGrealis/antigravity-vscode/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.png)](LICENSE.txt)

Harness the power of **Google Antigravity (`agy`)** directly inside VS Code and Positron.

---

## Features

- **Interactive Plan Mode**: Dedicated step-by-step planning interface, interactive plan checklists, inline plan review & modification form, and interactive clarification cards.
- **Execution Mode Selector**: Press `Shift+Tab` in the prompt input to cycle execution modes (`Default` -> `plan` -> `auto accept` -> `Default`) with visual mode indicator badges.
- **Live Status & Security Indicators**: Predictable prompt footer status text showing execution mode and environment sandboxing state (`sandbox on`, `sandbox off`, `auto accept`, `plan`).
- **Slash Commands & Skill Bridge**: Control settings and execute custom agent skills directly via slash commands (`/sandbox`, `/dangerous`, `/plan`, `/new`, `/clear`, `/settings`, `/help`, or custom skills).
- **Rich Webview Chat Interface**: Clean, responsive agent chat interface in the side bar or editor grid with empty state suggestion cards.
- **Session History & Renaming**: Dropdown history picker with real-time search filtering, inline session title editing, and automatic session state restoration on reload.
- **Formatted Tool Execution Cards**: Clean, unescaped command code blocks for tool cards with full terminal stdout history rendering.
- **Side-by-Side Diff Previews**: Inspect proposed code modifications in native VS Code diff views with one click (`Compare in Editor ↗`).
- **Case-Insensitive `@` File Mentions**: Type `@` for case-insensitive workspace file search and context insertion.
- **Image Support**: Attach screenshot images to chat requests for visual context and UI debugging.

---

## Installation

### From GitHub Release (VSIX)

1. Download the latest `.vsix` file from the [Releases](https://github.com/kyleGrealis/antigravity-vscode/releases) page.
2. In VS Code or Positron, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Select **Extensions: Install from VSIX...** and choose the downloaded `.vsix` file.

Alternatively via CLI:

```bash
code --install-extension antigravity-vscode-0.1.5.vsix
```

*(Or for Positron users: `positron --install-extension antigravity-vscode-0.1.5.vsix`)*

---

## Requirements

- **Antigravity CLI (`agy`)**: `>= 1.0.0` (verify with `agy --version`). Must be installed and accessible in your system `PATH` (or configured via `antigravity.cliPath`).
- **VS Code**: `^1.85.0` (verify with `code --version`).
- **Positron**: `>= 2024.06.0` (verify with `positron --version`).

---

## Usage & Slash Commands

### Keyboard Controls & Modes

- **`Shift+Tab`**: Cycle execution modes in the prompt area:
  - **Default**: Standard interactive prompt execution.
  - **`plan`**: Prefixes prompt with `[PLAN MODE]` and renders the interactive Pinned Plan Card.
  - **`auto accept`**: Enables persistent auto-approvals for tool command execution.

### Built-in Slash Commands

| Command | Arguments | Description |
| :--- | :--- | :--- |
| `/sandbox` | `<on\|off>` | Toggle container sandboxing mode (`sandbox on` / `sandbox off`). |
| `/dangerous` | `<on\|off>` | Toggle permission auto-approvals mode (`auto accept` / `default`). |
| `/plan` | `[description]` | Trigger Plan Mode and generate an implementation plan checklist. |
| `/new` | *(none)* | Start a fresh conversation session. |
| `/clear` | *(none)* | Clear current chat history. |
| `/settings` | *(none)* | Open extension settings pane. |
| `/help` | *(none)* | Display available commands and keyboard shortcuts. |
| `/<skill-name>` | `[args]` | Invoke custom local agent skills. |

---

## Extension Settings

This extension contributes the following settings (`antigravity.*`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `antigravity.cliPath` | `"agy"` | Path or executable name for the Antigravity CLI binary. |
| `antigravity.dangerouslySkipPermissions` | `false` | Auto-approve tool permission requests without prompting. When disabled, prompts for confirmation. |
| `antigravity.bypassSandbox` | `false` | Bypass container sandboxing for tool command execution. |

---

## TODO / Roadmap

- [x] **Shift+Tab Execution Mode Selector**: Implement keyboard shortcut (`Shift+Tab`) in the prompt area to quickly cycle execution modes with visual indicator badges.
- [x] **Sandboxing & Permission Slash Controls**: Toggle environment sandboxing (`/sandbox <on|off>`) and permission auto-approvals (`/dangerous <on|off>`) directly via slash commands with live prompt footer text indicators.
- [x] **Slash Command Help Card (`/help`)**: Wired `/help` slash command to display a structured markdown reference table of all commands, shortcuts, and settings.
- [ ] **Prompt Queuing & Mid-Turn Steering**: Allow users to submit follow-up prompts while an agent turn is active, queuing requests for automatic execution upon turn completion or injecting mid-turn steering notes.
- [ ] **Interactive Clarification Dialogs**: Present structured multiple-choice questions in Plan Mode with recommended options, letter shortcuts, and write-in input fields.
- [ ] **Agent Workflow Visualizations**: Specialized UI components for monitoring subagent teams, background tasks, timer schedules, and structured tool outputs.
- [ ] **Authentication & First-Time Onboarding**: Implement CLI authentication status checks for new users without active credentials, presenting a dedicated onboarding state with guided sign-in instructions.
- [ ] **Token Usage Overlay (`/usage`)**: Display session token statistics (input, output, and thinking tokens) overlay via `/usage` slash command with `Esc` key dismissal.
- [ ] **Viewport-Constrained Image Previews**: Render user-attached images and inline markdown images with responsive styling capped at 50% max viewport height.
  - Fix image click handler to open binary media files using native VS Code image viewers instead of triggering text editor file open errors.

---

## License

[MIT License](LICENSE.txt)

## Contributing & Community

Contributions, feature requests, and bug reports are warmly welcome!

- **Issues & Feature Requests**: [Open an issue](https://github.com/kyleGrealis/antigravity-vscode/issues) on GitHub.
- **Pull Requests**: Feel free to submit a [pull request](https://github.com/kyleGrealis/antigravity-vscode/pulls) with improvements or bug fixes.
- **Repository**: Visit [github.com/kyleGrealis/antigravity-vscode](https://github.com/kyleGrealis/antigravity-vscode) for the source code and updates.

Collaborators welcome!
