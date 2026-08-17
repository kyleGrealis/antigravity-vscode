import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { AgyStreamEvent } from './types';
import { isInsidePath } from './pathUtils';

export function formatPermissionError(res: any): any {
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

export function cleanToolArgs(rawArgs: any): any {
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
    } catch {}
  }
  if (!parsed || typeof parsed !== 'object') {
    return typeof rawArgs === 'string' && rawArgs.trim() ? rawArgs.trim().replace(/^"|"$/g, '') : undefined;
  }

  const unquote = (val: any): any => {
    if (typeof val === 'string') {
      let s = val.trim();
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
        try {
          const unq = JSON.parse(s);
          if (typeof unq === 'string') return unq;
          if (Array.isArray(unq) || (unq && typeof unq === 'object')) return unquote(unq);
        } catch {
          if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            return s.slice(1, -1);
          }
          return s;
        }
      }
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(unquote);
    }
    if (val && typeof val === 'object') {
      const cleanedObj: Record<string, any> = {};
      for (const k of Object.keys(val)) {
        cleanedObj[k] = unquote(val[k]);
      }
      return cleanedObj;
    }
    return val;
  };

  return unquote(parsed);
}

export interface StreamEventContext {
  getWebviews: () => vscode.Webview[];
  resolveWorkingDirectory: () => string;
  fileSnapshots: Map<string, string>;
  debugChannel: vscode.OutputChannel | null;
  getConversationId: () => string | null;
  detectPlanFromToolCall: (step: any, toolName: string) => void;
  ensureDebugChannel: () => vscode.OutputChannel;
}

export function processAgyStreamEvent(
  event: AgyStreamEvent,
  ctx: StreamEventContext
): void {
  const webviews = ctx.getWebviews();

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

    if (stepType === 'subagent' && step.subagent_info) {
      const subs: any[] = step.subagent_info.subagents || [];
      const saArgs: Record<string, string> = {};
      let saResult = '';
      if (subs.length > 0) {
        saArgs.Name = subs[0].role || '';
        saArgs.Prompt = subs[0].initial_prompt || '';
        saResult = subs.map((s: any) => s.conversation_id || '').join(', ');
      }
      const saStatus = step.state === 'DONE' ? 'done' : step.state === 'ERROR' ? 'error' : 'running';
      const saId = step.step_index !== undefined ? `step_${step.step_index}` : `subagent_${Date.now()}`;
      webviews.forEach((wv) =>
        wv.postMessage({
          type: 'toolCall',
          id: saId,
          name: 'invoke_subagent',
          args: saArgs,
          status: saStatus,
          result: saResult,
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

        let rawArgs = tcItem.args || tcItem.tool_args || tcItem.input || tcItem.parameters || tcItem.function?.arguments || step.tool_args || step.args;
        let toolArgs = cleanToolArgs(rawArgs);

        let rawError = toolInfo.error || step.error || tcItem.error;
        let errorMessage = rawError ? (typeof rawError === 'string' ? rawError : rawError.message || JSON.stringify(rawError)) : '';

        let toolResult = tcItem.result || tcItem.output || tcItem.content || tcItem.diff || toolInfo.output || toolInfo.result || toolInfo.content || toolInfo.text || toolInfo.response || toolInfo.diff || toolInfo.changes || step.content || step.output || step.result || step.text || step.diff || (errorMessage ? `[Error] ${errorMessage}` : undefined);
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
      if ((stepType === 'code_action' || stepType === 'cortex_step_type_code_action') && !toolName) {
        toolName = 'replace_file_content';
      }
      toolName = toolName.toLowerCase().replace(/^(cortex_step_type_|step_type_)/, '');

      let rawArgs = step.tool_args || step.args || step.input || step.parameters || toolInfo.parameters || toolInfo.args || step.call?.args || (step.tool_calls && step.tool_calls[0] ? (step.tool_calls[0].args || step.tool_calls[0].tool_args) : undefined);

      let toolArgs = cleanToolArgs(rawArgs);

      const editToolNames = ['replace_file_content', 'multi_replace_file_content', 'write_to_file', 'write_file', 'create_file', 'code_action'];
      const isEditTool = editToolNames.includes(toolName);
      const targetFile = toolArgs?.TargetFile || toolArgs?.targetFile || toolArgs?.target_file ||
                         toolArgs?.AbsolutePath || toolArgs?.absolutePath || toolArgs?.path || toolArgs?.file ||
                         toolArgs?.FilePath || toolArgs?.filePath;

      const debugChannel = ctx.ensureDebugChannel();
      let computedDiff: string | undefined;

      if (isEditTool && targetFile && (step.state === 'DONE' || step.state === 'SUCCESS')) {
        const cwd = ctx.resolveWorkingDirectory();
        const fwdFile = targetFile.replace(/\\/g, '/');
        const fileName = fwdFile.split('/').pop() || 'file';

        try {
          const afterContent = fs.readFileSync(targetFile, 'utf-8');
          const prevSnapshot = ctx.fileSnapshots.get(targetFile);

          if (prevSnapshot !== undefined) {
            if (prevSnapshot !== afterContent) {
              const tmpBefore = path.join(os.tmpdir(), `agy-diff-before-${Date.now()}.tmp`);
              try {
                fs.writeFileSync(tmpBefore, prevSnapshot);
                const raw = cp.execSync(`git diff --no-index -- "${tmpBefore}" "${targetFile}"`, { encoding: 'utf-8', timeout: 5000 });
                if (raw && raw.trim()) computedDiff = raw.trim();
              } catch (diffErr: any) {
                if (diffErr.stdout && diffErr.stdout.trim()) computedDiff = diffErr.stdout.trim();
              } finally {
                try { fs.unlinkSync(tmpBefore); } catch {}
              }
              if (computedDiff) {
                const hunkIdx = computedDiff.indexOf('\n@@');
                if (hunkIdx !== -1) {
                  computedDiff = `diff --git a/${fileName} b/${fileName}\n--- a/${fileName}\n+++ b/${fileName}` + computedDiff.substring(hunkIdx);
                }
              }
              debugChannel.appendLine(`[DIFF] snapshot-based diff for ${targetFile}`);
            }
          } else {
            let beforeContent: string | null = null;
            const isInsideWorkspace = isInsidePath(targetFile, cwd);
            if (isInsideWorkspace) {
              try {
                const relPath = path.relative(cwd, targetFile).replace(/\\/g, '/');
                beforeContent = cp.execSync(`git show HEAD:"${relPath}"`, { cwd, encoding: 'utf-8', timeout: 5000 });
              } catch {}
            }
            if (beforeContent !== null && beforeContent !== afterContent) {
              const tmpBefore = path.join(os.tmpdir(), `agy-diff-before-${Date.now()}.tmp`);
              try {
                fs.writeFileSync(tmpBefore, beforeContent);
                const raw = cp.execSync(`git diff --no-index -- "${tmpBefore}" "${targetFile}"`, { encoding: 'utf-8', timeout: 5000 });
                if (raw && raw.trim()) computedDiff = raw.trim();
              } catch (diffErr: any) {
                if (diffErr.stdout && diffErr.stdout.trim()) computedDiff = diffErr.stdout.trim();
              } finally {
                try { fs.unlinkSync(tmpBefore); } catch {}
              }
              if (computedDiff) {
                const hunkIdx = computedDiff.indexOf('\n@@');
                if (hunkIdx !== -1) {
                  computedDiff = `diff --git a/${fileName} b/${fileName}\n--- a/${fileName}\n+++ b/${fileName}` + computedDiff.substring(hunkIdx);
                }
              }
              debugChannel.appendLine(`[DIFF] git-based diff for ${targetFile}`);
            } else if (beforeContent === null) {
              const lines = afterContent.split('\n');
              computedDiff = [
                `--- /dev/null`,
                `+++ b/${fileName}`,
                `@@ -0,0 +1,${lines.length} @@ new file`,
                ...lines.map((l: string) => `+${l}`)
              ].join('\n');
              debugChannel.appendLine(`[DIFF] new-file diff for ${targetFile} (${lines.length} lines)`);
            }
          }

          ctx.fileSnapshots.set(targetFile, afterContent);
        } catch (e: any) {
          debugChannel.appendLine(`[DIFF] error=${e.message}`);
        }
      }

      let rawError = toolInfo.error || step.error;
      let errorMessage = rawError ? (typeof rawError === 'string' ? rawError : rawError.message || JSON.stringify(rawError)) : '';

      let toolResult = toolInfo.output || toolInfo.result || toolInfo.content || toolInfo.text || toolInfo.response || toolInfo.diff || toolInfo.changes || step.content || step.output || step.result || step.text || step.diff || (errorMessage ? `[Error] ${errorMessage}` : undefined) || (step.state === 'DONE' ? step.text_delta : undefined);
      if (computedDiff) {
        toolResult = computedDiff;
      }
      toolResult = formatPermissionError(toolResult);

      const isGenericName = !toolName || ['tool', 'tool_call', 'tool_use', 'tool execution', 'tool_execution'].includes(toolName);

      if (!isGenericName || toolArgs || toolResult) {
        if (isGenericName) toolName = 'Tool Execution';
        const toolStatus = (step.state === 'DONE' || step.state === 'SUCCESS') ? 'done' : (step.state === 'ERROR' || step.state === 'FAILURE' || !!errorMessage) ? 'error' : 'running';
        let toolId = step.tool_call_id || step.call_id || step.id;
        if (!toolId && step.step_index !== undefined) {
          toolId = `step_${step.step_index}_0`;
        }
        if (!toolId) toolId = toolName;

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
    const isDiagnosticLine = typeof textDelta === 'string' && /^(?:log:|messaging:)/im.test(textDelta.trim());
    if (
      !isThinkingStep &&
      !isToolCall &&
      !isDiagnosticLine &&
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

    if (step.state === 'DONE' || step.state === 'SUCCESS') {
      const writeToolNorms = new Set(['writetofile', 'writefile', 'createfile', 'replacefilecontent', 'multireplacefilecontent']);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
      const allToolNames: string[] = [];
      if (toolNameRaw) allToolNames.push(norm(toolNameRaw.replace(/^(cortex_step_type_|step_type_)/i, '')));
      if (stepType) allToolNames.push(norm(stepType.replace(/^(cortex_step_type_|step_type_)/i, '')));
      if (step.tool_info?.name) allToolNames.push(norm(step.tool_info.name));
      if (Array.isArray(step.tool_calls)) {
        step.tool_calls.forEach((tc: any) => {
          const n = tc.name || tc.tool_name || tc.function?.name || '';
          if (n) allToolNames.push(norm(n));
        });
      }
      if (allToolNames.some(n => writeToolNorms.has(n))) {
        ctx.detectPlanFromToolCall(step, allToolNames[0]);
      }
    }

    if (step.state === 'DONE' && step.usage) {
      const convId = event.conversation_id || ctx.getConversationId();
      webviews.forEach((wv) =>
        wv.postMessage({
          type: 'stepComplete',
          usage: step.usage,
          conversationId: convId,
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

    const convId = event.conversation_id || ctx.getConversationId();
    webviews.forEach((wv) =>
      wv.postMessage({
        type: 'result',
        status: resultObj.status || 'SUCCESS',
        response: responseText,
        error: resultObj.error,
        durationSeconds: resultObj.duration_seconds,
        usage: resultObj.usage,
        conversationId: convId,
      })
    );
  } else if (event.event === 'error') {
    const errorObj = (event.error || event) as any;
    const errorMsg =
      errorObj.message ||
      (typeof errorObj === 'string' ? errorObj : JSON.stringify(errorObj));

    webviews.forEach((wv) =>
      wv.postMessage({
        type: 'error',
        error: errorMsg,
      })
    );
  }
}
