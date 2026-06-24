import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PostHogSpanProcessor } from '@posthog/ai/otel';
import { initObservability } from '../observability.js';

vi.mock('@opentelemetry/sdk-node', () => {
  return {
    NodeSDK: vi.fn().mockImplementation(() => {
      return {
        start: vi.fn(),
      };
    }),
  };
});

vi.mock('@posthog/ai/otel', () => {
  return {
    PostHogSpanProcessor: vi.fn(),
  };
});

describe('initObservability', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does nothing if POSTHOG_API_KEY is not set', () => {
    delete process.env.POSTHOG_API_KEY;
    initObservability();
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('initializes NodeSDK and PostHogSpanProcessor with projectToken when POSTHOG_API_KEY is set', () => {
    process.env.POSTHOG_API_KEY = 'phc_test_api_key';
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
    initObservability();

    expect(PostHogSpanProcessor).toHaveBeenCalledWith({
      projectToken: 'phc_test_api_key',
      host: 'https://eu.i.posthog.com',
    });
    expect(NodeSDK).toHaveBeenCalled();
  });
});
