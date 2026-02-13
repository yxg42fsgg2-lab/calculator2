/**
 * Tests for the system prompt template.
 * Ported from: crates/agent/src/templates.rs tests
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, type SystemPromptData } from '../src/templates/system-prompt.js';

function makeData(overrides: Partial<SystemPromptData> = {}): SystemPromptData {
  return {
    worktrees: [],
    available_tools: [],
    os: 'linux',
    shell: '/bin/bash',
    has_rules: false,
    has_user_rules: false,
    ...overrides,
  };
}

describe('System Prompt Template', () => {
  it('renders basic prompt without tools', () => {
    const prompt = buildSystemPrompt(makeData());
    expect(prompt).toContain('highly skilled software engineer');
    expect(prompt).toContain('Operating System: linux');
    expect(prompt).toContain('Default Shell: /bin/bash');
    // Without tools, should include "no ability to use tools" section
    expect(prompt).toContain('no ability to use tools');
  });

  it('renders with tools', () => {
    const prompt = buildSystemPrompt(makeData({
      available_tools: ['read_file', 'grep', 'terminal'],
    }));
    // With tools, should include tool use instructions
    expect(prompt).toContain('Tool Use');
    expect(prompt).toContain('Make sure to adhere to the tools schema');
    // Should NOT have the "no tools" section
    expect(prompt).not.toContain('no ability to use tools');
  });

  it('includes grep-specific instructions when grep is available', () => {
    const prompt = buildSystemPrompt(makeData({
      available_tools: ['grep', 'read_file'],
    }));
    expect(prompt).toContain('prefer the `grep` tool');
    expect(prompt).toContain('find_path');
  });

  it('omits grep instructions when grep is not available', () => {
    const prompt = buildSystemPrompt(makeData({
      available_tools: ['read_file', 'terminal'],
    }));
    expect(prompt).not.toContain('prefer the `grep` tool');
  });

  it('includes worktree paths', () => {
    const prompt = buildSystemPrompt(makeData({
      available_tools: ['read_file'],
      worktrees: [
        { root_name: 'backend', abs_path: '/home/user/project/backend' },
        { root_name: 'frontend', abs_path: '/home/user/project/frontend' },
      ],
    }));
    expect(prompt).toContain('/home/user/project/backend');
    expect(prompt).toContain('/home/user/project/frontend');
  });

  it('includes model name', () => {
    const prompt = buildSystemPrompt(makeData({
      model_name: 'claude-sonnet-4',
    }));
    expect(prompt).toContain('claude-sonnet-4');
    expect(prompt).toContain('Model Information');
  });

  it('omits model name section when not provided', () => {
    const prompt = buildSystemPrompt(makeData());
    expect(prompt).not.toContain('Model Information');
  });

  it('includes project rules', () => {
    const prompt = buildSystemPrompt(makeData({
      available_tools: ['read_file'],
      has_rules: true,
      worktrees: [
        {
          root_name: 'myproject',
          abs_path: '/home/user/myproject',
          rules_file: {
            path_in_worktree: '.rules',
            text: 'Always use TypeScript strict mode.',
          },
        },
      ],
    }));
    expect(prompt).toContain('Custom Instructions');
    expect(prompt).toContain('Always use TypeScript strict mode');
    expect(prompt).toContain('myproject/.rules');
  });

  it('includes user rules', () => {
    const prompt = buildSystemPrompt(makeData({
      has_user_rules: true,
      user_rules: [
        { title: 'My Style Guide', contents: 'Use 2-space indentation.' },
      ],
    }));
    expect(prompt).toContain('Custom Instructions');
    expect(prompt).toContain('My Style Guide');
    expect(prompt).toContain('2-space indentation');
  });

  it('includes code block formatting instructions', () => {
    const prompt = buildSystemPrompt(makeData());
    expect(prompt).toContain('Code Block Formatting');
    expect(prompt).toContain('path/to/Something.blah');
  });

  it('includes diagnostics section when tools are available', () => {
    const prompt = buildSystemPrompt(makeData({
      available_tools: ['diagnostics'],
    }));
    expect(prompt).toContain('Fixing Diagnostics');
    expect(prompt).toContain('Debugging');
  });

  it('includes external API guidelines', () => {
    const prompt = buildSystemPrompt(makeData());
    expect(prompt).toContain('Calling External APIs');
    expect(prompt).toContain('API Key');
  });
});
