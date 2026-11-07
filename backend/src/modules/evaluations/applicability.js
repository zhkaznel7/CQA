import { canonicalChannel } from '../conversations/channels.js';

/** Confirmation rows are written only by a trusted operator/import integration, never by AI/API callers. */
export function confirmApplicability(criterion, conversation, checklist, confirmations) {
  if (!criterion.allowNa || criterion.type === 'flag') return false;
  const rule = criterion.applicabilityRule;
  const expected = rule?.kind ?? 'verified_condition';
  if (rule) {
    const channel = canonicalChannel(conversation.channel);
    if (channel !== 'voice call' || !rule.channels.some((allowed) => canonicalChannel(allowed) === channel)) return false;
  }
  return confirmations.some((confirmation) => confirmation.conversationId === conversation.id
    && confirmation.checklistId === checklist.id && confirmation.criterionKey === criterion.key
    && confirmation.rule === expected && confirmation.reference?.trim() && confirmation.confirmedBy?.trim());
}
