import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface DiffSession {
  originalTmpPath: string;
  proposedTmpPath: string;
  targetPath: string;
  backupContent: string | null;
}

export class DiffController {
  private activeDiffs: Map<string, DiffSession> = new Map();

  public async showDiff(targetFilePath: string, proposedContent: string): Promise<void> {
    const resolvedTargetPath = this.resolvePath(targetFilePath);
    const tmpDir = os.tmpdir();
    const basename = path.basename(resolvedTargetPath);
    const timestamp = Date.now();
    const originalTmpPath = path.join(tmpDir, `orig_${timestamp}_${basename}`);
    const proposedTmpPath = path.join(tmpDir, `prop_${timestamp}_${basename}`);

    let backupContent: string | null = null;
    if (fs.existsSync(resolvedTargetPath)) {
      backupContent = fs.readFileSync(resolvedTargetPath, 'utf-8');
      fs.writeFileSync(originalTmpPath, backupContent, 'utf-8');
    } else {
      fs.writeFileSync(originalTmpPath, '', 'utf-8');
    }

    fs.writeFileSync(proposedTmpPath, proposedContent, 'utf-8');

    this.activeDiffs.set(resolvedTargetPath, {
      originalTmpPath,
      proposedTmpPath,
      targetPath: resolvedTargetPath,
      backupContent,
    });

    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(originalTmpPath),
      vscode.Uri.file(proposedTmpPath),
      `Antigravity Diff: ${basename}`
    );

    await vscode.commands.executeCommand('setContext', 'antigravity-vscode.viewingProposedDiff', true);
  }

  public async showDiffFromToolCall(targetFilePath: string, toolName: string, toolArgs: any): Promise<void> {
    const cleanPath = String(targetFilePath || '').replace(/^["']|["']$/g, '').trim();
    if (!cleanPath) return;

    const normName = (toolName || '').toLowerCase().replace(/[-_]/g, '');
    const resolvedTargetPath = this.resolvePath(cleanPath);

    let args = toolArgs;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch {}
    }

    let originalContent = '';
    if (fs.existsSync(resolvedTargetPath)) {
      originalContent = fs.readFileSync(resolvedTargetPath, 'utf-8');
    }

    let proposedContent = originalContent;

    if (normName.includes('replacefilecontent') && !normName.includes('multi')) {
      const target = args?.TargetContent || args?.targetContent || args?.target_content || '';
      const replacement = args?.ReplacementContent || args?.replacementContent || args?.replacement_content || '';
      if (target && originalContent.includes(target)) {
        proposedContent = originalContent.replace(target, replacement);
      } else if (replacement) {
        proposedContent = replacement;
      }
    } else if (normName.includes('multireplacefilecontent')) {
      const chunks = args?.ReplacementChunks || args?.replacementChunks || args?.chunks || [];
      if (Array.isArray(chunks)) {
        let temp = originalContent;
        for (const chunk of chunks) {
          const t = chunk.TargetContent || chunk.targetContent || chunk.target_content || '';
          const r = chunk.ReplacementContent || chunk.replacementContent || chunk.replacement_content || '';
          if (t && temp.includes(t)) {
            temp = temp.replace(t, r);
          }
        }
        proposedContent = temp;
      }
    } else if (normName.includes('writetofile') || normName.includes('writefile')) {
      proposedContent = args?.CodeContent || args?.codeContent || args?.code || args?.code_content || '';
    }

    if (originalContent === proposedContent && fs.existsSync(resolvedTargetPath)) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedTargetPath));
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      } catch {}
    }

    await this.showDiff(resolvedTargetPath, proposedContent);
  }

  public async acceptDiff(targetFilePath?: string): Promise<void> {
    const key = targetFilePath ? this.resolvePath(targetFilePath) : Array.from(this.activeDiffs.keys()).pop();
    if (!key) return;

    const diffInfo = this.activeDiffs.get(key);
    if (diffInfo) {
      const proposedContent = fs.readFileSync(diffInfo.proposedTmpPath, 'utf-8');
      const dir = path.dirname(diffInfo.targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(diffInfo.targetPath, proposedContent, 'utf-8');
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(diffInfo.targetPath));
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch {
        // ignore open document error if editor is unavailable
      }
      this.cleanup(key);
    }
  }

  public async rejectDiff(targetFilePath?: string): Promise<void> {
    const key = targetFilePath ? this.resolvePath(targetFilePath) : Array.from(this.activeDiffs.keys()).pop();
    if (!key) return;

    const diffInfo = this.activeDiffs.get(key);
    if (diffInfo) {
      if (diffInfo.backupContent !== null) {
        fs.writeFileSync(diffInfo.targetPath, diffInfo.backupContent, 'utf-8');
      } else if (fs.existsSync(diffInfo.targetPath)) {
        try {
          fs.unlinkSync(diffInfo.targetPath);
        } catch {
          // ignore unlink error
        }
      }
      this.cleanup(key);
    }
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
      return path.resolve(workspaceFolder, filePath);
    }
    return path.resolve(filePath);
  }

  private cleanup(key: string): void {
    const diffInfo = this.activeDiffs.get(key);
    if (diffInfo) {
      try {
        if (fs.existsSync(diffInfo.originalTmpPath)) fs.unlinkSync(diffInfo.originalTmpPath);
        if (fs.existsSync(diffInfo.proposedTmpPath)) fs.unlinkSync(diffInfo.proposedTmpPath);
      } catch {
        // ignore cleanup errors
      }
      this.activeDiffs.delete(key);
    }

    if (this.activeDiffs.size === 0) {
      vscode.commands.executeCommand('setContext', 'antigravity-vscode.viewingProposedDiff', false);
    }
  }
}
