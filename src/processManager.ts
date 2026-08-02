import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { EventEmitter } from 'events';
import { AgyStreamEvent } from './types';

export class AgyProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private currentConversationId: string | null = null;
  private turnActive = false;

  public getConversationId(): string | null {
    return this.currentConversationId;
  }

  public setConversationId(id: string | null): void {
    this.currentConversationId = id;
  }

  public runPrompt(
    cliPath: string,
    cwd: string,
    prompt: string,
    options: {
      dangerouslySkipPermissions?: boolean;
      images?: string[];
      extraWorkspaceDirs?: string[];
    } = {}
  ): void {
    if (this.turnActive) {
      return;
    }

    this.killProcess();
    this.turnActive = true;

    const args: string[] = ['--output-format', 'stream-json', '-p', prompt];

    if (cwd) {
      args.push('--add-dir', cwd);
    }

    if (options.extraWorkspaceDirs && options.extraWorkspaceDirs.length > 0) {
      const normCwd = path.resolve(cwd).replace(/\\/g, '/').toLowerCase();
      for (const extraDir of options.extraWorkspaceDirs) {
        const normExtra = path.resolve(extraDir).replace(/\\/g, '/').toLowerCase();
        if (normExtra && normExtra !== normCwd) {
          args.push('--add-dir', extraDir);
        }
      }
    }

    if (options.images && options.images.length > 0) {
      const normCwd = path.resolve(cwd).replace(/\\/g, '/').toLowerCase();
      for (const imgPath of options.images) {
        const normalized = path.resolve(imgPath).replace(/\\/g, '/');
        const imgDir = path.dirname(normalized);
        const normImgDir = imgDir.toLowerCase();
        if (normImgDir && normImgDir !== normCwd && !normImgDir.startsWith(normCwd + '/')) {
          args.push('--add-dir', imgDir);
        }
      }
    }

    if (this.currentConversationId) {
      args.push('--conversation', this.currentConversationId);
    }

    if (options.dangerouslySkipPermissions === true) {
      args.push('--dangerously-skip-permissions');
    }

    const proc = spawn(cliPath, args, {
      cwd,
      env: { ...process.env },
      shell: false,
    });
    this.process = proc;

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

        this.emit('event', normalizedEvent);

        if (eventType === 'result') {
          this.turnActive = false;
        }
      } catch (e) {
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
      if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fatal') || msg.toLowerCase().includes('failed')) {
        this.emit('event', {
          event: 'error',
          error: msg.trim(),
        } as AgyStreamEvent);
      }
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
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.turnActive = false;
  }

  public cancelCurrentTask(): void {
    if (this.process && this.turnActive) {
      const procToKill = this.process;
      this.process = null;
      this.turnActive = false;
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
