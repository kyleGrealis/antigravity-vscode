# Release Notes

## antigravity-vscode 0.2.2

- **`/effort` slash command**: Set reasoning effort (low/medium/high) mid-session with autocomplete sub-menu. Passes `--effort` flag to agy CLI on each spawn.
- **Sandbox flag wired**: `--sandbox` toggle now actually passes the flag to agy (was UI-only before).
- **`/help` updated**: Added `/effort` to the help table.

## antigravity-vscode 0.2.1

- **Subagent tracking**: Live badge, elapsed timer, and inline kill button on `invoke_subagent` tool cards.
- **Task kill routing**: UUID subagent IDs route to `manage_subagents`, short task IDs route to `manage_task`.
- **UUID false-positive fix**: Task tracker no longer matches calendar iCalUIDs or email message IDs as subagent tasks.
- **Session delete**: Delete button with confirm dialog in session picker.
- **Inline code styling**: Removed blue borders from inline `code` spans; softened background tint.
- **Scrollbar layout**: Scrollbar hugs viewport edge while content stays centered.

### Known upstream bug (Google) -- RESOLVED in agy 1.1.11

The Windows PNG crash from agy v1.1.10 is **fixed in agy v1.1.11**. Binary image files (PNG, JPG, etc.) no longer crash the CLI on Windows. Image paste/attach works on all platforms.

## antigravity-vscode 0.2.0

- **Workspace config injection**: Prepend `.gemini/GEMINI.md` and `.gemini/AGENTS.md` to first-turn prompts (`--print` mode skips workspace configs natively, so the extension injects them).
- **Session hardening**: Kill orphan agy processes on extension deactivate and before session switches. Reset zombie `turnActive` state when process is gone but flag is stuck.
- **Conversation ID validation**: Verify transcript `.jsonl` exists before restoring a conversation on restart, preventing attempts to resume nonexistent sessions.
- **Plan trigger fix**: Plan file watcher now requires a known active plan file path instead of firing on any `*plan*.md` match.
- **Performance telemetry**: Spawn-to-init and total turn timing logged to the Antigravity Debug output channel.
- **Error detail forwarding**: Show agy error details on failed responses instead of generic "[Response failed]".

### Known upstream bug (Google)

**Binary image files (PNG, JPG, etc.) crash the agy CLI on Windows** as of the August 3 2026 auto-update (agy v1.1.10). Reading any binary image file terminates the session and permanently poisons the conversation. This is a Google-side regression, not an extension bug. Linux is unaffected. Use `/new` to recover. See [community report](https://discuss.ai.google.dev/t/antigravity-cli-stopped-reading-png-files/177160).

## antigravity-vscode 0.1.6

- **Plan Mode overhaul**: Full lifecycle plan cards with approve, modify, cancel, and real-time checkbox sync during execution. Contextual prompt box states throughout the plan workflow.
- **`/plan` anywhere in prompt**: `/plan` no longer needs to be the first word. Write naturally and include `/plan` wherever it fits.
- **Tool call interception**: Plan detection works by intercepting CLI `WriteToFile` events and parsing for markdown checklists, so plans written to the CLI brain directory are picked up automatically.
- **Modular webview codebase**: Extracted 7 controller modules from the monolithic `main.ts` (slash menu, scroll manager, usage tracker, session history, plan card, at-menu, mermaid modal).
- **Workspace-scoped git diffs**: Diff previews now skip files outside the repo instead of throwing errors.
- **Debug channel singleton**: Fixed OutputChannel leak that created a new channel on every tool event.
- **Removed dead PlanManager**: Replaced the old `.antigravity/plans/` file-writing approach with tool call interception.

## antigravity-vscode 0.1.5

- **Execution mode selector**: Cycle modes (`Default`, `plan`, `auto accept`) via `Shift+Tab` with live status badges.
- **Slash command suite**: `/sandbox`, `/dangerous`, `/plan`, `/usage`, `/settings`, `/help`.
- **Token usage overlay**: Floating modal for session token metrics and per-turn breakdown.
- **Smart auto-scroll lock**: Scroll position preserved during active streaming.
- **Live diff previews**: Streaming diff cards for file modifications with `Compare in Editor` button.

## antigravity-vscode 0.1.4

- **Interactive plan mode**: Planning interface with inline review, modification forms, and progress tracking.
- **Welcome screen**: Hero logo and interactive suggestion cards.
- **Mermaid diagrams**: Theme-adaptive SVG rendering with fullscreen zoom.
- **Workspace session isolation**: Sessions filtered by active workspace directory.

## antigravity-vscode 0.1.3

- **Session management**: Inline renaming, search filtering, and automatic state restoration.
- **`@` file mentions**: Case-insensitive workspace file autocomplete.
- **Mid-turn steering**: Send prompts while the agent is active.
