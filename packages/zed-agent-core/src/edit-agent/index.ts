/**
 * @module edit-agent
 * The EditAgent sub-system for streaming file edits.
 */

export { EditAgent } from './edit-agent.js';
export type { EditAgentOutput, EditAgentOptions } from './edit-agent.js';

export { EditParser, editFormatForModel } from './edit-parser.js';
export type { EditFormat, EditParserEvent, EditParserMetrics } from './edit-parser.js';

export { CreateFileParser } from './create-file-parser.js';
export type { CreateFileParserEvent } from './create-file-parser.js';

export { StreamingFuzzyMatcher } from './streaming-fuzzy-matcher.js';

export { computeLineDiff, formatDiff } from './streaming-diff.js';
export type { DiffOperation } from './streaming-diff.js';
