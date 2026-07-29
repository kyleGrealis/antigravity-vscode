import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgyProcessManager } from './processManager';
import { DiffController } from './diffController';
import { AgyStreamEvent } from './types';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'antigravityVSCodeSidebar';
  private view?: vscode.WebviewView;
  private currentPanel?: vscode.WebviewPanel;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly processManager: AgyProcessManager,
    private readonly diffController: DiffController
  ) {
    this.processManager.on('event', (event: AgyStreamEvent) => {
      this.handleAgyEvent(event);
    });
    this.processManager.on('cancelled', () => {
      this.getWebviews().forEach((wv) =>
        wv.postMessage({ type: 'cancelled' })
      );
    });
    this.processManager.on('close', () => {
      this.getWebviews().forEach((wv) =>
        wv.postMessage({ type: 'processExit' })
      );
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri, vscode.Uri.file(os.tmpdir())],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    this.setupWebviewMessageListeners(webviewView.webview);
  }

  public createOrShowPanel(): vscode.WebviewPanel {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return this.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'antigravityVSCodePanel',
      'Antigravity',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this.extensionUri, vscode.Uri.file(os.tmpdir())],
        retainContextWhenHidden: true,
      }
    );

    this.currentPanel = panel;
    panel.webview.html = this.getHtmlForWebview(panel.webview);
    this.setupWebviewMessageListeners(panel.webview);

    panel.onDidDispose(() => {
      this.currentPanel = undefined;
    });

    return panel;
  }

  private setupWebviewMessageListeners(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'sendPrompt':
          this.onUserPrompt(message.text, message.images);
          break;

        case 'selectImage':
          this.handleSelectImage(webview);
          break;

        case 'savePastedImage':
          this.handleSavePastedImage(message.dataUrl, webview);
          break;

        case 'cancel':
          this.processManager.cancelCurrentTask();
          break;

        case 'newConversation':
          this.processManager.newSession();
          break;

        case 'getActiveFile':
          this.sendActiveFileContext();
          break;

        case 'openFile':
          this.handleOpenFile(message.filePath);
          break;

        case 'slashCommand':
          this.handleSlashCommand(message.name, message.arg, webview);
          break;
      }
    });
  }

  private async handleSelectImage(webview: vscode.Webview) {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach Image',
      filters: { 'Images': ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
    });
    if (uris && uris.length > 0) {
      const filePaths = uris.map((u) => u.fsPath);
      webview.postMessage({ type: 'imagesAttached', paths: filePaths });
    }
  }

  private handleSavePastedImage(dataUrl: string, webview: vscode.Webview) {
    try {
      const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (!matches) return;
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      const tmpDir = os.tmpdir();
      const filePath = path.join(tmpDir, `agy_paste_${Date.now()}.${ext}`);
      fs.writeFileSync(filePath, buffer);
      webview.postMessage({ type: 'imagesAttached', paths: [filePath] });
    } catch (err) {
      console.error('Failed to save pasted image:', err);
    }
  }

  private async handleOpenFile(filePath: string) {
    if (!filePath) return;

    try {
      let rawPath = filePath.trim();
      let line = 0;

      const lineMatch = rawPath.match(/[:#](?:L)?(\d+)(?:-L?\d+)?$/i);
      if (lineMatch) {
        line = parseInt(lineMatch[1], 10) - 1;
        rawPath = rawPath.replace(/[:#](?:L)?(\d+)(?:-L?\d+)?$/i, '');
      }

      let fileUri: vscode.Uri;
      if (rawPath.startsWith('file://')) {
        fileUri = vscode.Uri.parse(rawPath);
      } else if (path.isAbsolute(rawPath)) {
        fileUri = vscode.Uri.file(rawPath);
      } else {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        fileUri = vscode.Uri.file(path.resolve(workspaceFolder, rawPath));
      }

      const doc = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });

      if (line > 0 && line < doc.lineCount) {
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    } catch (err: any) {
      console.error('Antigravity openFile error:', err);
      vscode.window.showErrorMessage(`Could not open file: ${filePath} (${err?.message || err})`);
    }
  }

  private handleSlashCommand(name: string, arg: string | undefined, webview: vscode.Webview) {
    const config = vscode.workspace.getConfiguration('antigravity');

    switch (name) {
      case 'new':
        this.processManager.newSession();
        webview.postMessage({ type: 'slashResult', name, message: 'New conversation started.' });
        break;

      case 'clear':
        this.processManager.newSession();
        webview.postMessage({ type: 'slashResult', name, message: 'Chat cleared.' });
        break;

      case 'model': {
        if (arg) {
          config.update('model', arg, vscode.ConfigurationTarget.Workspace);
          webview.postMessage({ type: 'slashResult', name, message: `Model set to ${arg}.` });
        } else {
          const current = config.get<string>('model') || '(default)';
          webview.postMessage({ type: 'slashResult', name, message: `Current model: ${current}. Usage: /model <name>` });
        }
        break;
      }

      case 'effort': {
        const valid = ['low', 'medium', 'high'];
        if (arg && valid.includes(arg)) {
          config.update('effort', arg, vscode.ConfigurationTarget.Workspace);
          webview.postMessage({ type: 'slashResult', name, message: `Effort set to ${arg}.` });
        } else {
          const current = config.get<string>('effort') || '(default)';
          webview.postMessage({ type: 'slashResult', name, message: `Current effort: ${current}. Options: low, medium, high` });
        }
        break;
      }

      case 'terminal':
        vscode.commands.executeCommand('antigravity-vscode.terminal.open');
        webview.postMessage({ type: 'slashResult', name, message: 'Opened terminal session.' });
        break;

      case 'settings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'antigravity');
        break;

      case 'help': {
        const help = [
          '/new        start a new conversation',
          '/clear      clear chat history',
          '/model      set the model (/model <name>)',
          '/effort     set reasoning effort (/effort low|medium|high)',
          '/terminal   open agy in terminal mode',
          '/settings   open extension settings',
          '/help       show this list',
        ].join('\n');
        webview.postMessage({ type: 'slashResult', name, message: help });
        break;
      }
    }
  }

  private onUserPrompt(promptText: string, images?: string[]) {
    const config = vscode.workspace.getConfiguration('antigravity');
    const cliPath = config.get<string>('cliPath') || 'agy';
    const dangerouslySkipPermissions = config.get<boolean>('dangerouslySkipPermissions') === true;
    const model = config.get<string>('model') || undefined;
    const effort = config.get<string>('effort') || undefined;
    const cwd = this.resolveWorkingDirectory();
    const isFirstTurn = !this.processManager.getConversationId();

    const finalPrompt = this.buildPromptWithIdeContext(promptText, isFirstTurn, cwd, images);

    this.processManager.runPrompt(cliPath, cwd, finalPrompt, {
      model,
      effort,
      dangerouslySkipPermissions,
      images,
    });
  }

  private buildPromptWithIdeContext(userPrompt: string, isFirstTurn: boolean, cwd: string, images?: string[]): string {
    const parts: string[] = [];

    if (images && images.length > 0) {
      const imageList = images.map(img => `[Attached Image File: ${img}]`).join('\n');
      parts.push(`Please inspect and analyze the attached image file(s):\n${imageList}`);
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.selection && !editor.selection.isEmpty) {
      const activeFile = vscode.workspace.asRelativePath(editor.document.uri);
      const selectedText = editor.document.getText(editor.selection);
      const startLine = editor.selection.start.line + 1;
      const endLine = editor.selection.end.line + 1;
      parts.push(`Selected code in ${activeFile} (lines ${startLine}-${endLine}):\n\`\`\`\n${selectedText}\n\`\`\``);
    }

    parts.push(userPrompt);

    return parts.join('\n\n');
  }

  private resolveWorkingDirectory(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let cwd = process.cwd();

    if (workspaceFolders && workspaceFolders.length > 0) {
      cwd = workspaceFolders[0].uri.fsPath;
    }

    if (process.platform === 'linux' && cwd.match(/^[a-zA-Z]:/)) {
      const drive = cwd[0].toLowerCase();
      cwd = `/mnt/${drive}/${cwd.slice(3).replace(/\\/g, '/')}`;
    }

    return cwd;
  }

  private handleAgyEvent(event: AgyStreamEvent) {
    const webviews = this.getWebviews();

    if (event.event === 'step_update' && event.step_update) {
      const step = event.step_update;

      if (step.step_type === 'thinking') {
        if (step.text_delta) {
          webviews.forEach((wv) =>
            wv.postMessage({
              type: 'thinkingDelta',
              delta: step.text_delta,
            })
          );
        }
      } else if (step.text_delta) {
        webviews.forEach((wv) =>
          wv.postMessage({
            type: 'textDelta',
            delta: step.text_delta,
          })
        );
      }

      if (step.step_type === 'tool_call') {
        webviews.forEach((wv) =>
          wv.postMessage({
            type: 'toolCall',
            name: step.tool_name || 'Tool Execution',
            args: step.tool_args,
          })
        );

        // Handle tool calls proposing edits for diff review
        if (
          (step.tool_name === 'replace_file_content' || step.tool_name === 'write_to_file') &&
          step.tool_args
        ) {
          const targetFile = step.tool_args.TargetFile || step.tool_args.targetFile;
          const content = step.tool_args.ReplacementContent || step.tool_args.CodeContent || '';
          if (targetFile && content) {
            this.diffController.showDiff(targetFile, content);
          }
        }
      }

      if (step.state === 'DONE' && step.usage) {
        webviews.forEach((wv) =>
          wv.postMessage({
            type: 'stepComplete',
            usage: step.usage,
          })
        );
      }
    } else if (event.event === 'result' && event.result) {
      webviews.forEach((wv) =>
        wv.postMessage({
          type: 'result',
          status: event.result?.status,
          response: event.result?.response,
          usage: event.result?.usage,
        })
      );
    } else if (event.event === 'error') {
      webviews.forEach((wv) =>
        wv.postMessage({
          type: 'error',
          error: event.error,
        })
      );
    }
  }

  public sendActiveFileContext() {
    const editor = vscode.window.activeTextEditor;
    const filePath = editor ? vscode.workspace.asRelativePath(editor.document.uri) : null;
    this.getWebviews().forEach((wv) =>
      wv.postMessage({
        type: 'activeFile',
        filePath: filePath,
      })
    );
  }

  private getWebviews(): vscode.Webview[] {
    const list: vscode.Webview[] = [];
    if (this.view) list.push(this.view.webview);
    if (this.currentPanel) list.push(this.currentPanel.webview);
    return list;
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Antigravity</title>
</head>
<body>
	<div class="app-container">
		<div class="header-bar">
			<span class="header-title">antigravity</span>
			<div class="header-actions">
				<span id="status-text" class="status-indicator"></span>
				<button id="new-chat-btn" class="icon-btn" title="New conversation">+</button>
			</div>
		</div>

		<div id="chat-messages" class="message-log"></div>

		<div class="input-area">
			<div id="context-bar" class="context-bar" style="display: none;">
				<span id="active-file-context" class="context-chip"></span>
			</div>
			<div id="image-attachment-bar" class="image-attachment-bar" style="display: none;"></div>
			<div class="input-row">
				<div id="slash-menu" class="slash-menu" style="display: none;"></div>
				<textarea id="prompt-input" rows="1" placeholder="What do you want to do? (paste/drop images supported)"></textarea>
			</div>
			<div class="input-footer">
				<span class="input-hint">enter to send, shift+enter for newline</span>
				<div class="input-actions">
					<button id="attach-img-btn" class="icon-btn attach-btn" title="Attach Image">&#128206;</button>
					<button id="cancel-btn" class="text-btn cancel-btn" style="display: none;">cancel</button>
					<button id="send-btn" class="text-btn send-btn">send</button>
				</div>
			</div>
		</div>
	</div>
	<script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
