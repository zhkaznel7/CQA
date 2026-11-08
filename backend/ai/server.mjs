import {startServer} from './http.mjs';
import {evaluateGemini} from './gemini.mjs';
import {evaluateLocal, LOCAL_MODEL} from './local.mjs';

const provider = process.env.AI_PROVIDER || 'local';
if (provider === 'local') {
  startServer({mode: 'local', name: LOCAL_MODEL}, evaluateLocal);
} else if (provider === 'gemini') {
  const key = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!key || !/^[A-Za-z0-9._-]{1,120}$/.test(model ?? '')) {
    throw Error('Для AI_PROVIDER=gemini задайте GEMINI_API_KEY и идентификатор модели GEMINI_MODEL.');
  }
  const onUsage = usage => console.log(JSON.stringify({event:'model_usage', model, ...usage}));
  startServer({mode: 'external_api', name: model}, async input => {
    try {
      return await evaluateGemini(input, {key, model, onUsage});
    } catch (error) {
      if (error.code === 'INVALID_MODEL_OUTPUT') {
        console.warn(JSON.stringify({event: 'invalid_model_output', model, reason: error.message}));
      }
      throw error;
    }
  });
} else {
  throw Error('AI_PROVIDER должен быть local или gemini.');
}
