import * as vscode from 'vscode';
import { AgyProcessManager } from './processManager';
import { DiffController } from './diffController';
import { ChatWebviewProvider } from './chatWebviewProvider';

export function activate(context: vscode.ExtensionContext) {
  const processManager = new AgyProcessManager();
  const diffController = new DiffController();

  const webviewProvider = new ChatWebviewProvider(context.extensionUri, processManager, diffController, context);

  // Register Webview View for Sidebar
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, webviewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-vscode.editor.open', () => {
      webviewProvider.createOrShowPanel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-vscode.sidebar.open', () => {
      vscode.commands.executeCommand('workbench.view.extension.antigravity-sidebar-container');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-vscode.newConversation', () => {
      processManager.newSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-vscode.acceptProposedDiff', async () => {
      await diffController.acceptDiff();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-vscode.rejectProposedDiff', async () => {
      await diffController.rejectDiff();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-vscode.focus', () => {
      if (webviewProvider.view) {
        webviewProvider.view.show?.(true);
        webviewProvider.view.webview.postMessage({ type: 'focusInput' });
      } else {
        vscode.commands.executeCommand('antigravityVSCodeSidebar.focus');
      }
    })
  );

  // Track active editor file changes and file lifecycle for @context insertion
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      webviewProvider.sendActiveFileContext();
    }),
    vscode.workspace.onDidCloseTextDocument(() => {
      webviewProvider.sendActiveFileContext();
    }),
    vscode.workspace.onDidDeleteFiles(() => {
      webviewProvider.sendActiveFileContext();
    }),
    vscode.workspace.onDidRenameFiles(() => {
      webviewProvider.sendActiveFileContext();
    })
  );

  // Ensure agy processes are killed when the extension deactivates
  context.subscriptions.push({ dispose: () => processManager.killProcess() });
}

export function deactivate() {}
