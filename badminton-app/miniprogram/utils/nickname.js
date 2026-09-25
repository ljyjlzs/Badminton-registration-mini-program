/**
 * 昵称映射工具（BUG-60）
 * 从 get-activity-detail 的 registrations 建 userId → nickname，
 * 给评论/照片列表的 nickname 与 c.replies[].nickname 赋值。
 * 约定：就地赋值并返回同一个 list；失败时降级原样返回（展示层兜底"匿名"），不 reject。
 */
var callFunction = require('./request.js').callFunction;

function mapNicknames(activityId, list) {
  if (!list || list.length === 0) {
    return Promise.resolve(list || []);
  }
  return callFunction('get-activity-detail', 'detail', { activityId: activityId }).then(function(res) {
    var regs = (res && res.data && res.data.registrations) || [];
    var nameMap = {};
    regs.forEach(function(r) {
      if (r && r.userId) nameMap[r.userId] = r.nickname;
    });
    list.forEach(function(c) {
      if (!c) return;
      c.nickname = nameMap[c.userId || c.uploadedBy] || '匿名';
      (c.replies || []).forEach(function(reply) {
        if (!reply) return;
        reply.nickname = nameMap[reply.userId || reply.uploadedBy] || '匿名';
      });
    });
    return list;
  }).catch(function(err) {
    console.warn('昵称映射失败，降级为匿名展示', err && err.message);
    return list;
  });
}

module.exports = { mapNicknames: mapNicknames };
