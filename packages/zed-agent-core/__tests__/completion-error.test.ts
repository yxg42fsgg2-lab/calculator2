/**
 * Tests for completion error mapping.
 * Ported from: crates/language_model/src/language_model.rs error tests
 */

import { describe, it, expect } from 'vitest';
import {
  completionErrorFromHttpStatus,
  completionErrorFromCloudFailure,
  parsePromptTooLong,
  PromptTooLargeError,
  RateLimitExceededError,
  ServerOverloadedError,
  BadRequestFormatError,
  AuthenticationError,
  PermissionError,
  ApiEndpointNotFoundError,
  ApiInternalServerError,
  HttpResponseError,
} from '../src/types/completion-error.js';
import { languageModelProviderName } from '../src/types/branded.js';

const provider = languageModelProviderName('TestProvider');

describe('completionErrorFromHttpStatus', () => {
  it('maps 400 to BadRequestFormat', () => {
    const err = completionErrorFromHttpStatus(provider, 400, 'bad request');
    expect(err).toBeInstanceOf(BadRequestFormatError);
    expect(err.code).toBe('bad_request_format');
  });

  it('maps 401 to Authentication', () => {
    const err = completionErrorFromHttpStatus(provider, 401, 'unauthorized');
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it('maps 403 to Permission', () => {
    const err = completionErrorFromHttpStatus(provider, 403, 'forbidden');
    expect(err).toBeInstanceOf(PermissionError);
  });

  it('maps 404 to ApiEndpointNotFound', () => {
    const err = completionErrorFromHttpStatus(provider, 404, 'not found');
    expect(err).toBeInstanceOf(ApiEndpointNotFoundError);
  });

  it('maps 413 to PromptTooLarge', () => {
    const err = completionErrorFromHttpStatus(provider, 413, 'prompt is too long: 50000 tokens');
    expect(err).toBeInstanceOf(PromptTooLargeError);
    expect((err as PromptTooLargeError).tokens).toBe(50000);
  });

  it('maps 429 to RateLimitExceeded', () => {
    const err = completionErrorFromHttpStatus(provider, 429, 'too many', 5000);
    expect(err).toBeInstanceOf(RateLimitExceededError);
    expect(err.retryAfter).toBe(5000);
  });

  it('maps 500 to ApiInternalServerError', () => {
    const err = completionErrorFromHttpStatus(provider, 500, 'internal error');
    expect(err).toBeInstanceOf(ApiInternalServerError);
  });

  it('maps 503 to ServerOverloaded', () => {
    const err = completionErrorFromHttpStatus(provider, 503, 'overloaded');
    expect(err).toBeInstanceOf(ServerOverloadedError);
  });

  it('maps 529 to ServerOverloaded', () => {
    const err = completionErrorFromHttpStatus(provider, 529, 'overloaded');
    expect(err).toBeInstanceOf(ServerOverloadedError);
  });

  it('maps unknown status to HttpResponseError', () => {
    const err = completionErrorFromHttpStatus(provider, 418, "I'm a teapot");
    expect(err).toBeInstanceOf(HttpResponseError);
    expect((err as HttpResponseError).statusCode).toBe(418);
  });
});

describe('parsePromptTooLong', () => {
  it('parses Anthropic format', () => {
    expect(parsePromptTooLong('prompt is too long: 150000 tokens > 100000 maximum')).toBe(150000);
  });

  it('returns undefined for non-matching message', () => {
    expect(parsePromptTooLong('some other error')).toBeUndefined();
  });
});

describe('completionErrorFromCloudFailure', () => {
  it('handles upstream_http_429 code', () => {
    const err = completionErrorFromCloudFailure(provider, 'upstream_http_429', 'rate limited');
    expect(err).toBeInstanceOf(RateLimitExceededError);
  });

  it('handles http_500 code', () => {
    const err = completionErrorFromCloudFailure(provider, 'http_500', 'server error');
    expect(err).toBeInstanceOf(ApiInternalServerError);
  });

  it('handles upstream_http_error with JSON body', () => {
    const body = JSON.stringify({ upstream_status: 503, message: 'overloaded' });
    const err = completionErrorFromCloudFailure(provider, 'upstream_http_error', body);
    expect(err).toBeInstanceOf(ServerOverloadedError);
  });

  it('handles prompt too long in message', () => {
    const err = completionErrorFromCloudFailure(
      provider,
      'some_code',
      'prompt is too long: 200000 tokens > 100000',
    );
    expect(err).toBeInstanceOf(PromptTooLargeError);
  });
});
