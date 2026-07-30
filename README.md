# Antigravity for VS Code

[![Version](https://img.shields.io/badge/version-0.1.4-blue.png)](https://github.com/kyleGrealis/antigravity-vscode/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.png)](LICENSE.txt)

Harness the power of **Google Antigravity (`agy`)** directly inside VS Code and Positron.

---

## Features

- **Interactive Plan Mode**: Dedicated step-by-step planning interface, interactive plan checklists, inline plan review & modification form, and interactive clarification cards.
- **Rich Webview Chat Interface**: Clean, responsive agent chat interface in the side bar or editor grid.
- **Empty State Welcome Screen**: Centered glowing SVG vector hero logo, tagline, and interactive 2x2 prompt suggestion cards grid.
- **Session History & Renaming**: Dropdown history picker with real-time search filtering, inline session title editing, and automatic session state restoration on reload.
- **Formatted Tool Execution Cards**: Clean, unescaped command code blocks for tool cards with full terminal stdout history rendering.
- **Side-by-Side Diff Previews**: Inspect proposed code modifications in native VS Code diff views with one click (`Compare in Editor ↗`).
- **Case-Insensitive `@` File Mentions**: Type `@` for case-insensitive workspace file search and context insertion.
- **Image Support**: Attach screenshot images to chat requests for visual context and UI debugging.
- **Slash Commands & Skills**: Execute slash commands like `/model`, `/effort`, `/new`, `/clear`, `/plan`, or custom agent skills seamlessly.

---

## Installation

### From GitHub Release (VSIX)

1. Download the latest `.vsix` file from the [Releases](https://github.com/kyleGrealis/antigravity-vscode/releases) page.
2. In VS Code or Positron, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Select **Extensions: Install from VSIX...** and choose the downloaded `.vsix` file.

Alternatively via CLI:

```bash
code --install-extension antigravity-vscode-0.1.4.vsix
```

*(Or for Positron users: `positron --install-extension antigravity-vscode-0.1.4.vsix`)*

---

## Requirements

- **Antigravity CLI (`agy`)** must be installed and accessible in your system `PATH` (or configured in extension settings).
- **VS Code** `^1.85.0` or **Positron**.

---

## Extension Settings

This extension contributes the following settings (`antigravity.*`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `antigravity.cliPath` | `"agy"` | Path or executable name for the Antigravity CLI binary. |
| `antigravity.dangerouslySkipPermissions` | `false` | Auto-approve tool permission requests without prompting. When disabled, prompts for confirmation. |
| `antigravity.model` | `""` | Default model to pass to `agy`. |
| `antigravity.effort` | `""` | Reasoning effort level (`low`, `medium`, `high`). |

---

## Keybindings & Commands

- `Ctrl+Escape` (`Cmd+Escape` on macOS): Focus Antigravity chat input.
- `Ctrl+Shift+Escape` (`Cmd+Shift+Escape` on macOS): Open Antigravity in a new editor tab.
- **Antigravity: Open in Side Bar**: Open chat interface in the activity bar.
- **Antigravity: New Conversation**: Clear current chat session.

---

## TODO / Roadmap

- [ ] **Interactive Clarification Dialogs**: In Plan Mode, ensure process pauses to present structured multiple-choice questions with recommended options, option letters, and custom write-in input.
- [ ] **Agent Workflow Visualizations**: Specialized UI components for monitoring subagent teams, background tasks, timer schedules, and structured tool outputs.

---

## License

[MIT License](LICENSE.txt)

## Contributing & Community

Contributions, feature requests, and bug reports are warmly welcome!

- **Issues & Feature Requests**: [Open an issue](https://github.com/kyleGrealis/antigravity-vscode/issues) on GitHub.
- **Pull Requests**: Feel free to submit a [pull request](https://github.com/kyleGrealis/antigravity-vscode/pulls) with improvements or bug fixes.
- **Repository**: Visit [github.com/kyleGrealis/antigravity-vscode](https://github.com/kyleGrealis/antigravity-vscode) for the source code and updates.

Collaborators welcome!
