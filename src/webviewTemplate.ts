import * as vscode from 'vscode';

export function getHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
  const katexStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'katex', 'katex.min.css'));
  const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'antigravity-icon.svg'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${katexStyleUri}" rel="stylesheet">
	<link href="${styleUri}" rel="stylesheet">
	<title>Antigravity</title>
</head>
<body>
	<div class="app-container">
		<div class="header-bar">
			<div class="header-left">
				<img src="${logoUri}" class="header-logo" alt="Antigravity" />
				<span class="header-brand">ANTIGRAVITY</span>
				<span class="header-sep">/</span>
				<span id="header-session-title" class="header-title" title="Double click to rename session">Untitled</span>
				<button id="edit-header-title-btn" class="icon-btn edit-title-btn" title="Rename session">&#9999;&#65039;</button>
			</div>
			<div class="header-actions">
				<span id="header-workspace-badge" class="header-workspace-badge" style="display: none;"></span>
				<button id="new-chat-btn" class="icon-btn" title="New conversation">+</button>
				<button id="header-menu-btn" class="icon-btn" title="Menu & Actions">&#8942;</button>
			</div>
		</div>

		<div id="header-settings-dropdown" class="header-settings-dropdown" style="display: none;"></div>
		<div id="history-dropdown" class="history-dropdown" style="display: none;"></div>

		<div id="chat-messages" class="message-log">
			<div id="empty-state" class="empty-state">
				<div class="empty-state-hero">
					<img src="${logoUri}" class="empty-state-logo-img" alt="Antigravity" />
					<div class="empty-state-title">Antigravity</div>
					<div class="empty-state-subtitle">How can I help you build today?</div>
				</div>
				<div class="empty-state-suggestions">
					<button class="suggestion-card" data-prompt="Explain the architecture of this workspace">
						<span class="card-icon">🔍</span>
						<span class="card-text">Explain workspace architecture</span>
					</button>
					<button class="suggestion-card" data-prompt="Help me write unit tests for this project">
						<span class="card-icon">🧪</span>
						<span class="card-text">Write unit tests</span>
					</button>
					<button class="suggestion-card" data-prompt="Find potential bugs or performance bottlenecks">
						<span class="card-icon">⚡</span>
						<span class="card-text">Audit bugs & performance</span>
					</button>
					<button class="suggestion-card" data-prompt="/plan Plan step-by-step feature implementation">
						<span class="card-icon">📋</span>
						<span class="card-text">Plan feature implementation</span>
					</button>
				</div>
			</div>
		</div>

		<div id="plan-confirm-bar" class="plan-confirm-bar" style="display: none;">
			<span class="plan-confirm-text">It looks like you want a plan. Enter plan mode?</span>
			<div class="plan-confirm-actions">
				<button id="plan-confirm-yes" class="plan-confirm-btn plan-confirm-yes">Yes, plan mode</button>
				<button id="plan-confirm-no" class="plan-confirm-btn plan-confirm-no">No, just send it</button>
			</div>
		</div>
		<div class="input-area">
			<div class="input-row">
				<div id="slash-menu" class="slash-menu" style="display: none;"></div>
				<div id="at-menu" class="at-menu" style="display: none;"></div>
				<div class="prompt-box-container">
					<div id="input-context-header" class="input-context-header">
						<span id="context-hint" class="context-hint">Use @ to mention files or / for commands</span>
						<div id="context-bar" class="context-bar" style="display: none;">
							<span id="active-file-context" class="context-chip"></span>
						</div>
					</div>
					<div id="image-attachment-bar" class="image-attachment-bar" style="display: none;"></div>
					<textarea id="prompt-input" rows="1" placeholder="Ask Antigravity or describe a task..."></textarea>
					<div class="input-footer">
						<span id="status-text" class="input-hint status-indicator">enter to send, shift+enter for newline</span>
						<div class="input-actions">
							<span id="mode-text" class="mode-text" style="display: none;"></span>
							<span id="sandbox-text" class="mode-text mode-sandbox" style="display: none;"></span>
							<button id="attach-img-btn" class="icon-btn attach-btn" title="Attach Image">&#128206;</button>
							<button id="cancel-btn" class="text-btn cancel-btn" style="display: none;">cancel</button>
							<button id="send-btn" class="text-btn send-btn">send</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
	<script src="${scriptUri}"></script>
</body>
</html>`;
}
