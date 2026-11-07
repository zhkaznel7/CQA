import { z } from 'zod';

// Reserved for rows created before groups were recorded; never infer DEV provenance.
export const legacyGroupId = '__legacy__';
export const groupIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

/** Bind one export to one organizer group without adding fields to official JSON. */
export function exportGroupId(payload, requested, dataset) {
  const declared = payload?.data?.dataset_group_id;
  const groupId = groupIdSchema.parse(requested ?? declared ?? (dataset === 'dev' ? 'DEV' : undefined));
  if (declared !== undefined && declared !== groupId) throw new Error('Export group differs from source manifest');
  if ((dataset === 'dev') !== (groupId === 'DEV')) throw new Error('DEV and control groups must use their own dataset split');
  return groupId;
}
