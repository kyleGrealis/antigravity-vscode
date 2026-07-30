import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgyProcessManager } from './processManager';
import { DiffController } from './diffController';
import { AgyStreamEvent } from './types';
import { loadSkills } from './skillManager';
import { PlanManager } from './planManager';

function formatPermissionError(res: any): any {
  if (typeof res !== 'string') return res;
  if (res.includes('Encountered error in step execution: user denied permission') || res.includes('User denied permission to run command:')) {
    const match = res.match(/User denied permission to run command:\s*(.+)$/im);
    const cmd = match ? match[1].trim() : '';
    if (cmd) {
      return `[Permission Required] Command '${cmd}' was blocked. Execute this command directly in your terminal, or enable 'antigravity.dangerouslySkipPermissions' in settings if desired.`;
    }
    return `[Permission Required] Tool execution was blocked by safety policy. Execute directly in your terminal if needed.`;
  }
  return res;
}

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
  public view?: vscode.WebviewView;
  private currentPanel?: vscode.WebviewPanel;
  private sessionSkipPermissions: boolean = false;
  private sessionAllowedCommands: Set<string> = new Set();
  private lastUserPrompt: { promptText: string; images?: string[] } | null = null;
  private pendingPrompt: { promptText: string; images?: string[] } | null = null;
  private readonly planManager: PlanManager = new PlanManager();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly processManager: AgyProcessManager,
    private readonly diffController: DiffController,
    private readonly context?: vscode.ExtensionContext
  ) {
    let restoredId = this.context?.workspaceState.get<string>('activeConversationId');
    if (!restoredId) {
      const sessions = this.getSessionsList();
      if (sessions.length > 0) {
        restoredId = sessions[0].id;
        this.context?.workspaceState.update('activeConversationId', restoredId);
      }
    }
    if (restoredId && !this.processManager.getConversationId()) {
      this.processManager.setConversationId(restoredId);
    }

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
      localResourceRoots: [this.extensionUri, vscode.Uri.file(os.tmpdir())],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    this.setupWebviewMessageListeners(webviewView.webview);
    this.sendSlashCommands(webviewView.webview);
    this.sendConfigUpdate(webviewView.webview);
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
    this.sendSlashCommands(panel.webview);

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
      { name: 'goal', description: 'run a long-running task with extra thoroughness' },
      { name: 'schedule', description: 'set a timer or recurring cron schedule' },
      { name: 'grill-me', description: 'interactive interview to resolve design decisions' },
      { name: 'teamwork-preview', description: 'orchestrate autonomous subagent team' },
      { name: 'learn', description: 'save workflow/lessons to skills/knowledge-base' },
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
          this.onUserPrompt(message.promptText || message.text, message.images, message.dangerouslySkipPermissions);
          break;

        case 'selectImage':
          this.handleSelectImage(webview);
          break;

        case 'savePastedImage':
          this.handleSavePastedImage(message.dataUrl, webview);
          break;

        case 'cancel':
          this.pendingPrompt = null;
          this.processManager.cancelCurrentTask();
          this.getWebviews().forEach((wv) => wv.postMessage({ type: 'cancelled' }));
          break;

        case 'permissionResponse':
          this.handlePermissionResponse(message.choice);
          break;

        case 'ready':
          this.sendSlashCommands(webview);
          this.sendConfigUpdate(webview);
          break;

        case 'newConversation':
          this.sessionSkipPermissions = false;
          this.sessionAllowedCommands.clear();
          this.processManager.newSession();
          if (this.context) {
            this.context.workspaceState.update('activeConversationId', undefined);
          }
          webview.postMessage({ type: 'sessionLoaded', conversationId: null, title: 'Untitled', events: [] });
          break;

        case 'getSessions': {
          let currentId = this.processManager.getConversationId();
          if (!currentId) {
            currentId = this.context?.workspaceState.get<string>('activeConversationId') || null;
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
            }
          }
          const sessions = this.getSessionsList();
          webview.postMessage({ type: 'sessionsList', sessions, currentId });
          if (currentId) {
            const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
            const convDir = path.join(brainDir, currentId);
            const title = this.getSessionTitle(currentId, convDir);
            const events = this.loadSessionHistory(currentId);
            webview.postMessage({
              type: 'sessionLoaded',
              conversationId: currentId,
              title,
              events
            });
          }
          break;
        }

        case 'selectSession': {
          this.sessionSkipPermissions = false;
          this.sessionAllowedCommands.clear();
          this.processManager.setConversationId(message.conversationId);
          if (this.context) {
            this.context.workspaceState.update('activeConversationId', message.conversationId);
          }
          const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
          const convDir = path.join(brainDir, message.conversationId);
          const title = this.getSessionTitle(message.conversationId, convDir);
          const events = this.loadSessionHistory(message.conversationId);

          webview.postMessage({
            type: 'sessionLoaded',
            conversationId: message.conversationId,
            title,
            events
          });
          break;
        }

        case 'renameSession': {
          if (message.conversationId && message.title) {
            this.saveSessionTitle(message.conversationId, message.title);
            const sessions = this.getSessionsList();
            const currentId = this.processManager.getConversationId();
            this.getWebviews().forEach((wv) => {
              wv.postMessage({ type: 'sessionsList', sessions, currentId });
              if (currentId === message.conversationId) {
                wv.postMessage({ type: 'updateTitle', title: message.title });
              }
            });
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

        case 'openPlanFile':
          if (message.filePath) {
            this.planManager.openPlanInEditor(message.filePath);
          } else {
            const cwd = this.resolveWorkingDirectory();
            const planPath = path.join(cwd, '.antigravity', 'plan.md');
            this.planManager.openPlanInEditor(planPath);
          }
          break;

        case 'createPlan': {
          const cwd = this.resolveWorkingDirectory();
          const convId = this.processManager.getConversationId() || '';
          const planData = this.planManager.createPlan(cwd, convId, message.title || 'Feature Plan', message.steps || []);
          this.getWebviews().forEach(wv => wv.postMessage({ type: 'planCreated', plan: planData }));
          break;
        }

        case 'togglePlanStep': {
          if (message.filePath && message.stepIndex !== undefined) {
            this.planManager.updateStepStatus(message.filePath, message.stepIndex, message.completed);
          }
          break;
        }
      }
    });
  }

  private async handleSelectImage(webview: vscode.Webview) {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach Image',
      filters: { 'Images': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
    });
    if (uris && uris.length > 0) {
      const filePaths = uris.map((u) => u.fsPath);
      webview.postMessage({ type: 'imagesAttached', paths: filePaths });
    }
  }

  private handleSavePastedImage(dataUrl: string, webview: vscode.Webview) {
    try {
      const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9\+\-]+);base64,(.+)$/);
      if (!matches) return;
      let ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      if (ext === 'svg+xml') ext = 'svg';
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

  private buildPromptWithIdeContext(userPrompt: string, isFirstTurn: boolean, cwd: string, images?: string[]): string {
    const parts: string[] = [];

    if (process.platform === 'win32') {
      parts.push(`[SYSTEM ENVIRONMENT NOTE: Host environment is Windows. Terminal container sandboxing on Windows root paths can encounter ACL mount limits. Always set "BypassSandbox": true when invoking the "run_command" tool.]`);
    }

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
        '| `/sandbox <on\\|off>` | Toggle container sandboxing (`sandbox on` / `sandbox off`) |',
        '| `/dangerous <on\\|off>` | Toggle permission auto-approvals (`auto accept` / `default`) |',
        '| `/plan [description]` | Start Plan Mode and generate implementation plan |',
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
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestampStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const planFilePath = `.antigravity/plans/PLAN-${timestampStr}.md`;

      const planPrompt = `[PLAN MODE] Analyze the following feature request and create a detailed implementation plan: "${title}". First, inspect the workspace and ask any clarification questions using ask_question if needed. Then write the implementation plan to "${planFilePath}" formatted with markdown checkboxes '- [ ] task description'.`;
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

  private onUserPrompt(promptText: string, images?: string[], dangerouslySkipPermissions?: boolean) {
    this.lastUserPrompt = { promptText, images };
    const config = vscode.workspace.getConfiguration('antigravity');
    const settingSkip = config.get<boolean>('dangerouslySkipPermissions') === true;
    const effectiveSkip = dangerouslySkipPermissions !== undefined
      ? dangerouslySkipPermissions
      : (settingSkip || this.sessionSkipPermissions);

    this.executePrompt(promptText, images, effectiveSkip);
  }

  private executePrompt(promptText: string, images?: string[], dangerouslySkipPermissions?: boolean) {
    const config = vscode.workspace.getConfiguration('antigravity');
    const cliPath = config.get<string>('cliPath') || 'agy';
    const cwd = this.resolveWorkingDirectory();
    const settingSkip = config.get<boolean>('dangerouslySkipPermissions') === true;
    const skipPermissions = dangerouslySkipPermissions !== undefined
      ? dangerouslySkipPermissions
      : (settingSkip || this.sessionSkipPermissions);
    const isFirstTurn = !this.processManager.getConversationId();

    const normalizedImages = images?.map((img) => img.replace(/\\/g, '/'));
    const finalPrompt = this.buildPromptWithIdeContext(promptText, isFirstTurn, cwd, normalizedImages);

    this.processManager.runPrompt(cliPath, cwd, finalPrompt, {
      dangerouslySkipPermissions: skipPermissions,
      images: normalizedImages,
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
      cwd = `/mnt/${drive}/${cwd.slice(3).replace(/\\/g, '/')}`;
    }

    return cwd;
  }

  private handleAgyEvent(event: AgyStreamEvent) {
    const currentId = this.processManager.getConversationId();
    if (currentId && this.context) {
      this.context.workspaceState.update('activeConversationId', currentId);
    }

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
          toolResult = formatPermissionError(toolResult);
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
        });
      } else if (isToolCall) {
        let toolName = toolNameRaw || (isKnownToolType ? stepType : '');
        toolName = toolName.toLowerCase().replace(/^(cortex_step_type_|step_type_)/, '');

        let rawArgs = step.tool_args || step.args || step.input || step.parameters || toolInfo.parameters || toolInfo.args || step.call?.args;
        let toolArgs = cleanToolArgs(rawArgs);

        let rawError = toolInfo.error || step.error;
        let errorMessage = rawError ? (typeof rawError === 'string' ? rawError : rawError.message || JSON.stringify(rawError)) : '';

        let toolResult = toolInfo.output || step.content || step.output || step.result || step.text || (errorMessage ? `[Error] ${errorMessage}` : undefined) || (step.state === 'DONE' ? step.text_delta : undefined);
        toolResult = formatPermissionError(toolResult);

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

  private setupPlanFileWatcher() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/.antigravity/plans/PLAN-*.md');
    const handlePlanFile = (uri: vscode.Uri) => {
      try {
        const filePath = uri.fsPath;
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf-8');
        
        const lines = content.split('\n');
        let title = path.basename(filePath);
        const titleMatch = content.match(/^# (?:Feature Implementation Plan:)?\s*(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim();

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

        if (steps.length > 0) {
          const planData = {
            filePath,
            timestamp: new Date().toISOString(),
            title,
            steps,
          };
          this.planManager.openPlanInEditor(filePath);
          this.getWebviews().forEach((wv) =>
            wv.postMessage({ type: 'planCreated', plan: planData })
          );
        }
      } catch (err) {
        console.error('Failed to parse created plan file:', err);
      }
    };

    watcher.onDidCreate(handlePlanFile);
    watcher.onDidChange(handlePlanFile);
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

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'USER_INPUT' && parsed.content) {
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
              events.push({ type: 'assistantText', text: parsed.content });
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

  private getSessionsList(): Array<{ id: string; title: string; updatedAt: number; relativeTime: string }> {
    try {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      if (!fs.existsSync(brainDir)) return [];

      const entries = fs.readdirSync(brainDir, { withFileTypes: true });
      const sessions: Array<{ id: string; title: string; updatedAt: number; relativeTime: string }> = [];

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

        const title = this.getSessionTitle(convId, convDir);
        const date = new Date(updatedAt);
        const relativeTime = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        sessions.push({
          id: convId,
          title,
          updatedAt,
          relativeTime
        });
      }

      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      return sessions.slice(0, 30);
    } catch (err) {
      console.error('Failed to list sessions:', err);
      return [];
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'antigravity-icon.svg'));

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
			<div class="header-left">
				<img src="${logoUri}" class="header-logo" alt="Antigravity" />
				<span id="header-session-title" class="header-title" title="Double click to rename session">Untitled</span>
				<button id="edit-header-title-btn" class="icon-btn edit-title-btn" title="Rename session">&#9999;&#65039;</button>
			</div>
			<div class="header-actions">
				<button id="history-btn" class="icon-btn" title="Session History">&#128340;</button>
				<button id="new-chat-btn" class="icon-btn" title="New conversation">+</button>
			</div>
		</div>

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
	<script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
