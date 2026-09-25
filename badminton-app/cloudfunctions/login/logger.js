/**
 * 结构化 JSON logger（白名单字段，禁止 openid/phone/nickname）
 */
const SAFE = ['activityId', 'matchId', 'userId', 'action', 'code', 'ms', 'ok', 'count', 'collection', 'status'];
function build(level, fn, action, extra) {
  const out = { t: new Date().toISOString(), level: level, fn: fn, action: action || '-' };
  if (extra && typeof extra === 'object') {
    for (var i = 0; i < SAFE.length; i++) {
      var k = SAFE[i];
      if (extra[k] !== undefined) out[k] = extra[k];
    }
    if (extra.err) {
      out.msg = String((extra.err && extra.err.message) || extra.err);
      out.stack = String((extra.err && extra.err.stack) || '').split('\n').slice(0, 5).join('\n');
    }
  }
  return JSON.stringify(out);
}
module.exports = {
  info: function(fn, action, extra) { console.log(build('info', fn, action, extra)); },
  error: function(fn, action, extra) { console.error(build('error', fn, action, extra)); }
};
