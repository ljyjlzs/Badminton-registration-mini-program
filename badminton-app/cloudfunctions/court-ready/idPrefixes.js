const SYNTHETIC_ID_PREFIXES = ['proxy_', 'agent_', 'cancelled_'];
function isSyntheticId(id) {
  return SYNTHETIC_ID_PREFIXES.some(p => String(id || '').startsWith(p));
}
module.exports = { SYNTHETIC_ID_PREFIXES, isSyntheticId };
