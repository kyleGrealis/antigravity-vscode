# Antigravity for VS Code

[![Version](https://img.shields.io/badge/version-0.2.0-blue.png)](https://github.com/kyleGrealis/antigravity-vscode/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.png)](LICENSE.txt)

Harness the power of **Google Antigravity (`agy`)** directly inside VS Code and Positron.

<p align="center">
  <img src="media/welcome_screen.png" alt="Antigravity Welcome Screen" width="70%" />
</p>

---

## Features

- **Interactive Plan Mode**: Type `/plan` anywhere in your prompt to enter a step-by-step planning workflow. The plan card renders with progress tracking, approve/modify/cancel actions, inline modification form, and real-time checkbox sync as the agent executes tasks. Prompt box shows contextual states throughout the lifecycle.

<p align="center">
  <img src="media/interactive_plan_mode.png" alt="Interactive Plan Mode" width="70%" />
</p>

- **Tool Execution Cards**: Clean command code blocks with full terminal output history and disclosure chevrons.

<p align="center">
  <img src="media/tool_execution_cards.png" alt="Tool Execution Cards" width="70%" />
</p>

- **File Edit Diffs**: True red/green before-after diffs for all file edit tools (`WriteToFile`, `ReplaceFileContent`, `MultiReplaceFileContent`). Snapshot-chain diffing tracks successive edits, `git show HEAD` provides the baseline for first edits on tracked files, and new files render as all-green additions.
- **Side-by-Side Diff Previews**: Inspect proposed code changes in native VS Code diff views via `Compare in Editor`.
- **Interactive Mermaid Diagrams**: Theme-adaptive SVG rendering for mermaid code blocks with Code/Diagram toggle, SVG export, and fullscreen pan & zoom.
- **Execution Mode Selector**: Press `Shift+Tab` to cycle modes (`Default` > `plan` > `auto accept` > `Default`) with visual badges.
- **Workspace-Scoped Session History**: History picker filtered to the active workspace with search, inline renaming, and automatic state restoration on reload.
- **Prompt History**: `Up/Down Arrow` recalls previous prompts, scoped per workspace and persisted across sessions.
- **Live Streaming & Smart Auto-Scroll**: Scroll lock preserves your reading position during active agent streaming instead of snapping to the bottom.
- **Mid-Turn Steering**: Send follow-up prompts while the agent is working to provide live guidance without interrupting the session.
- **`@` File Mentions**: Type `@` for case-insensitive workspace file search and context insertion.
- **Image Support**: Attach screenshots for visual context and UI debugging.
- **Slash Commands & Skills**: Control settings and execute custom agent skills via slash commands.

---

## Installation

### From GitHub Release (VSIX)

1. Download the latest `.vsix` file from the [Releases](https://github.com/kyleGrealis/antigravity-vscode/releases) page.
2. In VS Code or Positron, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Select **Extensions: Install from VSIX...** and choose the downloaded file.

```bash
code --install-extension antigravity-vscode-0.2.0.vsix
# or for Positron:
positron --install-extension antigravity-vscode-0.2.0.vsix
```

---

## Requirements

- **Antigravity CLI (`agy`)**: `>= 1.0.0` (verify with `agy --version`). Must be in your `PATH` or configured via `antigravity.cliPath`.
- **VS Code**: `^1.85.0` or **Positron**: `>= 2024.06.0`

---

## Slash Commands

<p align="center">
  <img src="media/slash_command_autocomplete.png" alt="Slash Command Autocomplete" width="70%" />
</p>

| Command | Description |
| :--- | :--- |
| `/plan [description]` | Enter Plan Mode and generate an implementation plan. Works anywhere in your prompt. |
| `/sandbox <on\|off>` | Toggle container sandboxing. |
| `/dangerous <on\|off>` | Toggle permission auto-approvals. |
| `/usage` | Display session token statistics overlay. |
| `/new` | Start a fresh conversation session. |
| `/clear` | Clear current chat history. |
| `/settings` | Open extension settings. |
| `/help` | Show available commands and shortcuts. |
| `/<skill-name> [args]` | Invoke custom local agent skills. |

---

## Keyboard Shortcuts

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| `Enter` | Prompt box | Send message |
| `Shift+Enter` | Prompt box | Insert newline |
| `Shift+Tab` | Prompt box | Cycle execution mode (`Default` > `plan` > `auto accept`) |
| `Up Arrow` | Prompt box (empty or cursor at start) | Recall previous prompt from history |
| `Down Arrow` | Prompt box (browsing history) | Navigate forward through history |
| `@` | Prompt box | Open workspace file search for context insertion |
| `/` | Prompt box | Open slash command autocomplete |
| `Escape` | During agent work | Cancel the active request |
| ` ``` ` (triple backtick) | Prompt box | Insert a fenced code block |

---

## Extension Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `antigravity.cliPath` | `"agy"` | Path or executable name for the Antigravity CLI binary. |
| `antigravity.dangerouslySkipPermissions` | `false` | Auto-approve tool permission requests without prompting. |
| `antigravity.bypassSandbox` | `false` | Bypass container sandboxing for tool command execution. |

---

## Known Issues

> **Binary image files (PNG, JPG, etc.) crash the agy CLI on Windows** (as of agy v1.1.10, August 3 2026 update). When the agent reads a binary image file via `ReadFile`/`view_file`, the session terminates with "Agent execution terminated due to error" and the **entire conversation is permanently poisoned** -- all subsequent prompts on that session will fail, even text-only ones. This affects pasted image attachments, `@` file mentions of images, and cases where the agent autonomously discovers and reads image files. **This is an upstream Google bug, not an extension issue.** Linux is unaffected. Use `/new` to start a fresh session after encountering this error. See [community report](https://discuss.ai.google.dev/t/antigravity-cli-stopped-reading-png-files/177160).

---

## Roadmap

- [x] ~~Window-scoped prompt history (per-workspace `Up Arrow` recall)~~
- [x] ~~Viewport-constrained image previews~~ (pending upstream CLI fix for binary file handling)
- [ ] Interactive clarification cards for `ask_question` tool calls
- [ ] Agent workflow visualizations (subagent teams, background tasks)
- [ ] Authentication & first-time onboarding flow

---

## License

[MIT License](LICENSE.txt)

## Contributing

Contributions, feature requests, and bug reports are welcome.

- [Open an issue](https://github.com/kyleGrealis/antigravity-vscode/issues)
- [Submit a pull request](https://github.com/kyleGrealis/antigravity-vscode/pulls)
- [Source code](https://github.com/kyleGrealis/antigravity-vscode)

Collaborators welcome!
