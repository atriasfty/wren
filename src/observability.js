import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';

let sdkInstance = null;

export function initObservability() {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.log('[observability] POSTHOG_API_KEY not set; tracing disabled');
    return;
  }

  console.log('[observability] OpenTelemetry tracing initialised (manual spans only)');

  sdkInstance = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'wren',
    }),
  });

  try {
    sdkInstance.start();
    console.log('[observability] OpenTelemetry SDK started');
  } catch (err) {
    console.error('[observability] Failed to start OpenTelemetry SDK:', err);
  }
}
