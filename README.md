# Antigravity for VS Code

[![Version](https://img.shields.io/badge/version-0.2.2-blue.png)](https://github.com/kyleGrealis/antigravity-vscode/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.png)](LICENSE.txt)

Harness the power of **Google Antigravity (`agy`)** directly inside VS Code and Positron.

<p align="center">
  <img src="media/welcome_screen.png" alt="Antigravity Welcome Screen" width="70%" />
</p>

---

## Features

- **Interactive Plan Mode**: Type `/plan` anywhere in your prompt to enter a step-by-step planning workflow with progress tracking, approve/modify/cancel actions, and real-time checkbox sync as the agent executes.

<p align="center">
  <img src="media/interactive_plan_mode.png" alt="Interactive Plan Mode" width="70%" />
</p>

- **Tool Execution Cards**: Clean command code blocks with full terminal output, disclosure chevrons, and per-card elapsed timers for running tasks.

<p align="center">
  <img src="media/tool_execution_cards.png" alt="Tool Execution Cards" width="70%" />
</p>

- **File Edit Diffs**: Red/green before-after diffs for all file edit tools (`WriteToFile`, `ReplaceFileContent`, `MultiReplaceFileContent`). Snapshot-chain diffing tracks successive edits with `git show HEAD` baselines for first edits on tracked files.
- **Side-by-Side Diff Previews**: Inspect proposed changes in native VS Code diff views via `Compare in Editor`.
- **Interactive Mermaid Diagrams**: Theme-adaptive SVG rendering with Code/Diagram toggle, SVG export, and fullscreen pan & zoom.
- **Mid-Turn Steering**: Send follow-up prompts while the agent is working to redirect without losing session context.
- **Workspace Config Injection**: Automatically prepends `.gemini/GEMINI.md` and `.gemini/AGENTS.md` to first-turn prompts for per-project persona and context.
- **Execution Mode Selector**: `Shift+Tab` cycles modes (`Default` > `plan` > `auto accept`) with visual badges.
- **Workspace-Scoped Session History**: History picker filtered by workspace with search, inline renaming, delete, and automatic state restoration on reload.
- **Prompt History**: `Up/Down Arrow` recalls previous prompts, scoped per workspace and persisted across sessions.
- **Live Streaming & Smart Auto-Scroll**: Scroll lock preserves your reading position during active streaming.
- **`@` File Mentions**: Case-insensitive workspace file search and context insertion.
- **Image & File Attachments**: Paste or attach screenshots, or use the paperclip to attach text files (`.md`, `.txt`, `.csv`, `.py`, etc.) with content inlined into the prompt.
- **LaTeX Math Rendering**: Inline (`$...$`) and display (`$$...$$`) math renders as formatted equations via KaTeX.
- **Slash Commands & Skills**: Control settings and execute custom agent skills (reads `~/.gemini/skills/`).
- **Orphan Process Cleanup**: Kills stale agy processes on extension deactivate and before session switches.

---

## Prerequisites

### 1. Install the Antigravity CLI

The extension requires Google's **Antigravity CLI (`agy`)** to be installed and authenticated on your machine. Follow the official installation guide:

**[Install the Antigravity CLI](https://antigravity.google/docs/cli/install)**

After installation, verify it's working:

```bash
agy --version
```

### 2. Authenticate in your terminal

Before the extension can talk to agy, you need to log in once from a terminal:

```bash
agy auth login
```

This opens a browser window for Google OAuth. Once authenticated, the session persists and the extension will use the same credentials automatically.

### 3. Install the extension

Download the latest `.vsix` file from the [Releases](https://github.com/kyleGrealis/antigravity-vscode/releases) page, then install:

```bash
code --install-extension antigravity-vscode-0.2.2.vsix
# or for Positron:
positron --install-extension antigravity-vscode-0.2.2.vsix
```

Or install from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) > **Extensions: Install from VSIX...**

That's it -- open the Antigravity sidebar and start prompting.

---

## Requirements

- **Antigravity CLI (`agy`)**: `>= 1.0.0`. Must be in your `PATH` or configured via `antigravity.cliPath`.
- **VS Code**: `^1.85.0` or **Positron**: `>= 2024.06.0`

---

## Slash Commands

<p align="center">
  <img src="media/slash_command_autocomplete.png" alt="Slash Command Autocomplete" width="70%" />
</p>

| Command | Description |
| :--- | :--- |
| `/plan [description]` | Enter Plan Mode and generate an implementation plan |
| `/effort <low\|medium\|high>` | Set reasoning effort level |
| `/sandbox <on\|off>` | Toggle container sandboxing |
| `/dangerous <on\|off>` | Toggle permission auto-approvals |
| `/usage` | Display session token statistics overlay |
| `/new` | Start a fresh conversation session |
| `/clear` | Clear current chat history |
| `/settings` | Open extension settings |
| `/help` | Show available commands and shortcuts |
| `/<skill-name> [args]` | Invoke custom local agent skills |

---

## Keyboard Shortcuts

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| `Enter` | Prompt box | Send message |
| `Shift+Enter` | Prompt box | Insert newline |
| `Shift+Tab` | Prompt box | Cycle execution mode |
| `Up Arrow` | Prompt box (empty) | Recall previous prompt |
| `Down Arrow` | Prompt box (browsing) | Navigate forward through history |
| `@` | Prompt box | Open file search |
| `/` | Prompt box | Open slash command autocomplete |
| `Escape` | During agent work | Cancel the active request |

---

## Extension Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `antigravity.cliPath` | `"agy"` | Path or executable name for the Antigravity CLI binary |
| `antigravity.dangerouslySkipPermissions` | `false` | Auto-approve tool permission requests without prompting |
| `antigravity.bypassSandbox` | `false` | Bypass container sandboxing for tool command execution |

---

## Known Issues

> No known issues at this time.

---

## Roadmap

- [x] Workspace-scoped prompt history
- [x] Workspace config injection (`.gemini/GEMINI.md`, `.gemini/AGENTS.md`)
- [x] Orphan process cleanup and session hardening
- [x] Mid-turn model steering
- [x] Background task kill via `manage_task` and `manage_subagents`
- [x] Subagent tracking with live badge, timer, and inline kill button
- [x] Inline code styling cleanup (borderless)
- [x] Text file attachments (`.md`, `.txt`, `.csv`, etc.)
- [x] LaTeX / math rendering (KaTeX)
- [ ] Interactive clarification cards for `ask_question` tool calls

---

## License

[MIT License](LICENSE.txt)

## Contributing

Contributions, feature requests, and bug reports are welcome.

- [Open an issue](https://github.com/kyleGrealis/antigravity-vscode/issues)
- [Submit a pull request](https://github.com/kyleGrealis/antigravity-vscode/pulls)
- [Source code](https://github.com/kyleGrealis/antigravity-vscode)
