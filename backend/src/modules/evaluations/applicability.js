/** Confirmation rows are written only by a trusted operator/import integration, never by AI/API callers. */
export function confirmApplicability(criterion, conversation, checklist, confirmations) {
  if (!criterion.allowNa || criterion.type === 'flag') return false;
  const rule = criterion.applicabilityRule;
  const expected = rule?.kind ?? 'verified_condition';
  if (rule && (!rule.channels.includes(conversation.channel) || !['voice', 'call'].includes(conversation.channel))) return false;
  return confirmations.some((confirmation) => confirmation.conversationId === conversation.id
    && confirmation.checklistId === checklist.id && confirmation.criterionKey === criterion.key
    && confirmation.rule === expected && confirmation.reference?.trim() && confirmation.confirmedBy?.trim());
}
