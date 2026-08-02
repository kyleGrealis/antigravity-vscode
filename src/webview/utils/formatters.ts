import { ToolCall } from '../types';
import { cleanValue } from './escape';

export function toPascalCaseName(name: string): string {
  if (!name) return 'Tool';
  const nameMap: Record<string, string> = {
    list_dir: 'ListDir',
    list_directory: 'ListDir',
    view_file: 'ReadFile',
    read_file: 'ReadFile',
    run_command: 'RunCommand',
    grep_search: 'GrepSearch',
    replace_file_content: 'ReplaceFileContent',
    multi_replace_file_content: 'MultiReplaceFileContent',
    write_to_file: 'WriteToFile',
    ask_question: 'AskQuestion',
    ask_permission: 'AskPermission',
    read_url_content: 'ReadUrlContent',
    search_web: 'SearchWeb',
    invoke_subagent: 'InvokeSubagent',
    define_subagent: 'DefineSubagent',
    send_message: 'SendMessage',
    manage_task: 'ManageTask',
    manage_subagents: 'ManageSubagents',
    schedule: 'Schedule',
    generate_image: 'GenerateImage',
    code_action: 'CodeAction',
  };

  const lower = name.toLowerCase();
  if (nameMap[lower]) return nameMap[lower];

  return name
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

export function getArgVal(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return cleanValue(obj[k]);
  }
  const lowerMap: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    lowerMap[k.toLowerCase()] = obj[k];
  }
  for (const k of keys) {
    const lk = k.toLowerCase();
    if (lowerMap[lk] !== undefined && lowerMap[lk] !== null) return cleanValue(lowerMap[lk]);
  }
  return undefined;
}

export function parseJsonArgs(raw: any): any {
  if (!raw) return raw;
  let parsed = raw;
  if (typeof raw === 'string') {
    let str = raw.trim();
    try {
      parsed = JSON.parse(str);
    } catch {
      try {
        const sanitized = str.replace(/"((?:[^"\\]|\\.)*)"/gs, (match, group) => {
          return '"' + group.replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
        });
        parsed = JSON.parse(sanitized);
      } catch {
        parsed = raw;
      }
    }
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.parameters && typeof parsed.parameters === 'object') return parseJsonArgs(parsed.parameters);
    if (parsed.input && typeof parsed.input === 'object') return parseJsonArgs(parsed.input);
    if (parsed.args && typeof parsed.args === 'object') return parseJsonArgs(parsed.args);
    if (parsed.tool_args && typeof parsed.tool_args === 'object') return parseJsonArgs(parsed.tool_args);
  }
  return parsed;
}

export function extractJsonStringField(raw: string, ...keys: string[]): string | undefined {
  if (typeof raw !== 'string') return undefined;
  for (const key of keys) {
    const escKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`"${escKey}"\\s*:\\s*"([\\s\\S]*?)(?:"\\s*[,}]|\\s*"\\s*$|$)`, 'i');
    const m = raw.match(regex);
    if (m && m[1] !== undefined) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
  }
  return undefined;
}

export function formatToolSummary(tc: ToolCall): { text: string; isFile?: boolean } {
  let args = parseJsonArgs(tc.args);
  if (!args) {
    if (typeof tc.args === 'string') {
      const match = tc.args.match(/"(?:TargetFile|AbsolutePath|FilePath|path|file)"\s*:\s*"([^"]+)"/i) ||
                    tc.args.match(/"(?:CommandLine|command|query)"\s*:\s*"([^"]+)"/i);
      if (match && match[1]) {
        return { text: match[1], isFile: true };
      }
      return { text: tc.args.length > 50 ? tc.args.substring(0, 47) + '...' : tc.args };
    }
    return { text: '' };
  }

  if (typeof args === 'string') {
    return { text: args.length > 50 ? args.substring(0, 47) + '...' : args };
  }

  const filePath = getArgVal(args, 'TargetFile', 'targetFile', 'target_file', 'path', 'file', 'AbsolutePath', 'absolutePath', 'FilePath', 'filePath');
  if (filePath && typeof filePath === 'string') {
    return { text: filePath, isFile: true };
  }

  const command = getArgVal(args, 'CommandLine', 'commandLine', 'command_line', 'command', 'cmd');
  if (command && typeof command === 'string') {
    return { text: command.length > 60 ? command.substring(0, 57) + '...' : command };
  }

  const query = getArgVal(args, 'Query', 'query', 'pattern', 'search');
  if (query && typeof query === 'string') {
    return { text: `"${query}"` };
  }

  const keys = Object.keys(args);
  if (keys.length === 1 && typeof args[keys[0]] === 'string') {
    const val = args[keys[0]];
    return { text: val.length > 50 ? val.substring(0, 47) + '...' : val };
  }

  try {
    const str = JSON.stringify(args);
    return { text: str.length > 50 ? str.substring(0, 47) + '...' : str };
  } catch {
    return { text: '' };
  }
}

export function formatToolArgsForDisplay(toolName: string, rawArgs: any): string {
  const parsed = parseJsonArgs(rawArgs);
  if (!parsed) {
    if (typeof rawArgs === 'string') return rawArgs;
    return '';
  }
  if (typeof parsed === 'string') return parsed;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(parsed);
  }
}
