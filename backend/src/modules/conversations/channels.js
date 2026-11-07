// Compare known channel aliases in memory; never replace the stored source value.
const channels = new Map([
  ['chat', 'agent chat'], ['agent chat', 'agent chat'],
  ['voice', 'voice call'], ['call', 'voice call'], ['voice call', 'voice call'],
]);

export function canonicalChannel(channel) {
  return channels.get(channel) ?? channel;
}
