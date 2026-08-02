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
