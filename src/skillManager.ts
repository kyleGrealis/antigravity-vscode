import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export function loadSkills(workspacePath?: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const visitedNames = new Set<string>();

  const searchDirs: string[] = [];
  if (workspacePath) {
    searchDirs.push(path.join(workspacePath, '.gemini', 'skills'));
  }
  const homeDir = os.homedir();
  searchDirs.push(path.join(homeDir, '.gemini', 'skills'));
  searchDirs.push(path.join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills'));

  for (const parentDir of searchDirs) {
    if (!fs.existsSync(parentDir)) continue;
    try {
      const entries = fs.readdirSync(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = path.join(parentDir, entry.name);
          const skillMdPath = path.join(skillDir, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            const parsed = parseSkillMd(skillMdPath, entry.name);
            if (parsed && !visitedNames.has(parsed.name)) {
              visitedNames.add(parsed.name);
              skills.push(parsed);
            }
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return skills;
}

function parseSkillMd(filePath: string, dirName: string): SkillInfo | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    let name = dirName;
    let description = '';

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const fmText = fmMatch[1];
      const nameMatch = fmText.match(/^name:\s*(.+)$/m);
      const descMatch = fmText.match(/^description:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    if (!description) {
      const lines = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          description = trimmed;
          break;
        }
      }
    }

    return {
      name,
      description: description || `Skill: ${name}`,
      path: filePath,
    };
  } catch {
    return null;
  }
}
