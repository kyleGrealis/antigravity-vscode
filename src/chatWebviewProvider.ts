import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { AgyProcessManager } from './processManager';
import { DiffController } from './diffController';
import { AgyStreamEvent } from './types';
import { loadSkills } from './skillManager';
import { toForwardSlash, normalizePath, normalizePathLower, isInsidePath } from './pathUtils';
import { getHtmlForWebview } from './webviewTemplate';
import { processAgyStreamEvent } from './streamEventProcessor';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'antigravityVSCodeSidebar';
  public view?: vscode.WebviewView;
  private currentPanel?: vscode.WebviewPanel;
  private sessionSkipPermissions: boolean = false;
  private sessionAllowedCommands: Set<string> = new Set();
  private effortLevel: 'low' | 'medium' | 'high' = 'medium';
  private lastUserPrompt: { promptText: string; images?: string[] } | null = null;
  private pendingPrompt: { promptText: string; images?: string[] } | null = null;
  private isSteeringPivot = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly processManager: AgyProcessManager,
    private readonly diffController: DiffController,
    private readonly context?: vscode.ExtensionContext
  ) {
    this.debugChannel = vscode.window.createOutputChannel('Antigravity Debug', { log: true });
    this.debugChannel.clear();

    const activeWorkspacePath = this.resolveWorkingDirectory();
    let restoredId = this.context?.workspaceState.get<string>('activeConversationId');
    if (restoredId) {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      const convDir = path.join(brainDir, restoredId);
      const hasTranscript = fs.existsSync(convDir) &&
        fs.readdirSync(convDir).some(f => f.endsWith('.jsonl'));
      if (hasTranscript) {
        const wsInfo = this.getSessionWorkspace(restoredId, convDir);
        if (!this.isWorkspaceMatch(wsInfo.workspacePath, activeWorkspacePath)) {
          restoredId = undefined;
        }
      } else {
        restoredId = undefined;
      }
    }

    if (!restoredId) {
      const sessions = this.getSessionsList();
      if (sessions.length > 0) {
        restoredId = sessions[0].id;
        this.context?.workspaceState.update('activeConversationId', restoredId);
      }
    }
    if (restoredId) {
      this.processManager.setConversationId(restoredId);
    } else {
      this.processManager.newSession();
    }

    this.processManager.on('event', (event: AgyStreamEvent) => {
      this.handleAgyEvent(event);
    });
    this.processManager.on('stderr', (msg: string) => {
      if (!this.debugChannel) {
        this.debugChannel = vscode.window.createOutputChannel('Antigravity Debug', { log: true });
      }
      this.debugChannel.appendLine(`[stderr] ${msg.trimEnd()}`);
    });
    this.processManager.on('timing', (info: { phase: string; ms: number }) => {
      if (!this.debugChannel) {
        this.debugChannel = vscode.window.createOutputChannel('Antigravity Debug', { log: true });
      }
      this.debugChannel.appendLine(`[timing] ${info.phase}: ${(info.ms / 1000).toFixed(2)}s`);
    });
    this.processManager.on('cancelled', () => {
      if (this.isSteeringPivot) {
        return;
      }
      this.getWebviews().forEach((wv) =>
        wv.postMessage({ type: 'cancelled' })
      );
    });
    this.processManager.on('close', () => {
      if (this.isSteeringPivot) {
        return;
      }
      this.getWebviews().forEach((wv) =>
        wv.postMessage({ type: 'processExit' })
      );
    });

    this.setupPlanFileWatcher();

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('antigravity.dangerouslySkipPermissions') ||
        e.affectsConfiguration('antigravity.bypassSandbox')
      ) {
        this.sendConfigUpdate();
      }
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
      localResourceRoots: this.getResourceRoots(),
    };

    webviewView.webview.html = getHtmlForWebview(this.extensionUri, webviewView.webview);
    this.setupWebviewMessageListeners(webviewView.webview);
    this.sendSlashCommands(webviewView.webview);
    this.sendConfigUpdate(webviewView.webview);
    this.sendResourceMappings(webviewView.webview);
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
        localResourceRoots: this.getResourceRoots(),
        retainContextWhenHidden: true,
      }
    );

    this.currentPanel = panel;
    panel.webview.html = getHtmlForWebview(this.extensionUri, panel.webview);
    this.setupWebviewMessageListeners(panel.webview);
    this.sendSlashCommands(panel.webview);
    this.sendResourceMappings(panel.webview);

    panel.onDidDispose(() => {
      this.currentPanel = undefined;
    });

    return panel;
  }

  public sendSlashCommands(targetWebview?: vscode.Webview) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : undefined;
    const skills = loadSkills(workspacePath);

    const baseCommands = [
      { name: 'new', description: 'start a new conversation' },
      { name: 'clear', description: 'clear chat history' },
      { name: 'plan', description: 'request step-by-step planning before execution' },
      { name: 'usage', description: 'show session token usage statistics overlay' },
      { name: 'goal', description: 'run a long-running task with extra thoroughness' },
      { name: 'schedule', description: 'set a timer or recurring cron schedule' },
      { name: 'teamwork-preview', description: 'orchestrate autonomous subagent team' },
      { name: 'learn', description: 'save workflow/lessons to skills/knowledge-base' },
      { name: 'effort', description: 'set reasoning effort', hasArg: true, argHint: '<low|medium|high>', options: [
        { value: 'low', label: 'quick lookups, simple tasks' },
        { value: 'medium', label: 'balanced (default)' },
        { value: 'high', label: 'deep analysis, complex reasoning' },
      ]},
      { name: 'sandbox', description: 'toggle container sandboxing (on/off)', hasArg: true, argHint: '<on|off>' },
      { name: 'dangerous', description: 'toggle permission auto-approvals (on/off)', hasArg: true, argHint: '<on|off>' },
      { name: 'settings', description: 'open extension settings' },
      { name: 'help', description: 'show available commands' },
    ];

    const skillOptions = skills.map(s => ({
      value: s.name,
      label: s.description,
    }));

    const skillCommand = {
      name: 'skill',
      description: 'invoke an available skill',
      hasArg: true,
      argHint: '<skill-name>',
      options: skillOptions,
    };

    const directSkillCommands = skills.map(s => ({
      name: s.name,
      description: s.description,
      isSkill: true,
      hasArg: false,
    }));

    const allCommands = [...baseCommands, skillCommand, ...directSkillCommands];

    const webviews = targetWebview ? [targetWebview] : this.getWebviews();
    webviews.forEach(wv => {
      wv.postMessage({ type: 'setSlashCommands', commands: allCommands });
    });
  }

  public sendConfigUpdate(targetWebview?: vscode.Webview) {
    const config = vscode.workspace.getConfiguration('antigravity');
    const dsp = config.get<boolean>('dangerouslySkipPermissions') === true;
    const bypassSandbox = config.get<boolean>('bypassSandbox') === true;
    const msg = { command: 'configUpdate', dangerouslySkipPermissions: dsp, bypassSandbox };
    if (targetWebview) {
      targetWebview.postMessage(msg);
    } else {
      this.getWebviews().forEach((wv) => wv.postMessage(msg));
    }
  }

  public sendActiveModel(targetWebview?: vscode.Webview) {
    const config = vscode.workspace.getConfiguration('antigravity');
    const model = config.get<string>('model') || 'gemini-2.5-pro';
    const webviews = targetWebview ? [targetWebview] : this.getWebviews();
    webviews.forEach(wv => {
      wv.postMessage({ type: 'updateModel', model });
    });
  }

  private setupWebviewMessageListeners(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'userPrompt':
        case 'sendPrompt':
          this.onUserPrompt(message.promptText || message.text, message.images, message.dangerouslySkipPermissions, message.textFiles);
          break;

        case 'selectImage':
          this.handleSelectFile(webview);
          break;

        case 'savePastedImage':
          this.handleSavePastedImage(message.dataUrl, webview);
          break;

        case 'cancel':
          this.pendingPrompt = null;
          this.processManager.cancelCurrentTask();
          this.getWebviews().forEach((wv) => wv.postMessage({ type: 'cancelled' }));
          break;


        case 'planConfirmResponse': {
          const pending = this.pendingPlanPrompt;
          this.pendingPlanPrompt = null;
          if (!pending) break;
          if (message.choice === 'yes') {
            const planArg = pending.promptText.replace(pending.planHintRe, '').trim() || 'Feature Plan';
            this.handleSlashCommand('plan', planArg);
          } else {
            this.dispatchPrompt(pending.promptText, pending.images, pending.dangerouslySkipPermissions);
          }
          break;
        }

        case 'permissionResponse':
          this.handlePermissionResponse(message.choice);
          break;

        case 'ready':
          this.sendSlashCommands(webview);
          this.sendConfigUpdate(webview);
          break;

        case 'newConversation': {
          this.sessionSkipPermissions = false;
          this.sessionAllowedCommands.clear();
          this.processManager.newSession();
          if (this.context) {
            this.context.workspaceState.update('activeConversationId', undefined);
          }
          const activeWorkspacePath = this.resolveWorkingDirectory();
          const workspaceInfo = {
            name: path.basename(activeWorkspacePath),
            path: activeWorkspacePath,
          };
          webview.postMessage({
            type: 'sessionLoaded',
            conversationId: null,
            title: 'Untitled',
            events: [],
            workspaceInfo,
          });
          break;
        }

        case 'getSessions': {
          const activeWorkspacePath = this.resolveWorkingDirectory();
          let currentId = this.processManager.getConversationId();

          if (currentId) {
            const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
            const convDir = path.join(brainDir, currentId);
            const wsInfo = this.getSessionWorkspace(currentId, convDir);
            if (!this.isWorkspaceMatch(wsInfo.workspacePath, activeWorkspacePath)) {
              currentId = null;
            }
          }

          if (!currentId) {
            currentId = this.context?.workspaceState.get<string>('activeConversationId') || null;
            if (currentId) {
              const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
              const convDir = path.join(brainDir, currentId);
              const wsInfo = this.getSessionWorkspace(currentId, convDir);
              if (!this.isWorkspaceMatch(wsInfo.workspacePath, activeWorkspacePath)) {
                currentId = null;
              }
            }
            if (!currentId) {
              const sessions = this.getSessionsList();
              if (sessions.length > 0) {
                currentId = sessions[0].id;
              }
            }
            if (currentId) {
              this.processManager.setConversationId(currentId);
              if (this.context) {
                this.context.workspaceState.update('activeConversationId', currentId);
              }
            } else {
              this.processManager.newSession();
              this.context?.workspaceState.update('activeConversationId', undefined);
            }
          }

          const sessions = this.getSessionsList();
          const workspaceInfo = {
            name: path.basename(activeWorkspacePath),
            path: activeWorkspacePath,
          };
          webview.postMessage({ type: 'sessionsList', sessions, currentId, workspaceInfo });

          if (currentId) {
            const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
            const convDir = path.join(brainDir, currentId);
            const title = this.getSessionTitle(currentId, convDir);
            const events = this.loadSessionHistory(currentId);
            webview.postMessage({
              type: 'sessionLoaded',
              conversationId: currentId,
              title,
              events,
              workspaceInfo,
            });
          } else {
            webview.postMessage({
              type: 'sessionLoaded',
              conversationId: null,
              title: 'Untitled',
              events: [],
              workspaceInfo,
            });
          }
          break;
        }

        case 'selectSession': {
          this.sessionSkipPermissions = false;
          this.sessionAllowedCommands.clear();
          this.processManager.killProcess();
          this.processManager.setConversationId(message.conversationId);
          if (this.context) {
            this.context.workspaceState.update('activeConversationId', message.conversationId);
          }
          const activeWorkspacePath = this.resolveWorkingDirectory();
          this.saveSessionWorkspace(message.conversationId, activeWorkspacePath);

          const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
          const convDir = path.join(brainDir, message.conversationId);
          const title = this.getSessionTitle(message.conversationId, convDir);
          const events = this.loadSessionHistory(message.conversationId);
          const workspaceInfo = {
            name: path.basename(activeWorkspacePath),
            path: activeWorkspacePath,
          };

          webview.postMessage({
            type: 'sessionLoaded',
            conversationId: message.conversationId,
            title,
            events,
            workspaceInfo,
          });
          break;
        }

        case 'renameSession': {
          if (message.conversationId && message.title) {
            this.saveSessionTitle(message.conversationId, message.title);
            const sessions = this.getSessionsList();
            const currentId = this.processManager.getConversationId();
            const activeWorkspacePath = this.resolveWorkingDirectory();
            const workspaceInfo = {
              name: path.basename(activeWorkspacePath),
              path: activeWorkspacePath,
            };
            this.getWebviews().forEach((wv) => {
              wv.postMessage({ type: 'sessionsList', sessions, currentId, workspaceInfo });
              if (currentId === message.conversationId) {
                wv.postMessage({ type: 'updateTitle', title: message.title });
              }
            });
          }
          break;
        }

        case 'deleteSession': {
          if (message.conversationId) {
            const convId = message.conversationId;
            const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
            const convDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations');
            const brainPath = path.join(brainDir, convId);
            const dbPath = path.join(convDir, `${convId}.db`);

            const trashCmd = process.platform === 'win32' ? 'Remove-ItemSafely' : 'trash-put';
            if (fs.existsSync(brainPath)) {
              cp.exec(`${trashCmd} "${brainPath}"`, (err) => {
                if (err) this.debugChannel?.appendLine(`[deleteSession] Failed to trash brain dir: ${err.message}`);
              });
            }
            if (fs.existsSync(dbPath)) {
              cp.exec(`${trashCmd} "${dbPath}"`, (err) => {
                if (err) this.debugChannel?.appendLine(`[deleteSession] Failed to trash db: ${err.message}`);
              });
            }
            for (const ext of ['-shm', '-wal']) {
              const walPath = path.join(convDir, `${convId}.db${ext}`);
              if (fs.existsSync(walPath)) {
                cp.exec(`${trashCmd} "${walPath}"`);
              }
            }

            if (this.processManager.getConversationId() === convId) {
              this.processManager.setConversationId(null);
            }

            setTimeout(() => {
              const sessions = this.getSessionsList();
              const currentId = this.processManager.getConversationId();
              const activeWorkspacePath = this.resolveWorkingDirectory();
              const workspaceInfo = {
                name: path.basename(activeWorkspacePath),
                path: activeWorkspacePath,
              };
              this.getWebviews().forEach((wv) => {
                wv.postMessage({ type: 'sessionsList', sessions, currentId, workspaceInfo });
              });
            }, 500);
          }
          break;
        }

        case 'allowCommandForSession': {
          const cmd = message.targetCommand;
          if (cmd) {
            const cleanCmd = cmd.trim();
            this.sessionAllowedCommands.add(cleanCmd.toLowerCase());
            const continuationPrompt = `Permission granted for '${cleanCmd}'. Please proceed with the command and continue.`;
            this.executePrompt(continuationPrompt, [], true);
          }
          break;
        }

        case 'getActiveFile':
          this.sendActiveFileContext();
          break;

        case 'openFile':
          this.handleOpenFile(message.filePath);
          break;

        case 'getSlashCommands':
          this.sendSlashCommands(webview);
          break;

        case 'slashCommand':
          this.handleSlashCommand(message.name, message.arg, webview);
          break;

        case 'searchFiles':
          this.handleSearchFiles(message.query, webview);
          break;

        case 'copyToClipboard':
          if (message.text) {
            vscode.env.clipboard.writeText(message.text);
          }
          break;

        case 'openDiffView':
          if (message.targetFile) {
            this.diffController.showDiffFromToolCall(message.targetFile, message.toolName, message.toolArgs);
          }
          break;

        case 'openPlanFile': {
          const filePath = message.filePath;
          if (filePath && fs.existsSync(filePath)) {
            vscode.workspace.openTextDocument(vscode.Uri.file(filePath)).then(doc =>
              vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true })
            );
          }
          break;
        }
      }
    });
  }

  private static readonly TEXT_EXTENSIONS = new Set([
    '.md', '.txt', '.csv', '.json', '.r', '.rmd', '.qmd', '.py', '.js', '.ts',
    '.jsx', '.tsx', '.html', '.css', '.scss', '.yaml', '.yml', '.toml', '.xml',
    '.sql', '.sh', '.bash', '.zsh', '.nix', '.lua', '.rb', '.go', '.rs', '.c',
    '.cpp', '.h', '.hpp', '.java', '.kt', '.swift', '.env', '.ini', '.cfg', '.conf',
    '.log', '.tex', '.bib', '.dockerfile',
  ]);

  private async handleSelectFile(webview: vscode.Webview) {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach File',
      filters: {
        'All Supported': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
          'md', 'txt', 'csv', 'json', 'r', 'rmd', 'qmd', 'py', 'js', 'ts',
          'jsx', 'tsx', 'html', 'css', 'scss', 'yaml', 'yml', 'toml', 'xml',
          'sql', 'sh', 'bash', 'nix', 'lua', 'rb', 'go', 'rs', 'c', 'cpp',
          'h', 'hpp', 'java', 'kt', 'swift', 'ini', 'cfg', 'conf', 'log', 'tex'],
        'Images': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
        'Text': ['md', 'txt', 'csv', 'json', 'r', 'py', 'js', 'ts', 'html', 'css', 'yaml', 'yml', 'toml', 'sql', 'sh', 'nix'],
      },
    });
    if (!uris || uris.length === 0) return;

    const imagePaths: string[] = [];
    const textAttachments: Array<{ name: string; content: string }> = [];

    for (const uri of uris) {
      const ext = path.extname(uri.fsPath).toLowerCase();
      if (ChatWebviewProvider.TEXT_EXTENSIONS.has(ext)) {
        try {
          const content = fs.readFileSync(uri.fsPath, 'utf-8');
          const name = path.basename(uri.fsPath);
          textAttachments.push({ name, content });
        } catch (err: any) {
          this.debugChannel?.appendLine(`[attach] Failed to read text file: ${err.message}`);
        }
      } else {
        imagePaths.push(uri.fsPath);
      }
    }

    if (imagePaths.length > 0) {
      webview.postMessage({ type: 'imagesAttached', paths: imagePaths });
    }
    if (textAttachments.length > 0) {
      webview.postMessage({ type: 'textFilesAttached', files: textAttachments });
    }
  }

  private handleSavePastedImage(dataUrl: string, webview: vscode.Webview) {
    try {
      const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9\+\-]+);base64,(.+)$/);
      if (!matches) return;
      let ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      if (ext === 'svg+xml') ext = 'svg';
      const buffer = Buffer.from(matches[2], 'base64');
      
      const saveDir = path.join(os.tmpdir(), 'antigravity-pastes');
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }

      const filePath = toForwardSlash(path.join(saveDir, `agy_paste_${Date.now()}.${ext}`));
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

      if (fs.existsSync(fileUri.fsPath) && fs.statSync(fileUri.fsPath).isDirectory()) {
        vscode.commands.executeCommand('revealInExplorer', fileUri);
        return;
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

  private handlePermissionResponse(choice: string) {
    if (choice === 'session' || choice === 'allow_session') {
      this.sessionSkipPermissions = true;
      const continuationPrompt = "Permission granted for this session. Please proceed with the previous task.";
      this.executePrompt(continuationPrompt, [], true);
    } else if (choice === 'yes') {
      const continuationPrompt = "Permission granted for the requested command. Please proceed with the task.";
      this.executePrompt(continuationPrompt, [], false);
    } else if (choice === 'no' || choice === 'deny' || choice === 'cancel') {
      this.processManager.cancelCurrentTask();
      this.getWebviews().forEach((wv) => wv.postMessage({ type: 'cancelled' }));
    } else if (choice === 'settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'antigravity.dangerouslySkipPermissions');
    }
  }

  private buildPromptWithIdeContext(userPrompt: string, isFirstTurn: boolean, cwd: string, images?: string[], textFiles?: Array<{ name: string; content: string }>): string {
    const parts: string[] = [];

    if (isFirstTurn) {
      const geminiMdPath = path.join(cwd, '.gemini', 'GEMINI.md');
      const agentsMdPath = path.join(cwd, '.gemini', 'AGENTS.md');
      try {
        if (fs.existsSync(geminiMdPath)) {
          const content = fs.readFileSync(geminiMdPath, 'utf-8').trim();
          if (content) {
            parts.push(`[WORKSPACE CONFIG from .gemini/GEMINI.md]\n${content}\n[END WORKSPACE CONFIG]`);
          }
        }
      } catch { /* missing or unreadable, skip */ }
      try {
        if (fs.existsSync(agentsMdPath)) {
          const content = fs.readFileSync(agentsMdPath, 'utf-8').trim();
          if (content) {
            parts.push(`[WORKSPACE AGENTS from .gemini/AGENTS.md]\n${content}\n[END WORKSPACE AGENTS]`);
          }
        }
      } catch { /* missing or unreadable, skip */ }
    }

    if (process.platform === 'win32') {
      parts.push(`[SYSTEM ENVIRONMENT NOTE: Host environment is Windows. Terminal container sandboxing on Windows root paths can encounter ACL mount limits. Always set "BypassSandbox": true when invoking the "run_command" tool.]`);
    }

    if (images && images.length > 0) {
      const imageList = images.map((img) => `- ${normalizePath(img)}`).join('\n');
      parts.push(
        `[ATTACHED IMAGES]\nThe user attached the following image file(s):\n${imageList}\n\nIMPORTANT: You MUST call your \`view_file\` tool on the attached image file path(s) to inspect and view the image content before responding.`
      );
    }

    if (textFiles && textFiles.length > 0) {
      for (const file of textFiles) {
        parts.push(`[Attached file: ${file.name}]\n${file.content}`);
      }
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

  public handleSlashCommand(name: string, arg?: string, targetWebview?: vscode.Webview) {
    if (name === 'new') {
      this.sessionSkipPermissions = false;
      this.sessionAllowedCommands.clear();
      this.processManager.newSession();
      if (this.context) {
        this.context.workspaceState.update('activeConversationId', undefined);
      }
      return;
    }

    if (name === 'clear') {
      this.sessionSkipPermissions = false;
      this.sessionAllowedCommands.clear();
      this.processManager.newSession();
      return;
    }

    if (name === 'effort') {
      const level = (arg || '').toLowerCase().trim();
      let msg: string;
      if (level === 'low' || level === 'medium' || level === 'high') {
        this.effortLevel = level;
        msg = `Reasoning effort set to **${level}**.`;
      } else {
        msg = `Usage: \`/effort low|medium|high\` (current: **${this.effortLevel}**)`;
      }
      const postMsg = (wv: vscode.Webview) => wv.postMessage({
        type: 'slashResult',
        name: 'effort',
        message: msg,
      });
      if (targetWebview) {
        postMsg(targetWebview);
      } else {
        this.getWebviews().forEach(postMsg);
      }
      return;
    }

    if (name === 'sandbox') {
      const config = vscode.workspace.getConfiguration('antigravity');
      const currentBypass = config.get<boolean>('bypassSandbox') === true;
      let nextBypass = !currentBypass;
      if (arg === 'on') nextBypass = false;
      if (arg === 'off') nextBypass = true;
      config.update('bypassSandbox', nextBypass, vscode.ConfigurationTarget.Global);
      return;
    }

    if (name === 'dangerous') {
      const config = vscode.workspace.getConfiguration('antigravity');
      const currentDsp = config.get<boolean>('dangerouslySkipPermissions') === true;
      let nextDsp = !currentDsp;
      if (arg === 'on') nextDsp = true;
      if (arg === 'off') nextDsp = false;
      config.update('dangerouslySkipPermissions', nextDsp, vscode.ConfigurationTarget.Global);
      return;
    }

    if (name === 'settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'antigravity');
      return;
    }

    if (name === 'help') {
      const helpMessage = [
        '### Antigravity Slash Commands & Help',
        '',
        '| Command | Description |',
        '| :--- | :--- |',
        '| `/effort <low\\|medium\\|high>` | Set reasoning effort level |',
        '| `/sandbox <on\\|off>` | Toggle container sandboxing (`sandbox on` / `sandbox off`) |',
        '| `/dangerous <on\\|off>` | Toggle permission auto-approvals (`auto accept` / `default`) |',
        '| `/plan [description]` | Start Plan Mode and generate implementation plan |',
        '| `/usage` | Display session token usage statistics overlay |',
        '| `/new` | Start a fresh conversation session |',
        '| `/clear` | Clear chat history |',
        '| `/settings` | Open extension settings pane |',
        '| `/help` | Display this command help card |',
        '| `/<skill-name>` | Execute local agent skill |',
        '',
        '**Keyboard Shortcuts:**',
        '- `Shift+Tab`: Cycle execution modes (`Default` -> `plan` -> `auto accept` -> `Default`)',
      ].join('\n');

      const postMsg = (wv: vscode.Webview) => wv.postMessage({
        type: 'slashResult',
        name: 'help',
        message: helpMessage,
      });

      if (targetWebview) {
        postMsg(targetWebview);
      } else {
        this.getWebviews().forEach(postMsg);
      }
      return;
    }

    if (name === 'plan') {
      const title = arg ? arg.trim() : 'Feature Plan';

      const planPrompt = `[PLAN MODE] Analyze the following feature request: "${title}". First, inspect the workspace and ask any clarification questions using ask_question if needed before finalizing. Then write an implementation plan as a markdown file with a "# " title header and markdown checkboxes formatted as '- [ ] task description'. Include all necessary steps for the task regardless of count (whether 2 or 15+ steps); do not artificially limit or pad step count.`;
      this.onUserPrompt(planPrompt, []);
      return;
    }

    let promptText = '';
    if (name === 'skill') {
      promptText = arg ? `Use the ${arg} skill.` : 'Use a skill.';
    } else {
      promptText = arg ? `Use the ${name} skill. ${arg}` : `Use the ${name} skill.`;
    }
    this.onUserPrompt(promptText, []);
  }

  private onUserPrompt(promptText: string, images?: string[], dangerouslySkipPermissions?: boolean, textFiles?: Array<{ name: string; content: string }>) {
    if (this.processManager.isBusy()) {
      this.isSteeringPivot = true;
      this.processManager.cancelCurrentTask();

      const webviews = this.getWebviews();
      webviews.forEach((wv) => wv.postMessage({ type: 'steeringPivot', text: promptText }));

      setTimeout(() => {
        const steeringPrompt = `[MID-TURN STEERING NOTE]\nThe user has provided live guidance mid-turn. Please integrate the following note into your ongoing work immediately:\n${promptText}`;
        this.executePrompt(steeringPrompt, images, dangerouslySkipPermissions, textFiles);
        this.isSteeringPivot = false;
      }, 180);
      return;
    }

    this.lastUserPrompt = { promptText, images };

    const planHintRe = /\b(?:mak(?:e|ing)|creat(?:e|ing)|writ(?:e|ing)|draft(?:ing)?|build(?:ing)?)\s+(?:a\s+|an\s+|the\s+)?(?:implementation\s+)?plan\b/i;
    if (!promptText.startsWith('[PLAN MODE]') && planHintRe.test(promptText)) {
      this.pendingPlanPrompt = { promptText, images, dangerouslySkipPermissions, planHintRe };
      this.getWebviews().forEach((wv) => wv.postMessage({ type: 'planConfirm' }));
      return;
    }

    this.dispatchPrompt(promptText, images, dangerouslySkipPermissions, textFiles);
  }

  private dispatchPrompt(promptText: string, images?: string[], dangerouslySkipPermissions?: boolean, textFiles?: Array<{ name: string; content: string }>) {
    const config = vscode.workspace.getConfiguration('antigravity');
    const settingSkip = config.get<boolean>('dangerouslySkipPermissions') === true;
    const effectiveSkip = dangerouslySkipPermissions !== undefined
      ? dangerouslySkipPermissions
      : (settingSkip || this.sessionSkipPermissions);

    this.executePrompt(promptText, images, effectiveSkip, textFiles);
  }

  private executePrompt(promptText: string, images?: string[], dangerouslySkipPermissions?: boolean, textFiles?: Array<{ name: string; content: string }>) {
    const config = vscode.workspace.getConfiguration('antigravity');
    const cliPath = config.get<string>('cliPath') || 'agy';
    const cwd = this.resolveWorkingDirectory();
    const settingSkip = config.get<boolean>('dangerouslySkipPermissions') === true;
    const skipPermissions = dangerouslySkipPermissions !== undefined
      ? dangerouslySkipPermissions
      : (settingSkip || this.sessionSkipPermissions);
    const isFirstTurn = !this.processManager.getConversationId();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const extraWorkspaceDirs: string[] = [];
    if (workspaceFolders && workspaceFolders.length > 1) {
      for (let i = 1; i < workspaceFolders.length; i++) {
        extraWorkspaceDirs.push(workspaceFolders[i].uri.fsPath);
      }
    }

    const currentConvId = this.processManager.getConversationId();
    if (currentConvId) {
      this.saveSessionWorkspace(currentConvId, cwd);
    }

    const normalizedImages = images?.map((img) => toForwardSlash(img));
    const finalPrompt = this.buildPromptWithIdeContext(promptText, isFirstTurn, cwd, normalizedImages, textFiles);

    const bypassSandbox = config.get<boolean>('bypassSandbox') === true;

    this.processManager.runPrompt(cliPath, cwd, finalPrompt, {
      dangerouslySkipPermissions: skipPermissions,
      sandbox: !bypassSandbox,
      images: normalizedImages,
      extraWorkspaceDirs,
      effort: this.effortLevel,
    });
  }

  private resolveWorkingDirectory(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let cwd = process.cwd();

    if (workspaceFolders && workspaceFolders.length > 0) {
      cwd = workspaceFolders[0].uri.fsPath;
    }

    if (process.platform === 'linux' && cwd.match(/^[a-zA-Z]:/)) {
      const drive = cwd[0].toLowerCase();
      cwd = `/mnt/${drive}/${toForwardSlash(cwd.slice(3))}`;
    }

    return cwd;
  }

  private handleAgyEvent(event: AgyStreamEvent) {
    if (this.isSteeringPivot && (event.event === 'result' || event.event === 'error')) {
      return;
    }

    const currentId = this.processManager.getConversationId();
    if (currentId) {
      if (this.context) {
        this.context.workspaceState.update('activeConversationId', currentId);
      }
      this.saveSessionWorkspace(currentId, this.resolveWorkingDirectory());
    }

    processAgyStreamEvent(event, {
      getWebviews: () => this.getWebviews(),
      resolveWorkingDirectory: () => this.resolveWorkingDirectory(),
      fileSnapshots: this.fileSnapshots,
      debugChannel: this.debugChannel,
      getConversationId: () => this.processManager.getConversationId(),
      detectPlanFromToolCall: (step, toolName) => this.detectPlanFromToolCall(step, toolName),
      ensureDebugChannel: () => {
        if (!this.debugChannel) {
          this.debugChannel = vscode.window.createOutputChannel('Antigravity Debug', { log: true });
        }
        return this.debugChannel;
      },
    });
  }

  public sendActiveFileContext() {
    const editor = vscode.window.activeTextEditor;
    const visibleEditors = vscode.window.visibleTextEditors;
    let filePath: string | null = null;

    if (
      editor &&
      visibleEditors.length > 0 &&
      visibleEditors.some((e) => e.document === editor.document) &&
      editor.document &&
      editor.document.uri.scheme === 'file'
    ) {
      const fsPath = editor.document.uri.fsPath;
      if (fs.existsSync(fsPath)) {
        filePath = vscode.workspace.asRelativePath(editor.document.uri);
      }
    }
    this.getWebviews().forEach((wv) =>
      wv.postMessage({
        type: 'activeFile',
        filePath: filePath,
      })
    );
  }

  private activePlanFilePath: string | null = null;
  private pendingPlanPrompt: { promptText: string; images?: string[]; dangerouslySkipPermissions?: boolean; planHintRe: RegExp } | null = null;
  private debugChannel: vscode.OutputChannel | null = null;
  private fileSnapshots: Map<string, string> = new Map();

  private sendResourceMappings(webview: vscode.Webview) {
    const mappings: Array<{ prefix: string; base: string }> = [];
    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders) {
      for (const f of wsFolders) {
        mappings.push({
          prefix: f.uri.fsPath,
          base: webview.asWebviewUri(f.uri).toString(),
        });
      }
    }
    const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
    if (fs.existsSync(brainDir)) {
      mappings.push({
        prefix: brainDir,
        base: webview.asWebviewUri(vscode.Uri.file(brainDir)).toString(),
      });
    }
    const tmpDir = os.tmpdir();
    mappings.push({
      prefix: tmpDir,
      base: webview.asWebviewUri(vscode.Uri.file(tmpDir)).toString(),
    });
    webview.postMessage({ type: 'resourceMappings', mappings });
  }

  private getResourceRoots(): vscode.Uri[] {
    const roots: vscode.Uri[] = [this.extensionUri, vscode.Uri.file(os.tmpdir())];
    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders) {
      roots.push(...wsFolders.map(f => f.uri));
    }
    const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
    if (fs.existsSync(brainDir)) {
      roots.push(vscode.Uri.file(brainDir));
    }
    return roots;
  }

  private parsePlanFromContent(filePath: string, content: string): { title: string; steps: Array<{ id: string; text: string; completed: boolean }> } | null {
    const lines = content.split('\n');
    const steps: Array<{ id: string; text: string; completed: boolean }> = [];

    lines.forEach((line, idx) => {
      const match = line.match(/^- \[(x|X| )\]\s*(.+)$/);
      if (match) {
        steps.push({
          id: `step-${idx + 1}`,
          text: match[2].trim(),
          completed: match[1].toLowerCase() === 'x',
        });
      }
    });

    if (steps.length === 0) return null;

    let title = path.basename(filePath, '.md');
    const titleMatch = content.match(/^#\s+(?:(?:Implementation|Feature)\s+Plan[:\s]*)?(.+)$/m);
    if (titleMatch) title = titleMatch[1].trim();

    return { title, steps };
  }

  private detectPlanFromToolCall(step: any, toolName: string) {
    try {
      const toolArgs = step.tool_info?.parameters || step.tool_args || step.args || step.input || step.parameters || {};
      const parsed = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs;
      const targetFile = parsed?.TargetFile || parsed?.targetFile || parsed?.target_file ||
                         parsed?.AbsolutePath || parsed?.absolutePath || parsed?.path || parsed?.file ||
                         parsed?.FilePath || parsed?.filePath;

      if (!targetFile || !targetFile.endsWith('.md')) return;
      const baseName = path.basename(targetFile).toLowerCase();
      if (!baseName.includes('plan')) return;

      setTimeout(() => {
        try {
          const resolvedPath = path.isAbsolute(targetFile) ? targetFile : path.resolve(this.resolveWorkingDirectory(), targetFile);
          if (!fs.existsSync(resolvedPath)) return;

          const content = fs.readFileSync(resolvedPath, 'utf-8');
          const plan = this.parsePlanFromContent(resolvedPath, content);
          if (!plan) return;

          this.activePlanFilePath = resolvedPath;
          const planData = {
            filePath: resolvedPath,
            timestamp: new Date().toISOString(),
            title: plan.title,
            steps: plan.steps,
          };
          this.getWebviews().forEach((wv) =>
            wv.postMessage({ type: 'planCreated', plan: planData })
          );
        } catch (err) {
          console.error('Failed to detect plan from tool call:', err);
        }
      }, 200);
    } catch {
      // ignore parse errors
    }
  }

  private setupPlanFileWatcher() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*plan*.md');

    const handlePlanFileChange = (uri: vscode.Uri) => {
      try {
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath)) return;

        if (!this.activePlanFilePath || normalizePath(filePath) !== normalizePath(this.activePlanFilePath)) {
          return;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const plan = this.parsePlanFromContent(filePath, content);
        if (!plan) return;

        const planData = {
          filePath,
          timestamp: new Date().toISOString(),
          title: plan.title,
          steps: plan.steps,
        };
        this.getWebviews().forEach((wv) =>
          wv.postMessage({ type: 'planCreated', plan: planData })
        );
      } catch (err) {
        console.error('Failed to parse plan file change:', err);
      }
    };

    watcher.onDidChange(handlePlanFileChange);
  }

  private async handleSearchFiles(query: string, webview: vscode.Webview) {
    try {
      const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.antigravity/**}';
      const uris = await vscode.workspace.findFiles('**/*', excludePattern, 300);
      let files = uris.map((u) => vscode.workspace.asRelativePath(u));

      const q = (query || '').trim().toLowerCase();
      if (q) {
        files = files.filter((f) => f.toLowerCase().includes(q));
      }

      files.sort((a, b) => {
        if (!q) return a.localeCompare(b);
        const aBase = path.basename(a).toLowerCase();
        const bBase = path.basename(b).toLowerCase();
        const aStarts = aBase.startsWith(q);
        const bStarts = bBase.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      });

      webview.postMessage({ type: 'fileSearchResults', query, files: files.slice(0, 50) });
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

  private getSessionTitle(convId: string, convDir: string): string {
    const customTitlePath = path.join(convDir, 'title.txt');
    if (fs.existsSync(customTitlePath)) {
      try {
        const customTitle = fs.readFileSync(customTitlePath, 'utf-8').trim();
        if (customTitle) return customTitle;
      } catch {}
    }

    let title = `Session ${convId.substring(0, 8)}`;
    const logPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
    const altLogPath = path.join(convDir, 'transcript.jsonl');
    const targetLog = fs.existsSync(logPath) ? logPath : (fs.existsSync(altLogPath) ? altLogPath : null);

    if (targetLog) {
      try {
        const content = fs.readFileSync(targetLog, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = JSON.parse(line);
          if (parsed.type === 'USER_INPUT' && parsed.content) {
            const reqMatch = parsed.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
            const rawText = reqMatch ? reqMatch[1].trim() : parsed.content.trim();
            const cleanLines = rawText.split('\n').filter((l: string) => {
              const t = l.trim();
              return !t.startsWith('[SYSTEM ENVIRONMENT NOTE') &&
                     !t.startsWith('[ATTACHED IMAGES]') &&
                     !t.startsWith('IMPORTANT:') &&
                     !t.startsWith('The user attached');
            });
            const firstLine = cleanLines.join(' ').trim();
            if (firstLine) {
              title = firstLine.length > 45 ? firstLine.substring(0, 42) + '...' : firstLine;
              break;
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
    return title;
  }

  private saveSessionTitle(convId: string, title: string): void {
    try {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      const convDir = path.join(brainDir, convId);
      if (fs.existsSync(convDir)) {
        fs.writeFileSync(path.join(convDir, 'title.txt'), title.trim(), 'utf-8');
      }
    } catch (err) {
      console.error('Failed to save session title:', err);
    }
  }

  private loadSessionHistory(convId: string): Array<{ type: string; [key: string]: any }> {
    try {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      const convDir = path.join(brainDir, convId);
      const logPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
      const altLogPath = path.join(convDir, 'transcript.jsonl');
      const targetLog = fs.existsSync(logPath) ? logPath : (fs.existsSync(altLogPath) ? altLogPath : null);

      if (!targetLog) return [];

      const content = fs.readFileSync(targetLog, 'utf-8');
      const lines = content.split('\n');
      const events: Array<{ type: string; [key: string]: any }> = [];
      let lastToolCallRef: any = null;
      let currentTurnUsage: any = null;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const lineUsage = parsed.usage || parsed.tokens;
          if (lineUsage) {
            if (!currentTurnUsage) {
              currentTurnUsage = { ...lineUsage };
            } else {
              if (lineUsage.input_tokens) currentTurnUsage.input_tokens = Math.max(currentTurnUsage.input_tokens || 0, lineUsage.input_tokens);
              if (lineUsage.output_tokens) currentTurnUsage.output_tokens = Math.max(currentTurnUsage.output_tokens || 0, lineUsage.output_tokens);
              if (lineUsage.thinking_tokens) currentTurnUsage.thinking_tokens = Math.max(currentTurnUsage.thinking_tokens || 0, lineUsage.thinking_tokens);
              if (lineUsage.cache_read_tokens) currentTurnUsage.cache_read_tokens = Math.max(currentTurnUsage.cache_read_tokens || 0, lineUsage.cache_read_tokens);
              if (lineUsage.total_tokens) currentTurnUsage.total_tokens = Math.max(currentTurnUsage.total_tokens || 0, lineUsage.total_tokens);
            }
          }

          if (parsed.type === 'USER_INPUT' && parsed.content) {
            currentTurnUsage = null;
            lastToolCallRef = null;
            const reqMatch = parsed.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
            const rawText = reqMatch ? reqMatch[1].trim() : parsed.content.trim();
            const cleanLines = rawText.split('\n').filter((l: string) => {
              const t = l.trim();
              return !t.startsWith('[SYSTEM ENVIRONMENT NOTE') &&
                     !t.startsWith('[ATTACHED IMAGES]') &&
                     !t.startsWith('IMPORTANT:') &&
                     !t.startsWith('The user attached');
            });
            const cleanText = cleanLines.join('\n').trim();
            if (cleanText) {
              events.push({ type: 'userMessage', text: cleanText });
            }
          } else if (parsed.type === 'PLANNER_RESPONSE' || parsed.type === 'MODEL') {
            if (parsed.content) {
              events.push({ type: 'assistantText', text: parsed.content, usage: currentTurnUsage });
            }
            if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
              for (const tc of parsed.tool_calls) {
                const toolEvent = {
                  type: 'toolCall',
                  name: tc.name || tc.function?.name || 'tool',
                  args: tc.args || tc.parameters || tc.function?.arguments,
                  result: tc.result || tc.output,
                  status: tc.error ? 'error' : 'done'
                };
                events.push(toolEvent);
                lastToolCallRef = toolEvent;
              }
            }
          } else {
            const outputText = parsed.content || parsed.result || parsed.output || (parsed.error ? `[Error] ${parsed.error}` : '');
            if (lastToolCallRef && outputText && parsed.type && parsed.type !== 'CHECKPOINT' && parsed.type !== 'CONVERSATION_HISTORY' && parsed.type !== 'SYSTEM_MESSAGE') {
              if (!lastToolCallRef.result) {
                lastToolCallRef.result = outputText;
              }
              if (parsed.exit_code && parsed.exit_code !== 0) {
                lastToolCallRef.status = 'error';
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
      return events;
    } catch (err) {
      console.error('Failed to load session history:', err);
      return [];
    }
  }

  private normalizeWorkspacePath(dirPath: string): string {
    if (!dirPath) return '';
    return normalizePathLower(dirPath);
  }

  private getSessionWorkspace(convId: string, convDir: string): { workspacePath?: string; workspaceName?: string } {
    try {
      const metaPath = path.join(convDir, '.system_generated', 'workspace.json');
      if (fs.existsSync(metaPath)) {
        const content = fs.readFileSync(metaPath, 'utf-8');
        const parsed = JSON.parse(content);
        const wp = parsed.workspacePath;
        const looksValid = wp && wp.length > 3 && (/^[A-Za-z]:/.test(wp) || wp.startsWith('/'));
        if (looksValid) {
          return {
            workspacePath: wp,
            workspaceName: parsed.workspaceName || path.basename(wp),
          };
        }
      }
    } catch {
      // ignore
    }

    try {
      const transcriptPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
      const altLogPath = path.join(convDir, 'transcript.jsonl');
      const targetPath = fs.existsSync(transcriptPath) ? transcriptPath : (fs.existsSync(altLogPath) ? altLogPath : null);
      if (targetPath) {
        const content = fs.readFileSync(targetPath, 'utf-8');

        const matchCwd = content.match(/"Cwd"\s*:\s*"([^"]+)"/);
        if (matchCwd && matchCwd[1]) {
          const cleanCwd = matchCwd[1].replace(/\\\\/g, '/').replace(/\\"/g, '"');
          if (cleanCwd.length > 3 && (cleanCwd.match(/^[A-Za-z]:/) || cleanCwd.startsWith('/'))) {
            this.saveSessionWorkspace(convId, cleanCwd);
            return {
              workspacePath: cleanCwd,
              workspaceName: path.basename(cleanCwd),
            };
          }
        }

        const matchAbsPath = content.match(/(?:\/home\/\w+\/[\w\-\.\/]+|[A-Za-z]:[\\\/][\w\-\.\\\/]+)/);
        if (matchAbsPath && matchAbsPath[0].length > 5) {
          const wPath = matchAbsPath[0].replace(/\\\\/g, '/');
          const wDir = wPath.replace(/\/[^\/]+\.[^\/]+$/, '');
          if (wDir.length > 3) {
            this.saveSessionWorkspace(convId, wDir);
            return {
              workspacePath: wDir,
              workspaceName: path.basename(wDir),
            };
          }
        }
      }
    } catch {
      // ignore
    }

    return {};
  }

  private saveSessionWorkspace(convId: string, workspacePath: string): void {
    if (!convId || !workspacePath || workspacePath.length < 4) return;
    const looksAbsolute = /^[A-Za-z]:/.test(workspacePath) || workspacePath.startsWith('/');
    if (!looksAbsolute) return;
    try {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      const sysDir = path.join(brainDir, convId, '.system_generated');
      if (!fs.existsSync(sysDir)) {
        fs.mkdirSync(sysDir, { recursive: true });
      }
      const metaPath = path.join(sysDir, 'workspace.json');
      const data = {
        workspacePath,
        workspaceName: path.basename(workspacePath),
        updatedAt: Date.now(),
      };
      fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save session workspace metadata:', err);
    }
  }

  private isWorkspaceMatch(sessionPath: string | undefined, currentPath: string): boolean {
    if (!sessionPath || !currentPath) return false;
    const normSession = this.normalizeWorkspacePath(sessionPath);
    const normCurrent = this.normalizeWorkspacePath(currentPath);
    return normSession === normCurrent;
  }

  private getSessionsList(): Array<{
    id: string;
    title: string;
    updatedAt: number;
    relativeTime: string;
    workspacePath?: string;
    workspaceName?: string;
    workspaceMatch: boolean;
  }> {
    try {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      if (!fs.existsSync(brainDir)) return [];

      const activeWorkspacePath = this.resolveWorkingDirectory();
      const entries = fs.readdirSync(brainDir, { withFileTypes: true });
      const sessions: Array<{
        id: string;
        title: string;
        updatedAt: number;
        relativeTime: string;
        workspacePath?: string;
        workspaceName?: string;
        workspaceMatch: boolean;
      }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const convId = entry.name;
        const convDir = path.join(brainDir, convId);
        
        let updatedAt = 0;
        try {
          const stat = fs.statSync(convDir);
          updatedAt = stat.mtimeMs;
        } catch {
          continue;
        }

        const wsInfo = this.getSessionWorkspace(convId, convDir);
        const match = this.isWorkspaceMatch(wsInfo.workspacePath, activeWorkspacePath);

        if (!match) continue;

        const title = this.getSessionTitle(convId, convDir);
        const date = new Date(updatedAt);
        const relativeTime = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        sessions.push({
          id: convId,
          title,
          updatedAt,
          relativeTime,
          workspacePath: wsInfo.workspacePath,
          workspaceName: wsInfo.workspaceName,
          workspaceMatch: true,
        });
      }

      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      return sessions.slice(0, 50);
    } catch (err) {
      console.error('Failed to list sessions:', err);
      return [];
    }
  }
}
