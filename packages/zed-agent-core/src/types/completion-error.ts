/**
 * Completion error types.
 * Ported from: crates/language_model/src/language_model.rs — LanguageModelCompletionError
 *
 * This is a 1:1 port of all 18 error variants with the full HTTP status mapping logic.
 */

import type { LanguageModelProviderName } from './branded.js';

/**
 * Base error class for all language model completion errors.
 * Each subclass corresponds to one variant of the Rust enum.
 */
export abstract class CompletionError extends Error {
  abstract readonly code: CompletionErrorCode;
  readonly retryAfter?: number; // milliseconds

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'CompletionError';
    this.retryAfter = retryAfter;
  }
}

export type CompletionErrorCode =
  | 'prompt_too_large'
  | 'no_api_key'
  | 'rate_limit_exceeded'
  | 'server_overloaded'
  | 'api_internal_server_error'
  | 'upstream_provider_error'
  | 'http_response_error'
  | 'bad_request_format'
  | 'authentication_error'
  | 'permission_error'
  | 'api_endpoint_not_found'
  | 'api_read_response_error'
  | 'serialize_request'
  | 'build_request_body'
  | 'http_send'
  | 'deserialize_response'
  | 'payment_required'
  | 'other';

// ---------------------------------------------------------------------------
// Individual error classes — one per Rust variant
// ---------------------------------------------------------------------------

export class PromptTooLargeError extends CompletionError {
  readonly code = 'prompt_too_large' as const;
  readonly tokens?: number;

  constructor(tokens?: number) {
    super('prompt too large for context window');
    this.tokens = tokens;
  }
}

export class NoApiKeyError extends CompletionError {
  readonly code = 'no_api_key' as const;
  readonly provider: LanguageModelProviderName;

  constructor(provider: LanguageModelProviderName) {
    super(`missing ${provider} API key`);
    this.provider = provider;
  }
}

export class RateLimitExceededError extends CompletionError {
  readonly code = 'rate_limit_exceeded' as const;
  readonly provider: LanguageModelProviderName;

  constructor(provider: LanguageModelProviderName, retryAfter?: number) {
    super(`${provider}'s API rate limit exceeded`);
    this.provider = provider;
    (this as { retryAfter?: number }).retryAfter = retryAfter;
  }
}

export class ServerOverloadedError extends CompletionError {
  readonly code = 'server_overloaded' as const;
  readonly provider: LanguageModelProviderName;

  constructor(provider: LanguageModelProviderName, retryAfter?: number) {
    super(`${provider}'s API servers are overloaded right now`);
    this.provider = provider;
    (this as { retryAfter?: number }).retryAfter = retryAfter;
  }
}

export class ApiInternalServerError extends CompletionError {
  readonly code = 'api_internal_server_error' as const;
  readonly provider: LanguageModelProviderName;

  constructor(provider: LanguageModelProviderName, message: string) {
    super(`${provider}'s API server reported an internal server error: ${message}`);
    this.provider = provider;
  }
}

export class UpstreamProviderError extends CompletionError {
  readonly code = 'upstream_provider_error' as const;
  readonly statusCode: number;

  constructor(message: string, statusCode: number, retryAfter?: number) {
    super(message);
    this.statusCode = statusCode;
    (this as { retryAfter?: number }).retryAfter = retryAfter;
  }
}

export class HttpResponseError extends CompletionError {
  readonly code = 'http_response_error' as const;
  readonly provider: LanguageModelProviderName;
  readonly statusCode: number;

  constructor(provider: LanguageModelProviderName, statusCode: number, message: string) {
    super(`HTTP response error from ${provider}'s API: status ${statusCode} - ${message}`);
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

export class BadRequestFormatError extends CompletionError {
  readonly code = 'bad_request_format' as const;
  readonly provider: LanguageModelProviderName;

  constructor(provider: LanguageModelProviderName, message: string) {
    super(`invalid request format to ${provider}'s API: ${message}`);
    this.provider = provider;
  }
}

export class AuthenticationError extends CompletionError {
  readonly code = 'authentication_error' as const;
  readonly provider: LanguageModelProviderName;

  constructor(provider: LanguageModelProviderName, message: string) {
    super(`authentication error with ${provider}'s API: ${message}`);
    this.provider = provider;
  }
}

export class PermissionError extends CompletionError {
  readonly code = 'permission_error' as const;
  readonly provider: LanguageModelProviderName;

  constructor(provider: LanguageModelProviderName, message: string) {
    super(`Permission error with ${provider}'s API: ${message}`);
    this.provider = provider;
  }
}

export class ApiEndpointNotFoundError extends CompletionError {
  readonly code = 'api_endpoint_not_found' as const;
  readonly provider: LanguageModelProviderName;

  constructor(provider: LanguageModelProviderName) {
    super('language model provider API endpoint not found');
    this.provider = provider;
  }
}

export class ApiReadResponseError extends CompletionError {
  readonly code = 'api_read_response_error' as const;
  readonly provider: LanguageModelProviderName;
  readonly cause: Error;

  constructor(provider: LanguageModelProviderName, cause: Error) {
    super(`I/O error reading response from ${provider}'s API`);
    this.provider = provider;
    this.cause = cause;
  }
}

export class SerializeRequestError extends CompletionError {
  readonly code = 'serialize_request' as const;
  readonly provider: LanguageModelProviderName;
  readonly cause: Error;

  constructor(provider: LanguageModelProviderName, cause: Error) {
    super(`error serializing request to ${provider} API`);
    this.provider = provider;
    this.cause = cause;
  }
}

export class BuildRequestBodyError extends CompletionError {
  readonly code = 'build_request_body' as const;
  readonly provider: LanguageModelProviderName;
  readonly cause: Error;

  constructor(provider: LanguageModelProviderName, cause: Error) {
    super(`error building request body to ${provider} API`);
    this.provider = provider;
    this.cause = cause;
  }
}

export class HttpSendError extends CompletionError {
  readonly code = 'http_send' as const;
  readonly provider: LanguageModelProviderName;
  readonly cause: Error;

  constructor(provider: LanguageModelProviderName, cause: Error) {
    super(`error sending HTTP request to ${provider} API`);
    this.provider = provider;
    this.cause = cause;
  }
}

export class DeserializeResponseError extends CompletionError {
  readonly code = 'deserialize_response' as const;
  readonly provider: LanguageModelProviderName;
  readonly cause: Error;

  constructor(provider: LanguageModelProviderName, cause: Error) {
    super(`error deserializing ${provider} API response`);
    this.provider = provider;
    this.cause = cause;
  }
}

export class PaymentRequiredError extends CompletionError {
  readonly code = 'payment_required' as const;

  constructor(message: string) {
    super(message);
  }
}

export class OtherCompletionError extends CompletionError {
  readonly code = 'other' as const;
  readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Error factory from HTTP status — ported from from_http_status()
// ---------------------------------------------------------------------------

/**
 * Create a CompletionError from an HTTP status code.
 * Ported from: LanguageModelCompletionError::from_http_status()
 */
export function completionErrorFromHttpStatus(
  provider: LanguageModelProviderName,
  statusCode: number,
  message: string,
  retryAfter?: number,
): CompletionError {
  switch (statusCode) {
    case 400:
      return new BadRequestFormatError(provider, message);
    case 401:
      return new AuthenticationError(provider, message);
    case 403:
      return new PermissionError(provider, message);
    case 404:
      return new ApiEndpointNotFoundError(provider);
    case 413:
      return new PromptTooLargeError(parsePromptTooLong(message));
    case 429:
      return new RateLimitExceededError(provider, retryAfter);
    case 500:
      return new ApiInternalServerError(provider, message);
    case 503:
      return new ServerOverloadedError(provider, retryAfter);
    case 529:
      // Unofficial "service overloaded" status. See https://http.dev/529
      return new ServerOverloadedError(provider, retryAfter);
    default:
      return new HttpResponseError(provider, statusCode, message);
  }
}

/**
 * Create a CompletionError from a Zed Cloud failure response.
 * Ported from: LanguageModelCompletionError::from_cloud_failure()
 */
export function completionErrorFromCloudFailure(
  upstreamProvider: LanguageModelProviderName,
  code: string,
  message: string,
  retryAfter?: number,
): CompletionError {
  const tokens = parsePromptTooLong(message);
  if (tokens !== undefined) {
    return new PromptTooLargeError(tokens);
  }

  if (code === 'upstream_http_error') {
    const parsed = parseUpstreamErrorJson(message);
    if (parsed) {
      return completionErrorFromHttpStatus(
        upstreamProvider,
        parsed.upstreamStatus,
        parsed.message,
        retryAfter,
      );
    }
    return new OtherCompletionError(
      `completion request failed, code: ${code}, message: ${message}`,
    );
  }

  // Try parsing "upstream_http_NNN" codes
  const upstreamMatch = code.match(/^upstream_http_(\d+)$/);
  if (upstreamMatch) {
    const statusCode = parseInt(upstreamMatch[1]!, 10);
    return completionErrorFromHttpStatus(upstreamProvider, statusCode, message, retryAfter);
  }

  // Try parsing "http_NNN" codes
  const httpMatch = code.match(/^http_(\d+)$/);
  if (httpMatch) {
    const statusCode = parseInt(httpMatch[1]!, 10);
    return completionErrorFromHttpStatus(upstreamProvider, statusCode, message, retryAfter);
  }

  return new OtherCompletionError(
    `completion request failed, code: ${code}, message: ${message}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Try to parse token count from Anthropic's "prompt too long" error message.
 * Ported from: anthropic::parse_prompt_too_long
 */
export function parsePromptTooLong(message: string): number | undefined {
  // Anthropic format: "prompt is too long: NNN tokens > MMM maximum"
  const match = message.match(/prompt is too long:\s*(\d+)\s*tokens/i);
  if (match) {
    return parseInt(match[1]!, 10);
  }
  return undefined;
}

function parseUpstreamErrorJson(
  message: string,
): { upstreamStatus: number; message: string } | null {
  try {
    const json = JSON.parse(message) as Record<string, unknown>;
    const upstreamStatus = json['upstream_status'];
    if (typeof upstreamStatus !== 'number') return null;
    const innerMessage =
      typeof json['message'] === 'string' ? json['message'] : message;
    return { upstreamStatus, message: innerMessage };
  } catch {
    return null;
  }
}
