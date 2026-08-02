# Release Notes

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
