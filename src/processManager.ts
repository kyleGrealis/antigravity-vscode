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

    this.process = spawn(cliPath, args, {
      cwd,
      env: { ...process.env },
      shell: false,
    });

    this.rl = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line: string) => {
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
        if (parsed.result?.conversation_id) {
          this.currentConversationId = parsed.result.conversation_id;
        }

        this.emit('event', normalizedEvent);

        if (eventType === 'result') {
          this.turnActive = false;
        }
      } catch {
        this.emit('event', {
          event: 'step_update',
          step_update: {
            conversation_id: this.currentConversationId || '',
            step_index: -1,
            state: 'RUNNING',
            step_type: 'agent_response',
            text_delta: line + '\n',
          },
        } as AgyStreamEvent);
      }
    });

    let stderrOutput = '';
    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString('utf-8');
      stderrOutput += msg;
      if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fatal') || msg.toLowerCase().includes('failed')) {
        this.emit('event', {
          event: 'error',
          error: msg.trim(),
        } as AgyStreamEvent);
      }
    });

    this.process.on('close', (code: number) => {
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
    });

    this.process.on('error', (err: Error) => {
      this.process = null;
      this.rl = null;
      this.turnActive = false;
      this.emit('event', {
        event: 'error',
        error: err.message,
      } as AgyStreamEvent);
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
      this.process.kill('SIGINT');
      this.turnActive = false;
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
