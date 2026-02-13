/**
 * Tests for edit prompt template rendering.
 * Verifies the 4 ported Handlebars templates produce correct output.
 */

import { describe, it, expect } from 'vitest';
import {
  buildXmlEditPrompt,
  buildDiffFencedEditPrompt,
  buildCreateFilePrompt,
  buildDiffJudgePrompt,
} from '../src/templates/edit-prompts.js';

describe('XML edit prompt', () => {
  it('includes file path and description', () => {
    const prompt = buildXmlEditPrompt({
      path: 'src/main.ts',
      edit_description: 'Add error handling',
    });
    expect(prompt).toContain('src/main.ts');
    expect(prompt).toContain('Add error handling');
  });

  it('includes XML tag format instructions', () => {
    const prompt = buildXmlEditPrompt({
      path: 'test.py',
      edit_description: 'Fix imports',
    });
    expect(prompt).toContain('<old_text');
    expect(prompt).toContain('</old_text>');
    expect(prompt).toContain('<new_text>');
    expect(prompt).toContain('</new_text>');
    expect(prompt).toContain('<edits>');
  });

  it('includes the example', () => {
    const prompt = buildXmlEditPrompt({
      path: 'lib.rs',
      edit_description: 'Add field',
    });
    expect(prompt).toContain('struct User');
    expect(prompt).toContain('active: bool');
  });

  it('includes tool-disabled instruction', () => {
    const prompt = buildXmlEditPrompt({
      path: 'file.ts',
      edit_description: 'Edit',
    });
    expect(prompt).toContain('Tool calls have been disabled');
    expect(prompt).toContain('MUST start your response with <edits>');
  });
});

describe('Diff-fenced edit prompt', () => {
  it('includes file path and description', () => {
    const prompt = buildDiffFencedEditPrompt({
      path: 'src/main.py',
      edit_description: 'Refactor function',
    });
    expect(prompt).toContain('src/main.py');
    expect(prompt).toContain('Refactor function');
  });

  it('includes SEARCH/REPLACE format', () => {
    const prompt = buildDiffFencedEditPrompt({
      path: 'test.go',
      edit_description: 'Fix bug',
    });
    expect(prompt).toContain('<<<<<<< SEARCH');
    expect(prompt).toContain('=======');
    expect(prompt).toContain('>>>>>>> REPLACE');
  });

  it('includes the example', () => {
    const prompt = buildDiffFencedEditPrompt({
      path: 'lib.rs',
      edit_description: 'Add field',
    });
    expect(prompt).toContain('struct User');
    expect(prompt).toContain('active: bool');
  });

  it('includes diff-specific instruction', () => {
    const prompt = buildDiffFencedEditPrompt({
      path: 'f.ts',
      edit_description: 'e',
    });
    expect(prompt).toContain('SEARCH/REPLACE diff format only');
  });
});

describe('Create file prompt', () => {
  it('includes file path and description', () => {
    const prompt = buildCreateFilePrompt({
      path: 'new-file.ts',
      edit_description: 'Create a config module',
    });
    expect(prompt).toContain('new-file.ts');
    expect(prompt).toContain('Create a config module');
  });

  it('instructs wrapping in backticks', () => {
    const prompt = buildCreateFilePrompt({
      path: 'f.ts',
      edit_description: 'd',
    });
    expect(prompt).toContain('triple backticks');
    expect(prompt).toContain('expert engineer');
  });

  it('works without path', () => {
    const prompt = buildCreateFilePrompt({
      edit_description: 'Create something',
    });
    expect(prompt).toContain('Create something');
    // Path section should still exist but be empty
    expect(prompt).toContain('<file_path>');
  });
});

describe('Diff judge prompt', () => {
  it('includes diff and assertions', () => {
    const prompt = buildDiffJudgePrompt({
      diff: '- old line\n+ new line',
      assertions: '1. The old line was removed\n2. The new line was added',
    });
    expect(prompt).toContain('old line');
    expect(prompt).toContain('new line');
    expect(prompt).toContain('The old line was removed');
    expect(prompt).toContain('The new line was added');
  });

  it('includes scoring instructions', () => {
    const prompt = buildDiffJudgePrompt({
      diff: 'some diff',
      assertions: 'some assertion',
    });
    expect(prompt).toContain('score between 0 and 100');
    expect(prompt).toContain('<analysis>');
    expect(prompt).toContain('<score>');
  });
});
