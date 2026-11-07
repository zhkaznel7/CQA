import {evaluateMock} from './mock.mjs';
import {startServer, fail} from './http.mjs';
const failures = {
  502: ['INVALID_MODEL_OUTPUT', 'Модель вернула некорректный результат.'],
  503: ['AI_UNAVAILABLE', 'Модель временно недоступна.'],
  504: ['AI_TIMEOUT', 'Истёк срок обработки запроса.']
};
const simulated = process.env.MOCK_ERROR_STATUS;
if (simulated && !Object.hasOwn(failures, simulated)) throw Error('MOCK_ERROR_STATUS: 502, 503 или 504');

startServer('CQA mock', input => {
  if (simulated) fail(Number(simulated), ...failures[simulated]);
  return evaluateMock(input);
});
