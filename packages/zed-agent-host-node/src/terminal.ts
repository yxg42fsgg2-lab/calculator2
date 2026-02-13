/**
 * Node.js TerminalProvider implementation.
 * Uses child_process for shell command execution.
 */

import { spawn } from 'node:child_process';
import type {
  TerminalProvider,
  TerminalOptions,
  TerminalHandle,
  TerminalExitStatus,
  TerminalOutput,
} from '@anthropic/zed-agent-core';

export class NodeTerminalProvider implements TerminalProvider {
  private defaultShell: string;

  constructor(defaultShell?: string) {
    this.defaultShell = defaultShell ?? process.env['SHELL'] ?? '/bin/bash';
  }

  async createTerminal(options: TerminalOptions): Promise<TerminalHandle> {
    return new NodeTerminalHandle(options, this.defaultShell);
  }
}

class NodeTerminalHandle implements TerminalHandle {
  readonly id: string;
  private output = '';
  private truncated = false;
  private exitStatus: TerminalExitStatus | null = null;
  private exitResolvers: Array<(status: TerminalExitStatus) => void> = [];
  private userStopped = false;
  private maxBytes: number;

  constructor(options: TerminalOptions, shell: string) {
    this.id = `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.maxBytes = options.outputByteLimit ?? 1024 * 1024; // 1MB default

    const child = spawn(shell, ['-c', options.command], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const collectOutput = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (this.output.length + text.length > this.maxBytes) {
        this.output += text.slice(0, this.maxBytes - this.output.length);
        this.truncated = true;
      } else {
        this.output += text;
      }
    };

    child.stdout?.on('data', collectOutput);
    child.stderr?.on('data', collectOutput);

    child.on('exit', (code, signal) => {
      this.exitStatus = {
        exitCode: code,
        signal: signal ?? undefined,
      };
      for (const resolve of this.exitResolvers) {
        resolve(this.exitStatus);
      }
      this.exitResolvers = [];
    });

    child.on('error', (err) => {
      this.exitStatus = { exitCode: 1, signal: undefined };
      this.output += `\nError: ${err.message}`;
      for (const resolve of this.exitResolvers) {
        resolve(this.exitStatus);
      }
      this.exitResolvers = [];
    });

    // Store child for kill()
    (this as unknown as { _child: typeof child })._child = child;
  }

  waitForExit(): Promise<TerminalExitStatus> {
    if (this.exitStatus) {
      return Promise.resolve(this.exitStatus);
    }
    return new Promise((resolve) => {
      this.exitResolvers.push(resolve);
    });
  }

  currentOutput(): TerminalOutput {
    return {
      output: this.output,
      truncated: this.truncated,
      exitStatus: this.exitStatus,
    };
  }

  kill(): void {
    const child = (this as unknown as { _child?: { kill: (sig?: string) => void; killed: boolean } })._child;
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  }

  wasStoppedByUser(): boolean {
    return this.userStopped;
  }
}
