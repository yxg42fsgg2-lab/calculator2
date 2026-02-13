/**
 * Edit prompt templates.
 * Ported from:
 *   crates/agent/src/templates/edit_file_prompt_xml.hbs (92 LOC)
 *   crates/agent/src/templates/edit_file_prompt_diff_fenced.hbs (77 LOC)
 *   crates/agent/src/templates/create_file_prompt.hbs (15 LOC)
 *   crates/agent/src/templates/diff_judge.hbs (23 LOC)
 *
 * These are the secondary prompts used by the EditAgent when making
 * granular edits to files. The main model calls the edit_file tool,
 * which then makes a secondary LLM call using one of these prompts.
 */

import Handlebars from 'handlebars';

// ---------------------------------------------------------------------------
// XML edit prompt — used by most providers (Anthropic, OpenAI)
// ---------------------------------------------------------------------------

const EDIT_FILE_PROMPT_XML_TEMPLATE = `You MUST respond with a series of edits to a file, using the following format:

\`\`\`
<edits>

<old_text line=10>
OLD TEXT 1 HERE
</old_text>
<new_text>
NEW TEXT 1 HERE
</new_text>

<old_text line=456>
OLD TEXT 2 HERE
</old_text>
<new_text>
NEW TEXT 2 HERE
</new_text>

</edits>
\`\`\`

# File Editing Instructions

- Use \`<old_text>\` and \`<new_text>\` tags to replace content
- \`<old_text>\` must exactly match existing file content, including indentation
- \`<old_text>\` must come from the actual file, not an outline
- \`<old_text>\` cannot be empty
- \`line\` should be a starting line number for the text to be replaced
- Be minimal with replacements:
  - For unique lines, include only those lines
  - For non-unique lines, include enough context to identify them
- Do not escape quotes, newlines, or other characters within tags
- For multiple occurrences, repeat the same tag pair for each instance
- Edits are sequential - each assumes previous edits are already applied
- Only edit the specified file
- Always close all tags properly

<example>
<edits>

<old_text line=3>
struct User {
    name: String,
    email: String,
}
</old_text>
<new_text>
struct User {
    name: String,
    email: String,
    active: bool,
}
</new_text>

<old_text line=25>
    let user = User {
        name: String::from("John"),
        email: String::from("john@example.com"),
    };
</old_text>
<new_text>
    let user = User {
        name: String::from("John"),
        email: String::from("john@example.com"),
        active: true,
    };
</new_text>

</edits>
</example>


<file_to_edit>
{{path}}
</file_to_edit>

<edit_description>
{{edit_description}}
</edit_description>

Tool calls have been disabled. You MUST start your response with <edits>.`;

// ---------------------------------------------------------------------------
// Diff-fenced edit prompt — used by Google Gemini
// ---------------------------------------------------------------------------

const EDIT_FILE_PROMPT_DIFF_FENCED_TEMPLATE = `You MUST respond with a series of edits to a file, using the following diff format:

\`\`\`
<<<<<<< SEARCH line=1
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE

<<<<<<< SEARCH line=325
return 0
=======
print("Done")

return 0
>>>>>>> REPLACE
\`\`\`

# File Editing Instructions

- Use the SEARCH/REPLACE diff format shown above
- The SEARCH section must exactly match existing file content, including indentation
- The SEARCH section must come from the actual file, not an outline
- The SEARCH section cannot be empty
- \`line\` should be a starting line number for the text to be replaced
- Be minimal with replacements:
  - For unique lines, include only those lines
  - For non-unique lines, include enough context to identify them
- Do not escape quotes, newlines, or other characters
- For multiple occurrences, repeat the same diff block for each instance
- Edits are sequential - each assumes previous edits are already applied
- Only edit the specified file

# Example

\`\`\`
<<<<<<< SEARCH line=3
struct User {
    name: String,
    email: String,
}
=======
struct User {
    name: String,
    email: String,
    active: bool,
}
>>>>>>> REPLACE

<<<<<<< SEARCH line=25
    let user = User {
        name: String::from("John"),
        email: String::from("john@example.com"),
    };
=======
    let user = User {
        name: String::from("John"),
        email: String::from("john@example.com"),
        active: true,
    };
>>>>>>> REPLACE
\`\`\`


# Final instructions

Tool calls have been disabled. You MUST respond using the SEARCH/REPLACE diff format only.

<file_to_edit>
{{path}}
</file_to_edit>

<edit_description>
{{edit_description}}
</edit_description>`;

// ---------------------------------------------------------------------------
// Create file prompt
// ---------------------------------------------------------------------------

const CREATE_FILE_PROMPT_TEMPLATE = `You are an expert engineer and your task is to write a new file from scratch.

You MUST respond with the file's content wrapped in triple backticks (\\\`\\\`\\\`).
The backticks should be on their own line.
The text you output will be saved verbatim as the content of the file.
Tool calls have been disabled.
Start your response with \\\`\\\`\\\`.

<file_path>
{{path}}
</file_path>

<edit_description>
{{edit_description}}
</edit_description>`;

// ---------------------------------------------------------------------------
// Diff judge prompt — evaluates edit quality
// ---------------------------------------------------------------------------

const DIFF_JUDGE_PROMPT_TEMPLATE = `You are an expert coder, and have been tasked with looking at the following diff:

<diff>
{{diff}}
</diff>

Evaluate the following assertions:

<assertions>
{{assertions}}
</assertions>

You must respond with a short analysis and a score between 0 and 100, where:
- 0 means no assertions pass
- 100 means all the assertions pass perfectly

<analysis>
- Assertion 1: one line describing why the first assertion passes or fails (even partially)
- Assertion 2: one line describing why the second assertion passes or fails (even partially)
- ...
- Assertion N: one line describing why the Nth assertion passes or fails (even partially)
</analysis>
<score>YOUR FINAL SCORE HERE</score>`;

// ---------------------------------------------------------------------------
// Compiled templates
// ---------------------------------------------------------------------------

let _xmlTemplate: Handlebars.TemplateDelegate | null = null;
let _diffFencedTemplate: Handlebars.TemplateDelegate | null = null;
let _createFileTemplate: Handlebars.TemplateDelegate | null = null;
let _diffJudgeTemplate: Handlebars.TemplateDelegate | null = null;

function getHbs(): ReturnType<typeof Handlebars.create> {
  return Handlebars.create();
}

function xmlTemplate(): Handlebars.TemplateDelegate {
  if (!_xmlTemplate) _xmlTemplate = getHbs().compile(EDIT_FILE_PROMPT_XML_TEMPLATE, { strict: false });
  return _xmlTemplate;
}

function diffFencedTemplate(): Handlebars.TemplateDelegate {
  if (!_diffFencedTemplate) _diffFencedTemplate = getHbs().compile(EDIT_FILE_PROMPT_DIFF_FENCED_TEMPLATE, { strict: false });
  return _diffFencedTemplate;
}

function createFileTemplate(): Handlebars.TemplateDelegate {
  if (!_createFileTemplate) _createFileTemplate = getHbs().compile(CREATE_FILE_PROMPT_TEMPLATE, { strict: false });
  return _createFileTemplate;
}

function diffJudgeTemplate(): Handlebars.TemplateDelegate {
  if (!_diffJudgeTemplate) _diffJudgeTemplate = getHbs().compile(DIFF_JUDGE_PROMPT_TEMPLATE, { strict: false });
  return _diffJudgeTemplate;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EditPromptData {
  /** File path being edited. */
  path?: string;
  /** Description of the edit to perform. */
  edit_description: string;
}

export interface DiffJudgeData {
  /** The diff to evaluate. */
  diff: string;
  /** The assertions to check. */
  assertions: string;
}

/**
 * Build an XML-format edit prompt.
 * Used by: Anthropic, OpenAI, and most other providers.
 */
export function buildXmlEditPrompt(data: EditPromptData): string {
  return xmlTemplate()(data);
}

/**
 * Build a diff-fenced edit prompt.
 * Used by: Google Gemini.
 */
export function buildDiffFencedEditPrompt(data: EditPromptData): string {
  return diffFencedTemplate()(data);
}

/**
 * Build a create file prompt.
 * Used when creating a new file from scratch.
 */
export function buildCreateFilePrompt(data: EditPromptData): string {
  return createFileTemplate()(data);
}

/**
 * Build a diff judge prompt.
 * Used for evaluating edit quality (eval/testing).
 */
export function buildDiffJudgePrompt(data: DiffJudgeData): string {
  return diffJudgeTemplate()(data);
}
