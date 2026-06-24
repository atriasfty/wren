import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PostHogSpanProcessor } from '@posthog/ai/otel';

let sdkInstance = null;

export function initObservability() {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.log('[observability] POSTHOG_API_KEY not set; tracing disabled');
    return;
  }
  const host = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

  console.log(`[observability] Initializing PostHog AI Observability with host ${host}`);

  sdkInstance = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'wren',
    }),
    spanProcessors: [
      new PostHogSpanProcessor({
        projectToken: apiKey,
        host,
      }),
    ],
  });

  try {
    sdkInstance.start();
    console.log('[observability] PostHog AI Observability tracing started successfully');
  } catch (err) {
    console.error('[observability] Failed to start OpenTelemetry SDK:', err);
  }
}
