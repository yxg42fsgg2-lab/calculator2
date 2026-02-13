/**
 * @module types
 * Complete type system for zed-agent-core.
 * All types are re-exported from this module for convenient access.
 */

// Branded ID types
export type {
  LanguageModelId,
  LanguageModelName,
  LanguageModelProviderId,
  LanguageModelProviderName,
  LanguageModelToolUseId,
  SessionId,
  TerminalId,
  ToolCallId,
  UserMessageId,
  PromptId,
  AgentProfileId,
} from './branded.js';

export {
  languageModelId,
  languageModelName,
  languageModelProviderId,
  languageModelProviderName,
  toolUseId,
  sessionId,
  terminalId,
  toolCallId,
  userMessageId,
  promptId,
  agentProfileId,
} from './branded.js';

// Language model types
export type {
  Role,
  StopReason,
  TokenUsage,
  ImageSize,
  LanguageModelImage,
  LanguageModelToolUse,
  LanguageModelToolResult,
  LanguageModelToolResultContent,
  MessageContent,
  LanguageModelRequestMessage,
  LanguageModelRequestTool,
  LanguageModelToolChoice,
  LanguageModelToolSchemaFormat,
  LanguageModelRequest,
  CompletionIntent,
  LanguageModelCompletionEvent,
  LanguageModelEffortLevel,
  LanguageModelResponseMessage,
} from './language-model.js';

export {
  emptyTokenUsage,
  addTokenUsage,
  totalTokens,
  ANTHROPIC_IMAGE_SIZE_LIMIT,
  DEFAULT_IMAGE_MAX_BYTES,
  estimateImageTokens,
  textToolResult,
  imageToolResult,
  toolResultContentIsEmpty,
  toolResultContentToString,
} from './language-model.js';

// Completion error types
export {
  CompletionError,
  PromptTooLargeError,
  NoApiKeyError,
  RateLimitExceededError,
  ServerOverloadedError,
  ApiInternalServerError,
  UpstreamProviderError,
  HttpResponseError,
  BadRequestFormatError,
  AuthenticationError,
  PermissionError,
  ApiEndpointNotFoundError,
  ApiReadResponseError,
  SerializeRequestError,
  BuildRequestBodyError,
  HttpSendError,
  DeserializeResponseError,
  PaymentRequiredError,
  OtherCompletionError,
  completionErrorFromHttpStatus,
  completionErrorFromCloudFailure,
  parsePromptTooLong,
} from './completion-error.js';

export type { CompletionErrorCode } from './completion-error.js';

// Tool types
export type {
  ToolKind,
  ToolCallStatus,
  ToolCallLocation,
  ToolCallContent,
  ToolCall,
  ToolCallUpdateFields,
  ToolCallUpdate,
  PermissionOptionKind,
  PermissionOption,
  PermissionOptionChoice,
  PermissionOptions,
  ToolPermissionContext,
  AgentToolOutput,
  ToolContext,
  ToolCallEventStream,
  AgentTool,
  AnyAgentTool,
} from './tools.js';

export { eraseToolType, MAX_TOOL_NAME_LENGTH } from './tools.js';

// Thread types
export type {
  MentionUri,
  UserMessageContent,
  UserMessage,
  AgentMessageContent,
  AgentMessage,
  Message,
  SubagentContext,
  RetryStrategy,
  RetryStatus,
  AcpTokenUsage,
  DbLanguageModel,
  DbThread,
  DbThreadMetadata,
  ProjectSnapshot,
} from './thread.js';

export {
  emptyAgentMessage,
  MAX_SUBAGENT_DEPTH,
  MAX_PARALLEL_SUBAGENTS,
  MAX_RETRY_ATTEMPTS,
  BASE_RETRY_DELAY_MS,
} from './thread.js';

// Event types
export type {
  UserMessageEvent,
  AgentTextEvent,
  AgentThinkingEvent,
  ToolCallEvent,
  ToolCallUpdateEvent,
  ToolCallAuthorizationEvent,
  SubagentSpawnedEvent,
  RetryEvent,
  StopEvent,
  ErrorEvent,
  TitleUpdatedEvent,
  TokenUsageUpdatedEvent,
  SessionListUpdatedEvent,
  AgentEvent,
} from './events.js';

// Host interface types
export type {
  BackendHost,
  FileSystem,
  DirectoryEntry,
  GrepOptions,
  GrepMatch,
  GrepResult,
  FindPathOptions,
  FindPathResult,
  FileOutlineEntry,
  FileOutline,
  FileBuffer,
  TerminalProvider,
  TerminalOptions,
  TerminalExitStatus,
  TerminalOutput,
  TerminalHandle,
  ProjectInfo,
  RulesFile,
  WorkspaceRoot,
  UserRules,
  PermissionDecision,
  PermissionRequest,
  PermissionResponse,
  ToolPermissionRules,
  PermissionHandler,
  EventSink,
  HttpOptions,
  HttpResponse,
  HttpClient,
  DiagnosticSeverity,
  Diagnostic,
  DiagnosticsProvider,
  WebSearchResult,
  WebSearchProvider,
  Disposable,
} from './host.js';

// Settings types
export type {
  LanguageModelSelection,
  AgentProfileSettings,
  ToolPermissionMode,
  AgentSettings,
} from './settings.js';

export {
  defaultAgentProfileSettings,
  SUMMARIZE_THREAD_PROMPT,
  SUMMARIZE_THREAD_DETAILED_PROMPT,
  temperatureForModel,
} from './settings.js';
