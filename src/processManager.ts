import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { EventEmitter } from 'events';
import { AgyStreamEvent } from './types';
import { normalizePath, normalizePathLower } from './pathUtils';

export class AgyProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private currentConversationId: string | null = null;
  private activeCliPath: string | null = null;
  private activeCwd: string | null = null;
  private activeOptionsHash: string | null = null;
  private turnActive = false;
  private turnStartTimestamp = 0;

  public getConversationId(): string | null {
    return this.currentConversationId;
  }

  public setConversationId(id: string | null): void {
    if (this.currentConversationId !== id) {
      this.currentConversationId = id;
      // Terminate old process if switching to a different conversation
      if (this.process) {
        this.killProcess();
      }
    }
  }

  public runPrompt(
    cliPath: string,
    cwd: string,
    prompt: string,
    options: {
      dangerouslySkipPermissions?: boolean;
      sandbox?: boolean;
      images?: string[];
      extraWorkspaceDirs?: string[];
      effort?: 'low' | 'medium' | 'high';
      model?: string;
    } = {}
  ): void {
    if (this.turnActive && this.process) {
      return;
    }
    if (this.turnActive && !this.process) {
      this.turnActive = false;
    }

    this.turnActive = true;
    this.turnStartTimestamp = Date.now();

    const optionsHash = JSON.stringify({
      effort: options.effort,
      model: options.model,
      sandbox: options.sandbox,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      extraWorkspaceDirs: options.extraWorkspaceDirs,
    });

    const isProcessUsable =
      this.process &&
      !this.process.killed &&
      this.activeCliPath === cliPath &&
      this.activeCwd === cwd &&
      this.activeOptionsHash === optionsHash;

    const payload = JSON.stringify({
      event: 'user',
      message: {
        content: prompt,
      },
    }) + '\n';

    if (isProcessUsable && this.process && this.process.stdin && !this.process.stdin.destroyed) {
      // Warm process already active: dispatch turn immediately with zero spawn latency
      this.process.stdin.write(payload);
      return;
    }

    // Need to spawn fresh persistent stream-json process
    this.killProcess();
    this.turnActive = true;
    this.activeCliPath = cliPath;
    this.activeCwd = cwd;
    this.activeOptionsHash = optionsHash;

    const args: string[] = ['--input-format', 'stream-json', '--output-format', 'stream-json'];

    if (cwd) {
      args.push('--add-dir', cwd);
    }

    if (options.extraWorkspaceDirs && options.extraWorkspaceDirs.length > 0) {
      const normCwd = normalizePathLower(cwd);
      for (const extraDir of options.extraWorkspaceDirs) {
        const normExtra = normalizePathLower(extraDir);
        if (normExtra && normExtra !== normCwd) {
          args.push('--add-dir', extraDir);
        }
      }
    }

    if (options.images && options.images.length > 0) {
      const normCwd = normalizePathLower(cwd);
      for (const imgPath of options.images) {
        const imgDir = path.dirname(normalizePath(imgPath));
        const normImgDir = imgDir.toLowerCase();
        if (normImgDir && normImgDir !== normCwd && !normImgDir.startsWith(normCwd + '/')) {
          args.push('--add-dir', imgDir);
        }
      }
    }

    if (this.currentConversationId) {
      args.push('--conversation', this.currentConversationId);
    }

    if (options.model) {
      args.push('--model', options.model);
      const hasEffortSuffix = /-(?:high|medium|low)$/i.test(options.model);
      const isThirdParty = /claude|gpt|anthropic|openai/i.test(options.model);
      if (!hasEffortSuffix && !isThirdParty && options.effort) {
        args.push('--effort', options.effort);
      }
    } else if (options.effort) {
      args.push('--effort', options.effort);
    }

    if (options.sandbox) {
      args.push('--sandbox');
    }

    if (options.dangerouslySkipPermissions === true) {
      args.push('--dangerously-skip-permissions');
    }

    const proc = spawn(cliPath, args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    this.process = proc;

    // Send the turn payload immediately on stdin
    proc.stdin?.write(payload);

    const rlInst = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });
    this.rl = rlInst;

    rlInst.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const parsed: any = JSON.parse(trimmed);
        const eventType = parsed.event || parsed.type;
        const normalizedEvent: AgyStreamEvent = {
          ...parsed,
          event: eventType,
        };

        if (parsed.conversation_id) {
          this.currentConversationId = parsed.conversation_id;
        }
        if (parsed.step_update?.conversation_id) {
          this.currentConversationId = parsed.step_update.conversation_id;
        }

        if (eventType === 'init' && this.turnStartTimestamp) {
          const initMs = Date.now() - this.turnStartTimestamp;
          this.emit('timing', { phase: 'spawn-to-init', ms: initMs });
        }
        if (eventType === 'result' && this.turnStartTimestamp) {
          const totalMs = Date.now() - this.turnStartTimestamp;
          this.emit('timing', { phase: 'total', ms: totalMs });
        }

        this.emit('event', normalizedEvent);

        if (eventType === 'result') {
          this.turnActive = false;
        }
      } catch (e) {
        if (/^log:|^messaging:|^DEBUG|^INFO|^WARN|^ERROR/i.test(trimmed)) {
          this.emit('stderr', line + '\n');
          return;
        }
        this.emit('event', {
          event: 'agent_response',
          step_update: {
            conversation_id: this.currentConversationId || '',
            step_index: -1,
            state: 'RUNNING',
            step_type: 'agent_response',
            text_delta: line + '\n',
          },
        } as unknown as AgyStreamEvent);
      }
    });

    let stderrOutput = '';
    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString('utf-8');
      stderrOutput += msg;
      this.emit('stderr', msg);
    });

    proc.on('close', (code: number) => {
      if (this.process === proc) {
        this.process = null;
        this.rl = null;
        this.turnActive = false;
        if (code !== 0 && code !== null) {
          const errorText = stderrOutput.trim() || `Process exited with code ${code}`;
          this.emit('event', {
            event: 'error',
            error: errorText,
          } as AgyStreamEvent);
        }
        this.emit('close', code);
      }
    });

    proc.on('error', (err: Error) => {
      if (this.process === proc) {
        this.process = null;
        this.rl = null;
        this.turnActive = false;
        this.emit('event', {
          event: 'error',
          error: err.message,
        } as AgyStreamEvent);
      }
    });
  }

  public killProcess(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {}
      this.process = null;
    }
    this.turnActive = false;
  }

  public cancelCurrentTask(): void {
    if (this.process && this.turnActive) {
      const procToKill = this.process;
      this.killProcess();
      procToKill.kill('SIGINT');
      this.emit('cancelled');
    }
  }

  public newSession(): void {
    this.currentConversationId = null;
    this.killProcess();
  }

  public isBusy(): boolean {
    return this.turnActive;
  }
}
