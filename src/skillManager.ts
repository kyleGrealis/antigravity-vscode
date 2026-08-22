import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { toForwardSlash } from './pathUtils';

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
    searchDirs.push(path.join(workspacePath, '.antigravity', 'skills'));
  }
  const homeDir = os.homedir();
  searchDirs.push(path.join(homeDir, '.gemini', 'skills'));
  searchDirs.push(path.join(homeDir, '.gemini', 'antigravity-cli', 'skills'));
  searchDirs.push(path.join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills'));

  // Also discover plugin skills from ~/.gemini/config/plugins/*/skills
  const pluginsDir = path.join(homeDir, '.gemini', 'config', 'plugins');
  if (fs.existsSync(pluginsDir)) {
    try {
      const pluginEntries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      for (const pEntry of pluginEntries) {
        if (pEntry.isDirectory()) {
          const pluginSkillsDir = path.join(pluginsDir, pEntry.name, 'skills');
          if (fs.existsSync(pluginSkillsDir)) {
            searchDirs.push(pluginSkillsDir);
          }
        }
      }
    } catch {}
  }

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
      if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');

      const descBlockMatch = fmText.match(/^description:\s*[>|][-+]?\r?\n((?:[ \t]+[^\r\n]+\r?\n?)+)/m);
      if (descBlockMatch) {
        description = descBlockMatch[1]
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .join(' ');
      } else {
        const descMatch = fmText.match(/^description:\s*(.+)$/m);
        if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }
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
      path: toForwardSlash(filePath),
    };
  } catch {
    return null;
  }
}
