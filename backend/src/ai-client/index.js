import { aiConfigSchema } from './ai-config.js';
import { createHttpAiClient } from './http-client.js';
import { createMockAiClient } from './mock-client.js';

export function createAiClient(config, fetchImplementation) {
  const settings = aiConfigSchema.parse(config);
  return settings.AI_MODE === 'mock'
    ? createMockAiClient({ scenario: settings.AI_MOCK_SCENARIO })
    : createHttpAiClient(settings, fetchImplementation);
}
