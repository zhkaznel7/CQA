// Local demonstration only. The production service will own decisions and totals.
export function mountAppeals(container, { evaluationId, criterionId, original, scale, template }) {
  const key = JSON.stringify(['sqa-appeal-v1', evaluationId, criterionId]);
  container.replaceChildren(template.content.cloneNode(true));
  const find = selector => container.querySelector(selector);
  const request = find('[data-request]');
  const review = find('[data-review]');
  const message = find('[role=status]');
  const { action, score, reason } = review.elements;
  function format(value) { return value + ' / ' + Math.max(...scale); }
  find('[data-original]').textContent = format(original);
  for (const value of scale) score.add(new Option(String(value), String(value)));
  score.value = String(original);

  function read() {
    return JSON.parse(localStorage.getItem(key));
  }

  function render(appeal) {
    const decision = appeal?.decision;
    request.hidden = Boolean(appeal);
    review.hidden = !appeal || Boolean(decision);
    find('[data-history]').hidden = !appeal;
    find('[data-final]').textContent = decision ? format(decision.score) : '—';
    find('[data-status]').textContent = decision ? 'Рассмотрено' : 'Ожидает решения';
    find('[data-comment]').textContent = appeal?.comment || '';
    find('[data-reason]').textContent = decision
      ? (decision.action === 'confirm' ? 'Подтверждено. ' : 'Изменено. ') + decision.reason : '';
  }

  function save(build) {
    try {
      const current = read();
      const next = build(current);
      if (next) localStorage.setItem(key, JSON.stringify(next));
      render(next || current);
      message.textContent = next ? 'Сохранено.' : 'Обращение уже обновлено.';
    } catch {
      message.textContent = 'Не удалось сохранить. Проверьте доступ к хранилищу браузера и повторите попытку.';
    }
  }

  request.onsubmit = event => {
    event.preventDefault();
    const comment = request.elements.comment.value.trim();
    if (!comment) { message.textContent = 'Введите комментарий.'; return; }
    save(current => current ? null : { comment, decision: null });
  };

  action.onchange = () => { find('[data-score-field]').hidden = action.value !== 'change'; };
  review.onsubmit = event => {
    event.preventDefault();
    const explanation = reason.value.trim();
    if (!explanation) { message.textContent = 'Укажите причину решения.'; return; }
    const value = action.value === 'confirm' ? original : Number(score.value);
    if (action.value === 'change' && (value === original || !scale.includes(value))) {
      message.textContent = 'Выберите новый балл по шкале критерия.';
      return;
    }
    save(current => !current || current.decision ? null : {
      ...current, decision: { action: action.value, score: value, reason: explanation }
    });
  };

  try { render(read()); }
  catch {
    request.hidden = true;
    message.textContent = 'Не удалось прочитать сохранённую апелляцию в этом браузере.';
  }
}
