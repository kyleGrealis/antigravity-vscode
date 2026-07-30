# New Session Behavioral Expectations

This document outlines the expected behavior when a user initiates a new chat session in the `antigravity-vscode` extension.

---

## 1. Initiating a New Conversation

When clicking **Antigravity: New Conversation** (or executing `/new`):

* **Webview UI State:**
  * Header title resets to **Untitled**.
  * Chat message log clears completely.
  * Active conversation ID resets to `null`.
* **VS Code Workspace State:**
  * `activeConversationId` in `workspaceState` is set to `undefined`.

---

## 2. Empty Chat Welcome Screen

When a conversation is empty (new conversation or uninitialized state):

* **Centered Hero Display:**
  * Centered SVG vector logo (`antigravity-icon.svg`) with glowing shadow.
  * Title **Antigravity** and subtitle **How can I help you build today?**.
* **Interactive Suggestion Cards:**
  * 2x2 grid of prompt suggestions:
    1. 🔍 *Explain workspace architecture*
    2. 🧪 *Write unit tests*
    3. ⚡ *Audit bugs & performance*
    4. 📋 *Plan feature implementation*
  * Clicking any card automatically populates the prompt input textarea and focuses it.

---

## 3. Sending the First Prompt in a New Session

When the user submits their first prompt in the new session:

* **Process Execution:**
  * `AgyProcessManager` executes `agy` **without** passing `--conversation <id>`.
  * `agy` CLI generates a brand new conversation ID in `~/.gemini/antigravity-cli/brain/<new-id>`.
* **State & Event Handling:**
  * As soon as stream events (`conversation_id` / `step_update`) return from `agy`, `ChatWebviewProvider` automatically persists `<new-id>` into `workspaceState` under `activeConversationId`.
  * Header title updates dynamically or stays editable.

---

## 4. Session History & Selection Behavior

* **Session History Dropdown:**
  * Opening the history menu displays all prior sessions sorted by `updatedAt` (newest first).
  * Searching filters by title or conversation ID snippet in real time.
  * Clicking the pencil icon on any item allows inline renaming of session titles.

---

## 5. Positron Reload Behavior (Session Persistence Test)

When reloading Positron:

* **Auto-Restoration:**
  * If a session was active, `ChatWebviewProvider` reads `activeConversationId` from `workspaceState`.
  * If `workspaceState` is empty, it automatically falls back to the most recent session folder in `~/.gemini/antigravity-cli/brain/`.
  * The webview re-attaches to that exact session ID, sending `--conversation <id>` on subsequent prompts, preventing unwanted session splitting.
