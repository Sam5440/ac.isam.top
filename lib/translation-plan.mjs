const MT_CHANNELS = ['deepl', 'youdao', 'caiyun', 'iflyrec'];

/** CI archive covers only the AI channel, never an explicitly selected MT provider. */
export function translationChannels({ mode, channel, priority, archived, official = false }) {
  if (mode === 'en' || official || channel === 'ai_custom') return [];
  if (mode === 'zh') return MT_CHANNELS.includes(channel) ? [channel] : [];
  const chain = priority?.length ? priority : ['ai', ...MT_CHANNELS];
  const archiveAt = archived ? chain.indexOf('ai') : -1;
  return (archiveAt >= 0 ? chain.slice(0, archiveAt) : chain).filter((id) => MT_CHANNELS.includes(id));
}
