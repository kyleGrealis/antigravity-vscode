# News / Release Notes

## Unreleased (Work in Progress)

- **Interactive Mermaid Diagrams**: Auto-renders ````mermaid```` code blocks into theme-adaptive SVG diagrams with Code/Diagram toggle, Copy SVG, Copy Code, and Fullscreen Pan & Zoom modal.
- **Instant Mid-Turn Steering**: Submit prompts while an agent turn is active to provide live guidance without interrupting session state or resetting UI.
- **Unified Git Diff Cards**: Re-usable syntax-highlighted git diff cards for file modifications (`ReplaceFileContent`, `multi_replace_file_content`, `write_to_file`) with context lines and side-by-side editor diff button (`Compare in Editor ↗`). *(Note: Full syntax-highlighted diffs render automatically upon window/session reload; live streaming card polish is ongoing.)*
- **Strict Workspace Session Isolation**: Scoped chat sessions and history picker strictly to active workspace directory, preventing cross-project conversation leakage.

## antigravity-vscode 0.1.5

- **Execution Mode Selector**: Cycle execution modes (`Default`, `plan`, `auto accept`) via `Shift+Tab` with live status indicators.
- **Slash Commands & Control Suite**: Added `/sandbox`, `/dangerous`, `/plan`, `/usage`, `/settings`, and `/help` slash command controls.
- **Token Usage Overlay (`/usage`)**: Added floating modal overlay for session token metrics and per-turn breakdown.

## antigravity-vscode 0.1.4

- **Interactive Plan Mode**: Dedicated planning interface with inline review & modification forms, execution progress tracking, and clarification cards.
- **Empty State Welcome Screen**: Centered hero vector logo and interactive prompt suggestion cards grid.
- **Tool Card & History Polish**: Formatted command code blocks for tool execution cards, transcript history linking, and case-insensitive `@` file mentions.

## antigravity-vscode 0.1.3

- **Session Management**: Added inline session renaming in history dropdown and main header title bar with real-time search filtering.
- **Session Persistence**: Automatic session restoration and state synchronization across editor reloads.
