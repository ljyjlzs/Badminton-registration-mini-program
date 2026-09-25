/**
 * invite 云函数 - 候补/好友邀约
 * 对齐 InviteServiceImpl（05.7）：listCandidates / generateInvites
 * payload: { action: 'listCandidates'|'generateInvites', activityId, limit?, candidateIds? }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
// ARCH-01: 共享 AI 模块（由 sync-shared.js 复制到本目录，必须本地 require）
const { callAIJson } = require('./ai.js');
const { rateLimit } = require('./rateLimit.js');
const { ratingOfLevel } = require('./rating.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const SYSTEM_PROMPT = `你是羽毛球活动邀约助手。根据活动信息和候选球员生成个性化邀请语，只输出 JSON。字段：invites = [{ userId, nickname, content(40字内) }]。没有候选球员时生成 1 条通用邀约，userId 和 nickname 用 null。要求：中文、不用 emoji；时间地点人数必须来自活动信息，禁止编造；内容自然口语化，像组织者直接邀请朋友。`;
const TEMPLATE = '{nickname}，{M月d日}{HH:mm}在{location}打羽毛球，还差{n}人，来吗？';

async function loadCandidates(activityId, openid) {
  const act = await db.collection('activities').doc(activityId).get();
  if (!act.data) throw new Error('活动不存在');
  if (act.data.organizerId !== openid) throw new Error('仅组织者可邀约');
  const validCount = await db.collection('registrations').where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') }).count();
  const remaining = Math.max(0, act.data.maxPlayers - validCount.total);
  if (remaining <= 0) throw new Error('活动已满员，无需邀约');

  const myActs = await db.collection('activities').where({ organizerId: openid }).get();
  const ids = (myActs.data || []).map(a => a._id);
  const hist = await db.collection('registrations').where({ activityId: _.in(ids) }).get();
  const candidateIds = [...new Set((hist.data || []).map(r => r.userId))].filter(id => id !== openid && !/^(proxy_|agent_|cancelled_)/.test(id));
  const current = await db.collection('registrations').where({ activityId }).get();
  const joined = new Set((current.data || []).map(r => r.userId));
  const cands = candidateIds.filter(id => !joined.has(id)).slice(0, 10);

  const users = await db.collection('users').where({ openid: _.in(cands) }).get();
  const umap = {}; (users.data || []).forEach(u => umap[u.openid] = u);
  const regsMap = {};
  (current.data || []).forEach(r => { if (!regsMap[r.userId]) regsMap[r.userId] = r; });
  // AI-49: 统计每个候选人的最近一次参与时间（参考 invite-candidates 写法）
  const lastJoinMap = {};
  (hist.data || []).forEach(r => {
    const ts = r.createdAt ? new Date(r.createdAt).getTime() : (r.joinedAt ? new Date(r.joinedAt).getTime() : 0);
    if (ts && (!lastJoinMap[r.userId] || ts > lastJoinMap[r.userId])) lastJoinMap[r.userId] = ts;
  });
  const fmtDate = (ts) => {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const avgLevel = current.data && current.data.length ? current.data.reduce((a, r) => a + (r.level || 5), 0) / current.data.length : 5;
  const avgRounded = Math.round(avgLevel);
  const targetRating = ratingOfLevel(avgRounded);

  const list = cands.map(id => {
    const u = umap[id] || {};
    const lvl = u.level || 5;
    const estRating = u.rating != null ? u.rating : ratingOfLevel(lvl);
    const reasons = ['你上次活动和你一起打过'];
    if (Math.abs(lvl - avgRounded) <= 2 || Math.abs(estRating - targetRating) <= 200) reasons.push('水平接近');
    return {
      userId: id,
      nickname: u.nickname || '球友',
      level: lvl,
      avatar: u.avatar || '',
      rating: u.rating != null ? u.rating : null,
      lastJoinTime: lastJoinMap[id] ? fmtDate(lastJoinMap[id]) : null,
      reasons
    };
  });
  list.sort((a, b) => (b.nickname || '').localeCompare(a.nickname || ''));
  return { remaining, candidates: list };
}

exports.main = async (event, context) => {
  const { action = 'listCandidates', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  // COST-07: 限流 20 次/分钟
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };
  try {
    // AI-8: 解构并使用 candidateIds（按用户勾选的候选人过滤）
    const { activityId, candidateIds } = payload;
    const pickSelected = (candidates) => {
      if (!Array.isArray(candidateIds) || candidateIds.length === 0) return candidates;
      const idSet = new Set(candidateIds.map(String));
      return candidates.filter(c => idSet.has(String(c.userId)));
    };
    if (action === 'listCandidates') {
      const { remaining, candidates } = await loadCandidates(activityId, openid);
      const limit = Math.min(payload.limit || 10, 10);
      return { success: true, data: { remaining, candidates: pickSelected(candidates).slice(0, limit) }, message: 'ok' };
    }
    if (action === 'generateInvites') {
      const { remaining, candidates: allCandidates } = await loadCandidates(activityId, openid);
      const candidates = pickSelected(allCandidates);
      const act = await db.collection('activities').doc(activityId).get();
      const a = act.data;
      const d = new Date(a.time);
      const mdy = (d.getMonth() + 1) + '月' + d.getDate() + '日';
      const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      let invites;
      let aiUsed = true;
      try {
        const user = `活动：${a.name}\n时间：${mdy} ${hm}\n地点：${a.location}\n还差${remaining}人\n候选：` + candidates.map(c => c.nickname).join('、');
        const r = await callAIJson(SYSTEM_PROMPT, user);
        // AI-8: AI 结果校验 —— 候选 ID 白名单过滤 + 数量上限，防止幻觉 ID
        const whitelist = new Set(candidates.map(c => String(c.userId)));
        invites = (Array.isArray(r.invites) ? r.invites : [])
          .slice(0, 20)
          .map(it => ({ userId: it.userId || null, nickname: it.nickname || null, content: it.content }))
          .filter(it => it.userId == null || whitelist.has(String(it.userId)));
        if (invites.length === 0) throw new Error('empty');
      } catch (e) {
    logger.error('invite', (typeof action !== 'undefined' ? action : '-'), { err: e });
        aiUsed = false;
        invites = candidates.length > 0
          ? candidates.map(c => ({ userId: c.userId, nickname: c.nickname, content: TEMPLATE.replace('{nickname}', c.nickname).replace('{M月d日}', mdy).replace('{HH:mm}', hm).replace('{location}', a.location).replace('{n}', remaining) }))
          : [{ userId: null, nickname: null, content: TEMPLATE.replace('{nickname}', '朋友').replace('{M月d日}', mdy).replace('{HH:mm}', hm).replace('{location}', a.location).replace('{n}', remaining) }];
      }
      return { success: true, data: { invites, source: aiUsed ? 'ai' : 'template' }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('invite', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '邀约失败' };
  }
};
