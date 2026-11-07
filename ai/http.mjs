import http from 'node:http';
const hasText = value => typeof value === 'string' && value.trim().length > 0;
export function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function validate(input) {
  const { conversation_id, channel, language, transcript, checklist } = input ?? {};
  if (!hasText(conversation_id) || !['RU', 'KZ', 'EN'].includes(language) ||
      !['agent chat', 'voice call'].includes(channel)) {
    fail(422, 'INVALID_CONVERSATION', 'Проверьте conversation_id, channel и language.');
  }
  if (!Array.isArray(transcript) || !transcript.length || transcript.some((t, i) =>
    t?.turnIndex !== i || !hasText(t.timestamp) || !hasText(t.text) ||
    !['operator', 'client', 'system', 'bot'].includes(t.speaker))) {
    fail(422, 'INVALID_TRANSCRIPT', 'Нужны реплики с исходным текстом, временем, ролью и последовательным turnIndex от нуля.');
  }
  if (!hasText(checklist?.id) || !hasText(checklist.key) || !Number.isInteger(checklist.version) ||
      checklist.version < 1 || !Array.isArray(checklist.instructions) || !Array.isArray(checklist.sections) ||
      !Array.isArray(checklist.criteria) || !checklist.criteria.length) {
    fail(422, 'INVALID_CHECKLIST', 'Нужен полный снимок версии чек-листа.');
  }
  const keys = new Set();
  checklist.criteria.forEach(c => {
    if (!hasText(c?.key) || keys.has(c.key) || !hasText(c.description) ||
        !['boolean', 'flag', 'scale'].includes(c.type) || typeof c.allowNa !== 'boolean' ||
        (c.allowNa && (c.type === 'flag' || !hasText(c.naCondition)))) {
      fail(422, 'INVALID_CHECKLIST', 'Проверьте ключи, типы, формулировки и условия N/A.');
    }
    keys.add(c.key);
    if (c.type === 'scale' && (!Array.isArray(c.scaleSteps) || c.scaleSteps.length < 2 ||
        c.scaleSteps.some(step => !Number.isFinite(step?.value) || !hasText(step.label)))) {
      fail(422, 'INVALID_CHECKLIST', 'Нужны числовые ступени с описаниями.');
    }
  });
}
export function startServer(label, evaluate) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method !== 'POST' || req.url !== '/v1/evaluations') fail(404, 'NOT_FOUND', 'POST /v1/evaluations');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) fail(413, 'BODY_TOO_LARGE', 'Лимит тела запроса — 4 MiB.');
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { fail(400, 'INVALID_JSON', 'Некорректный JSON.'); }
      validate(input);
      const results = await evaluate(input);
      send(200, {conversation_id: input.conversation_id, checklist_id: input.checklist.id, checklist_version: input.checklist.version, results});
    } catch (err) {
      send(err.status ?? 500, { error: { code: err.status ? err.code : 'INTERNAL_ERROR',
        message: err.status ? err.message : 'Ошибка AI-сервиса.', retryable: [503, 504].includes(err.status) } });
    }
  });
  server.requestTimeout = 90000;
  server.listen(Number(process.env.PORT ?? 8001), process.env.HOST ?? '127.0.0.1', () => console.log(label + " on port", server.address().port));
}
