/**
 * TerminalTool — executes shell commands.
 * Ported from: crates/agent/src/tools/terminal_tool.rs (~311 LOC production)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';
import type { TerminalOutput } from '../types/host.js';

export interface TerminalToolInput {
  /** The one-liner command to execute. */
  command: string;
  /** Working directory for the command. Must be one of the root directories. */
  cd: string;
  /** Optional maximum runtime in milliseconds. */
  timeout_ms?: number;
}

export const TERMINAL_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Executes a shell one-liner and returns the combined output.\n\n' +
    "This tool spawns a process using the user's shell, reads from stdout and stderr " +
    '(preserving the order of writes), and returns a string with the combined output result.\n\n' +
    'The output results will be shown to the user already, only list it again if necessary, avoid being redundant.\n\n' +
    'Make sure you use the `cd` parameter to navigate to one of the root directories of the project. ' +
    'NEVER do it as part of the `command` itself, otherwise it will error.\n\n' +
    "Do not use this tool for commands that run indefinitely, such as servers (like `npm run start`, `npm run dev`, " +
    "`python -m http.server`, etc) or file watchers that don't terminate on their own.\n\n" +
    'For potentially long-running commands, prefer specifying `timeout_ms` to bound runtime and prevent indefinite hangs.\n\n' +
    "Remember that each invocation of this tool will spawn a new shell process, so you can't rely on any state from previous invocations.\n\n" +
    'The terminal emulator is an interactive pty, so commands may block waiting for user input. ' +
    'Some commands can be configured not to do this, such as `git --no-pager diff` and similar.',
  properties: {
    command: {
      type: 'string',
      description: 'The one-liner command to execute.',
    },
    cd: {
      type: 'string',
      description: 'Working directory for the command. This must be one of the root directories of the project.',
    },
    timeout_ms: {
      type: 'number',
      description: 'Optional maximum runtime (in milliseconds). If exceeded, the running terminal task is killed.',
    },
  },
  required: ['command', 'cd'],
} as const;

const COMMAND_OUTPUT_LIMIT = 16 * 1024; // 16KB

export class TerminalTool implements AgentTool<TerminalToolInput, string> {
  readonly name = 'terminal';
  readonly kind: ToolKind = 'execute';

  description(): string {
    return TERMINAL_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return TERMINAL_TOOL_SCHEMA;
  }

  initialTitle(input: TerminalToolInput | null): string {
    if (input?.command) {
      return input.command;
    }
    return '';
  }

  async run(input: TerminalToolInput, context: ToolContext): Promise<AgentToolOutput> {
    // Resolve working directory
    const workingDir = resolveWorkingDir(input, context);

    // Check permissions
    const decision = context.host.permissions.checkAutoPermission('terminal', [input.command]);
    if (decision.type === 'deny') {
      throw new Error(decision.reason);
    }
    if (decision.type === 'confirm') {
      await context.eventStream.authorize(
        this.initialTitle(input),
        { toolName: 'terminal', inputValues: [input.command] },
      );
    }

    // Create terminal
    const terminal = await context.host.terminal.createTerminal({
      command: input.command,
      cwd: workingDir,
      outputByteLimit: COMMAND_OUTPUT_LIMIT,
    });

    // Update tool call with terminal reference
    context.eventStream.updateFields({
      content: [{ type: 'terminal', terminalId: terminal.id }],
    });

    // Wait for completion with timeout and cancellation
    let timedOut = false;
    let userStopped = false;

    const timeoutMs = input.timeout_ms;

    const exitPromise = terminal.waitForExit();
    const cancelPromise = context.eventStream.cancelledByUser();

    if (timeoutMs) {
      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), timeoutMs),
      );

      const result = await Promise.race([
        exitPromise.then(() => 'exit' as const),
        timeoutPromise,
        cancelPromise.then(() => 'cancel' as const),
      ]);

      if (result === 'timeout') {
        timedOut = true;
        terminal.kill();
        await exitPromise.catch(() => {});
      } else if (result === 'cancel') {
        userStopped = true;
        terminal.kill();
        await exitPromise.catch(() => {});
      }
    } else {
      const result = await Promise.race([
        exitPromise.then(() => 'exit' as const),
        cancelPromise.then(() => 'cancel' as const),
      ]);

      if (result === 'cancel') {
        userStopped = true;
        terminal.kill();
        await exitPromise.catch(() => {});
      }
    }

    // Check user stop flags
    userStopped = userStopped || context.eventStream.wasCancelledByUser() || terminal.wasStoppedByUser();

    const output = terminal.currentOutput();
    const text = processContent(output, input.command, timedOut, userStopped);

    return {
      llmOutput: textToolResult(text),
      rawOutput: text,
    };
  }
}

/**
 * Process terminal output into a formatted string.
 * Ported from: process_content() in terminal_tool.rs
 */
function processContent(
  output: TerminalOutput,
  command: string,
  timedOut: boolean,
  userStopped: boolean,
): string {
  const rawContent = output.output.trim();
  const isEmpty = rawContent.length === 0;
  let content = `\`\`\`\n${rawContent}\n\`\`\``;

  if (output.truncated) {
    content = `Command output too long. The first ${content.length} bytes:\n\n${content}`;
  }

  if (userStopped) {
    if (isEmpty) {
      return (
        'The user stopped this command. No output was captured before stopping.\n\n' +
        'Since the user intentionally interrupted this command, ask them what they would like to do next ' +
        'rather than automatically retrying or assuming something went wrong.'
      );
    }
    return (
      `The user stopped this command. Output captured before stopping:\n\n${content}\n\n` +
      'Since the user intentionally interrupted this command, ask them what they would like to do next ' +
      'rather than automatically retrying or assuming something went wrong.'
    );
  }

  if (timedOut) {
    if (isEmpty) {
      return `Command "${command}" timed out. No output was captured.`;
    }
    return `Command "${command}" timed out. Output captured before timeout:\n\n${content}`;
  }

  const exitCode = output.exitStatus?.exitCode;
  if (exitCode === 0) {
    return isEmpty ? 'Command executed successfully.' : content;
  }
  if (exitCode !== null && exitCode !== undefined) {
    if (isEmpty) {
      return `Command "${command}" failed with exit code ${exitCode}.`;
    }
    return `Command "${command}" failed with exit code ${exitCode}.\n\n${content}`;
  }

  // No exit code — unexpected termination
  if (isEmpty) {
    return 'Command terminated unexpectedly. No output was captured.';
  }
  return `Command terminated unexpectedly. Output captured:\n\n${content}`;
}

/**
 * Resolve the working directory for the terminal command.
 * Ported from: working_dir() in terminal_tool.rs
 */
function resolveWorkingDir(input: TerminalToolInput, context: ToolContext): string | undefined {
  const cd = input.cd;
  const roots = context.host.project.workspaceRoots;

  if (cd === '.' || cd === '') {
    if (roots.length === 1) {
      return roots[0]!.absolutePath;
    }
    if (roots.length === 0) {
      return undefined;
    }
    throw new Error(
      "'.' is ambiguous in multi-root workspaces. Please specify a root directory explicitly.",
    );
  }

  // Check if cd is an absolute path within a workspace root
  if (cd.startsWith('/') || cd.startsWith('\\')) {
    const matchingRoot = roots.find((r) => cd.startsWith(r.absolutePath));
    if (matchingRoot) {
      return cd;
    }
    throw new Error(`\`cd\` directory "${cd}" was not in any of the project's worktrees.`);
  }

  // Check if cd matches a root name
  const matchingRoot = roots.find((r) => r.name === cd || cd.startsWith(r.name + '/'));
  if (matchingRoot) {
    if (cd === matchingRoot.name) {
      return matchingRoot.absolutePath;
    }
    // cd is like "rootname/subdir"
    const subPath = cd.slice(matchingRoot.name.length + 1);
    return `${matchingRoot.absolutePath}/${subPath}`;
  }

  throw new Error(`\`cd\` directory "${cd}" was not in any of the project's worktrees.`);
}
