/**
 * invite-candidates 云函数 - 邀约候选名单（05.7 listCandidates 独立入口）
 * payload: { activityId, limit? }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'list', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action !== 'list') return { success: false, message: '未知 action: ' + action };
    const { activityId, limit } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };

    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可邀约' };

    const validCount = await db.collection('registrations').where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') }).count();
    const remaining = Math.max(0, act.data.maxPlayers - validCount.total);

    const myActs = await db.collection('activities').where({ organizerId: openid }).get();
    const ids = (myActs.data || []).map(a => a._id);
    const hist = await db.collection('registrations').where({ activityId: _.in(ids) }).get();
    const candidateIds = [...new Set((hist.data || []).map(r => r.userId))].filter(id => id !== openid && !/^(proxy_|agent_|cancelled_)/.test(id));
    const current = await db.collection('registrations').where({ activityId }).get();
    const joined = new Set((current.data || []).map(r => r.userId));
    const cands = candidateIds.filter(id => !joined.has(id)).slice(0, 10);

    const users = await db.collection('users').where({ openid: _.in(cands) }).get();
    const umap = {}; (users.data || []).forEach(u => umap[u.openid] = u);
    // 统计每个候选人的最近一次参与时间
    const lastJoinMap = {};
    (hist.data || []).forEach(r => {
      const ts = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      if (ts && (!lastJoinMap[r.userId] || ts > lastJoinMap[r.userId])) lastJoinMap[r.userId] = ts;
    });
    const fmtDate = (ts) => {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    };
    const list = cands.map(id => {
      const u = umap[id] || {};
      return {
        userId: id,
        nickname: u.nickname || '球友',
        level: u.level || 5,
        avatar: u.avatar || '',
        rating: u.rating != null ? u.rating : null,
        lastJoinTime: fmtDate(lastJoinMap[id]),
        reasons: ['你上次活动和你一起打过']
      };
    }).sort((a, b) => (b.nickname || '').localeCompare(a.nickname || ''));

    return { success: true, data: { remaining, candidates: list.slice(0, limit || 10) }, message: 'ok' };
  } catch (err) {
    logger.error('invite-candidates', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '候选名单失败' };
  }
};
