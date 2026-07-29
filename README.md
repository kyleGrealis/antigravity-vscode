# Antigravity for VS Code

[![Version](https://img.shields.io/badge/version-0.1.2-blue.svg)](https://github.com/kyleGrealis/antigravity-vscode/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.txt)

Harness the power of **Google Antigravity (`agy`)** directly inside VS Code and Positron.

---

## Features

- **Rich Webview Chat Interface**: Clean, responsive agent chat interface in the side bar or editor grid.
- **Side-by-Side Diff Previews**: Inspect proposed code modifications in native VS Code diff views with one click (`Compare in Editor ↗`).
- **File Context & Mentions**: Type `@` to search and attach workspace files directly to your prompt context.
- **Image Support**: Attach screenshot images to chat requests for visual context and UI debugging.
- **Slash Commands & Skills**: Execute slash commands like `/model`, `/effort`, `/new`, `/clear`, or custom agent skills seamlessly.
- **Terminal Fallback Mode**: Launch `agy` in an interactive integrated terminal tab if preferred.

---

## Installation

### From GitHub Release (VSIX)

1. Download the latest `.vsix` file from the [Releases](https://github.com/kyleGrealis/antigravity-vscode/releases) page.
2. In VS Code or Positron, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Select **Extensions: Install from VSIX...** and choose the downloaded `.vsix` file.

Alternatively via CLI:

```bash
code --install-extension antigravity-vscode-0.1.2.vsix
```

*(Or for Positron users: `positron --install-extension antigravity-vscode-0.1.2.vsix`)*

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
| `antigravity.useTerminal` | `false` | Launch Antigravity as an interactive terminal tab instead of the webview. |
| `antigravity.dangerouslySkipPermissions` | `true` | Auto-approve tool permission requests for seamless webview execution. |
| `antigravity.model` | `""` | Default model to pass to `agy`. |
| `antigravity.effort` | `""` | Reasoning effort level (`low`, `medium`, `high`). |

---

## Keybindings & Commands

- `Ctrl+Escape` (`Cmd+Escape` on macOS): Focus Antigravity chat input.
- `Ctrl+Shift+Escape` (`Cmd+Shift+Escape` on macOS): Open Antigravity in a new editor tab.
- **Antigravity: Open in Side Bar**: Open chat interface in the activity bar.
- **Antigravity: New Conversation**: Clear current chat session.

---

## License

[MIT License](LICENSE.txt)
