import { canonicalChannel } from '../conversations/channels.js';
import { confirmsIdentityNotRequired } from './identity-applicability.js';

/** Validate an explicitly recorded fact, independently of automatic transcript policies. */
export function confirmRecordedApplicability(criterion, conversation, checklist, confirmations) {
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

/** Facts come from a conservative source-transcript policy or trusted immutable rows, never AI claims. */
export function confirmApplicability(criterion, conversation, checklist, confirmations) {
  return confirmRecordedApplicability(criterion, conversation, checklist, confirmations)
    || confirmsIdentityNotRequired(criterion, conversation);
}
