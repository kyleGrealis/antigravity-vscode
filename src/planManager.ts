import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface PlanStep {
  id: string;
  text: string;
  completed: boolean;
}

export interface PlanData {
  filePath: string;
  timestamp: string;
  title: string;
  steps: PlanStep[];
}

export class PlanManager {
  private activePlanPath: string | null = null;

  public createPlan(workspaceDir: string, conversationId: string, title: string, stepsText: string[]): PlanData {
    const antigravityDir = path.join(workspaceDir, '.antigravity');
    const plansDir = path.join(antigravityDir, 'plans');

    if (!fs.existsSync(plansDir)) {
      fs.mkdirSync(plansDir, { recursive: true });
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const timestampStr = `${dateStr}-${timeStr}`;
    const headerTimeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const fileName = `PLAN-${timestampStr}.md`;
    const planFilePath = path.join(plansDir, fileName);

    const steps: PlanStep[] = stepsText.map((text, idx) => ({
      id: `step-${idx + 1}`,
      text: text.trim(),
      completed: false,
    }));

    let mdContent = `# Feature Implementation Plan: ${title}\n\n`;
    mdContent += `*Created: ${headerTimeStr}*\n`;
    mdContent += `*Session ID: ${conversationId ? conversationId.substring(0, 8) : 'N/A'}*\n\n`;
    mdContent += `---\n\n## Tasks & Checklist\n\n`;

    for (const s of steps) {
      mdContent += `- [ ] ${s.text}\n`;
    }

    fs.writeFileSync(planFilePath, mdContent, 'utf-8');

    this.activePlanPath = planFilePath;
    this.openPlanInEditor(planFilePath);

    return {
      filePath: planFilePath,
      timestamp: headerTimeStr,
      title,
      steps,
    };
  }

  public async openPlanInEditor(filePath: string): Promise<void> {
    try {
      if (!fs.existsSync(filePath)) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: true,
      });
    } catch (err) {
      console.error('Failed to open plan document in editor:', err);
    }
  }

  public updateStepStatus(filePath: string, stepIndex: number, completed: boolean): void {
    try {
      if (!fs.existsSync(filePath)) return;
      let content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      let currentChecklistIdx = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^- \[[ xX]\] /)) {
          if (currentChecklistIdx === stepIndex) {
            lines[i] = lines[i].replace(/^- \[[ xX]\] /, `- [${completed ? 'x' : ' '}] `);
            break;
          }
          currentChecklistIdx++;
        }
      }

      const updated = lines.join('\n');
      fs.writeFileSync(filePath, updated, 'utf-8');
    } catch (err) {
      console.error('Failed to update step status in plan file:', err);
    }
  }
}
