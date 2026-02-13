/**
 * Tests for the Node.js TerminalProvider implementation.
 */

import { describe, it, expect } from 'vitest';
import { NodeTerminalProvider } from '../src/terminal.js';

describe('NodeTerminalProvider', () => {
  const provider = new NodeTerminalProvider();

  it('executes a simple command', async () => {
    const handle = await provider.createTerminal({
      command: 'echo "hello from terminal"',
    });

    expect(handle.id).toBeTruthy();

    const exitStatus = await handle.waitForExit();
    expect(exitStatus.exitCode).toBe(0);

    const output = handle.currentOutput();
    expect(output.output).toContain('hello from terminal');
    expect(output.truncated).toBe(false);
  });

  it('captures exit code for failing commands', async () => {
    const handle = await provider.createTerminal({
      command: 'exit 42',
    });

    const exitStatus = await handle.waitForExit();
    expect(exitStatus.exitCode).toBe(42);
  });

  it('captures stderr output', async () => {
    const handle = await provider.createTerminal({
      command: 'echo "error message" >&2',
    });

    await handle.waitForExit();
    const output = handle.currentOutput();
    expect(output.output).toContain('error message');
  });

  it('handles multi-line output', async () => {
    const handle = await provider.createTerminal({
      command: 'echo "line1"; echo "line2"; echo "line3"',
    });

    await handle.waitForExit();
    const output = handle.currentOutput();
    expect(output.output).toContain('line1');
    expect(output.output).toContain('line2');
    expect(output.output).toContain('line3');
  });

  it('respects working directory', async () => {
    const handle = await provider.createTerminal({
      command: 'pwd',
      cwd: '/tmp',
    });

    await handle.waitForExit();
    const output = handle.currentOutput();
    // /tmp might be a symlink, so check for either
    expect(output.output.trim()).toMatch(/\/(tmp|private\/tmp)/);
  });

  it('can kill a running process', async () => {
    const handle = await provider.createTerminal({
      command: 'sleep 60',
    });

    // Kill after a short delay
    await new Promise(r => setTimeout(r, 50));
    handle.kill();

    const exitStatus = await handle.waitForExit();
    // Killed processes have non-zero exit or signal
    expect(exitStatus.exitCode !== 0 || exitStatus.signal !== undefined).toBe(true);
  });

  it('respects output byte limit', async () => {
    const handle = await provider.createTerminal({
      command: 'yes "aaaaaaaaaa" | head -1000', // ~11KB of output
      outputByteLimit: 100,
    });

    await handle.waitForExit();
    const output = handle.currentOutput();
    expect(output.output.length).toBeLessThanOrEqual(110); // some slack
    expect(output.truncated).toBe(true);
  });

  it('reports wasStoppedByUser as false for normal exit', async () => {
    const handle = await provider.createTerminal({
      command: 'echo done',
    });

    await handle.waitForExit();
    expect(handle.wasStoppedByUser()).toBe(false);
  });
});
