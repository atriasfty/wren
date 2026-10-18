import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';

let sdkInstance = null;

export function initObservability() {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.log('[observability] POSTHOG_API_KEY not set; tracing disabled');
    return;
  }

  sdkInstance = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'wren',
    }),
  });

  try {
    sdkInstance.start();
    // NodeSDK picks its exporter from the standard OTEL_EXPORTER_OTLP_* env
    // vars; without an endpoint configured it targets localhost:4318.
    const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    console.log(`[observability] OpenTelemetry SDK started (OTLP endpoint: ${endpoint || 'default localhost:4318'})`);
  } catch (err) {
    console.error('[observability] Failed to start OpenTelemetry SDK:', err);
  }
}


export async function shutdownObservability() {
  if (!sdkInstance) return;
  try {
    await sdkInstance.shutdown();
  } catch (err) {
    console.error('[observability] shutdown failed:', err.message);
  }
}
