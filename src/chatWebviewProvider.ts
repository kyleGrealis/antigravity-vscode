import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgyProcessManager } from './processManager';
import { DiffController } from './diffController';
import { AgyStreamEvent } from './types';

function cleanToolArgs(rawArgs: any): Record<string, any> | undefined {
  if (!rawArgs) return undefined;
  let parsed = rawArgs;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // not JSON
    }
  }
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // not JSON
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return typeof rawArgs === 'string' && rawArgs.trim() ? { arg: rawArgs.trim() } : undefined;
  }
  const cleanedArgs: Record<string, any> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string') {
      let valStr = v.trim();
      if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith('{') && valStr.endsWith('}')) || (valStr.startsWith('[') && valStr.endsWith(']'))) {
        try {
          cleanedArgs[k] = JSON.parse(valStr);
        } catch {
          if (valStr.startsWith('"') && valStr.endsWith('"') && valStr.length >= 2) {
            cleanedArgs[k] = valStr.slice(1, -1);
          } else {
            cleanedArgs[k] = valStr;
          }
        }
      } else {
        cleanedArgs[k] = v;
      }
    } else {
      cleanedArgs[k] = v;
    }
  }
  return Object.keys(cleanedArgs).length > 0 ? cleanedArgs : undefined;
}

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

        case 'searchFiles':
          this.handleSearchFiles(message.query, webview);
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
      
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let saveDir = os.tmpdir();
      if (workspaceFolders && workspaceFolders.length > 0) {
        saveDir = path.join(workspaceFolders[0].uri.fsPath, '.antigravity');
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true });
        }
      }

      const filePath = path.join(saveDir, `agy_paste_${Date.now()}.${ext}`).replace(/\\/g, '/');
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

    const normalizedImages = images?.map((img) => img.replace(/\\/g, '/'));

    const finalPrompt = this.buildPromptWithIdeContext(promptText, isFirstTurn, cwd, normalizedImages);

    this.processManager.runPrompt(cliPath, cwd, finalPrompt, {
      model,
      effort,
      dangerouslySkipPermissions,
      images: normalizedImages,
    });
  }

  private buildPromptWithIdeContext(userPrompt: string, isFirstTurn: boolean, cwd: string, images?: string[]): string {
    const parts: string[] = [];

    if (images && images.length > 0) {
      const imageList = images.map((img) => `- ${path.resolve(img).replace(/\\/g, '/')}`).join('\n');
      parts.push(
        `[ATTACHED IMAGES]\nThe user attached the following image file(s):\n${imageList}\n\nIMPORTANT: You MUST call your \`view_file\` tool on the attached image file path(s) to inspect and view the image content before responding.`
      );
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
      const step = event.step_update as any;
      const stepType = (step.step_type || step.type || '').toLowerCase();

      const isThinkingStep =
        stepType === 'thinking' ||
        stepType === 'thought' ||
        stepType === 'reasoning';

      const thinkingDelta =
        (isThinkingStep ? (step.text_delta || step.delta || step.text || step.content || step.thinking_delta || step.reasoning_content || step.thinking || step.thought) : null) ||
        step.thinking_delta ||
        step.reasoning_content ||
        step.thinking ||
        step.thought;

      if (thinkingDelta) {
        webviews.forEach((wv) =>
          wv.postMessage({
            type: 'thinkingDelta',
            delta: thinkingDelta,
          })
        );
      }

      const toolInfo = step.tool_info || {};

      const toolNameRaw = step.tool_name || toolInfo.name || step.tool || step.name || (step.tool_calls && step.tool_calls[0]?.name) || (step.tool_calls && step.tool_calls[0]?.tool_name);
      const isKnownToolType = [
        'run_command', 'view_file', 'grep_search', 'list_directory', 'list_dir',
        'replace_file_content', 'multi_replace_file_content', 'write_to_file',
        'ask_question', 'ask_permission', 'read_url_content', 'search_web',
        'invoke_subagent', 'define_subagent', 'send_message', 'manage_task',
        'manage_subagents', 'schedule', 'generate_image'
      ].includes(stepType);

      const isToolCall =
        stepType === 'tool' ||
        stepType === 'tool_call' ||
        stepType === 'tool_use' ||
        isKnownToolType ||
        !!toolNameRaw ||
        (Array.isArray(step.tool_calls) && step.tool_calls.length > 0);

      if (Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
        step.tool_calls.forEach((tcItem: any, idx: number) => {
          let toolName = tcItem.name || tcItem.tool_name || tcItem.function?.name || stepType || 'Tool Execution';
          toolName = toolName.toLowerCase().replace(/^(cortex_step_type_|step_type_)/, '');

          let rawArgs = tcItem.args || tcItem.tool_args || tcItem.input || tcItem.parameters || tcItem.function?.arguments;
          let toolArgs = cleanToolArgs(rawArgs);

          let rawError = toolInfo.error || step.error || tcItem.error;
          let errorMessage = rawError ? (typeof rawError === 'string' ? rawError : rawError.message || JSON.stringify(rawError)) : '';

          let toolResult = tcItem.result || tcItem.output || toolInfo.output || step.content || step.output || step.result || step.text || (errorMessage ? `[Error] ${errorMessage}` : undefined);
          const toolStatus = (step.state === 'DONE' || step.state === 'SUCCESS') ? 'done' : (step.state === 'ERROR' || step.state === 'FAILURE' || !!errorMessage) ? 'error' : 'running';
          const toolId = tcItem.id || tcItem.tool_call_id || tcItem.call_id || (step.step_index !== undefined ? `step_${step.step_index}_${idx}` : `${toolName}_${idx}`);

          webviews.forEach((wv) =>
            wv.postMessage({
              type: 'toolCall',
              id: toolId,
              name: toolName,
              args: toolArgs,
              status: toolStatus,
              result: toolResult,
            })
          );

          if (
            (toolName === 'replace_file_content' || toolName === 'write_to_file' || toolName === 'multi_replace_file_content') &&
            toolArgs
          ) {
            const targetFile = toolArgs.TargetFile || toolArgs.targetFile;
            const content = toolArgs.ReplacementContent || toolArgs.CodeContent || '';
            if (targetFile && content) {
              this.diffController.showDiff(targetFile, content);
            }
          }
        });
      } else if (isToolCall) {
        let toolName = toolNameRaw || (isKnownToolType ? stepType : '');
        toolName = toolName.toLowerCase().replace(/^(cortex_step_type_|step_type_)/, '');

        let rawArgs = step.tool_args || step.args || step.input || step.parameters || toolInfo.parameters || toolInfo.args || step.call?.args;
        let toolArgs = cleanToolArgs(rawArgs);

        let rawError = toolInfo.error || step.error;
        let errorMessage = rawError ? (typeof rawError === 'string' ? rawError : rawError.message || JSON.stringify(rawError)) : '';

        let toolResult = toolInfo.output || step.content || step.output || step.result || step.text || (errorMessage ? `[Error] ${errorMessage}` : undefined) || (step.state === 'DONE' ? step.text_delta : undefined);

        const isGenericName = !toolName || ['tool', 'tool_call', 'tool_use', 'tool execution', 'tool_execution'].includes(toolName);

        if (!isGenericName || toolArgs || toolResult) {
          if (isGenericName) toolName = 'Tool Execution';
          const toolStatus = (step.state === 'DONE' || step.state === 'SUCCESS') ? 'done' : (step.state === 'ERROR' || step.state === 'FAILURE' || !!errorMessage) ? 'error' : 'running';
          const toolId = step.tool_call_id || step.call_id || step.id || (step.step_index !== undefined ? `step_${step.step_index}` : toolName);

          webviews.forEach((wv) =>
            wv.postMessage({
              type: 'toolCall',
              id: toolId,
              name: toolName,
              args: toolArgs,
              status: toolStatus,
              result: toolResult,
            })
          );

          if (
            (toolName === 'replace_file_content' || toolName === 'write_to_file' || toolName === 'multi_replace_file_content') &&
            toolArgs
          ) {
            const targetFile = toolArgs.TargetFile || toolArgs.targetFile;
            const content = toolArgs.ReplacementContent || toolArgs.CodeContent || '';
            if (targetFile && content) {
              this.diffController.showDiff(targetFile, content);
            }
          }
        }
      }

      const textDelta = step.text_delta || step.delta || step.text || step.content;
      if (
        !isThinkingStep &&
        !isToolCall &&
        stepType !== 'user_input' &&
        textDelta
      ) {
        webviews.forEach((wv) =>
          wv.postMessage({
            type: 'textDelta',
            delta: textDelta,
          })
        );
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
      const resultObj = event.result as any;
      const responseText =
        resultObj.response ||
        resultObj.text ||
        resultObj.content ||
        resultObj.output ||
        '';

      webviews.forEach((wv) =>
        wv.postMessage({
          type: 'result',
          status: resultObj.status,
          response: responseText,
          usage: resultObj.usage,
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

  private async handleSearchFiles(query: string, webview: vscode.Webview) {
    try {
      const searchPattern = query ? `**/*${query}*` : '**/*';
      const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.antigravity/**}';
      const uris = await vscode.workspace.findFiles(searchPattern, excludePattern, 50);
      const files = uris.map((u) => vscode.workspace.asRelativePath(u));

      files.sort((a, b) => {
        const q = (query || '').toLowerCase();
        const aBase = path.basename(a).toLowerCase();
        const bBase = path.basename(b).toLowerCase();
        const aStarts = aBase.startsWith(q);
        const bStarts = bBase.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      });

      webview.postMessage({ type: 'fileSearchResults', query, files });
    } catch (err) {
      console.error('Failed to search files for @ completion:', err);
      webview.postMessage({ type: 'fileSearchResults', query, files: [] });
    }
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
				<div id="at-menu" class="at-menu" style="display: none;"></div>
				<textarea id="prompt-input" rows="1" placeholder="What do you want to do? Use @ to mention files..."></textarea>
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
