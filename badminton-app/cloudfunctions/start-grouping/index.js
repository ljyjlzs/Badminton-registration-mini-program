/**
 * start-grouping 云函数 - 分组与赛程生成
 * 对齐 GroupingPlanServiceImpl：
 *  - status 须为 registering；fixed-doubles 须偶数人数
 *  - singles/fixed-doubles：固搭配对优先 + 其余按水平最高配最低，再全循环
 *  - fixed-doubles 优先绑定 partnerId（互为搭档）
 *  - doubles：圆桌轮转（与 Java buildRotatingDoublesPlan 同算法）
 *  - court-doubles：按场地各自轮转，roundOrder 全局递增
 * payload: { activityId, preview?: boolean }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { buildRotatingDoublesPlan, getCourtLabel } = require('./rotating.js');
// ENG-11: 赛程间隔/默认等级常量（由 sync-shared.js 复制到本目录）
const { MATCH_SLOT_MS, DEFAULT_LEVEL } = require('./constants.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'apply', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { activityId, preview } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const actRes = await db.collection('activities').doc(activityId).get();
    if (!actRes.data) return { success: false, message: '活动不存在' };
    const activity = actRes.data;
    if (activity.organizerId !== openid) return { success: false, message: '仅组织者可分组' };
    if (activity.status !== 'registering') return { success: false, message: '活动状态不允许分组' };

    const regsRes = await db.collection('registrations').where({
      activityId, applyStatus: 'active', cancelStatus: _.neq('approved')
    }).get();
    const regs = regsRes.data || [];
    if (regs.length === 0) return { success: false, message: '没有报名用户' };
    if (regs.length < (activity.minPlayers || 0)) return { success: false, message: '报名人数不足，至少需要' + activity.minPlayers + '人才能开始分组' };
    if (activity.type === 'fixed-doubles' && regs.length % 2 !== 0) return { success: false, message: '双打固搭需要偶数人数' };

    const userIds = regs.map(r => r.userId);
    const usersRes = await db.collection('users').where({ openid: _.in(userIds) }).get();
    const userMap = {};
    (usersRes.data || []).forEach(u => { userMap[u.openid] = u; });

    const playersMap = {};
    regs.forEach(r => {
      const u = userMap[r.userId] || {};
      const level = r.level != null ? r.level : (u.level != null ? u.level : 5);
      playersMap[r.userId] = {
        level: level,
        rating: u.rating != null ? u.rating : null,
        nickname: r.nickname || ''
      };
    });

    const plan = await buildPlan(activity, regs, playersMap);

    if (preview) {
      // BUG-29: 返回队伍对象数组（index/memberNamesText/totalLevel），而非数字
      const previewTeams = plan.teams.map(function(t, i) {
        const names = (t.members || []).map(function(uid) {
          const p = playersMap[uid];
          return p ? (p.nickname || uid) : uid;
        });
        const totalLevel = (t.members || []).reduce(function(sum, uid) {
          const p = playersMap[uid];
          return sum + (p && p.level ? p.level : 5);
        }, 0);
        return { index: i + 1, name: t.name, memberNamesText: names.join('/'), totalLevel: totalLevel };
      });
      return { success: true, data: { preview: { teams: previewTeams, matches: plan.matches.length, reasons: plan.reasons } }, message: '预览' };
    }

    const teamIdMap = {};
    // BUG-34: 先清理旧分组产生的 teams，防止重复插入
    await db.collection('teams').where({ activityId }).remove();
    if (plan.teams.length > 0) {
      // PERF-01: 批量插入 teams（chunk 500 防超时）；wx-server-sdk 批量 add 返回 _ids 数组
      const teamDocs = plan.teams.map(t => ({
        activityId, name: t.name, members: t.members, createdAt: db.serverDate(), updatedAt: db.serverDate()
      }));
      const CHUNK = 500;
      let allTeamIds = [];
      for (let i = 0; i < teamDocs.length; i += CHUNK) {
        const chunk = teamDocs.slice(i, i + CHUNK);
        const addRes = await db.collection('teams').add({ data: chunk });
        const ids = addRes._ids || (addRes._id ? [addRes._id] : []);
        allTeamIds = allTeamIds.concat(ids);
      }
      plan.teams.forEach((t, i) => { teamIdMap[t.key] = allTeamIds[i]; });
    }

    // PERF-29：按队伍收集 regIds 后每队一次批量 update，替代逐成员 doc update
    if (activity.type !== 'doubles' && activity.type !== 'court-doubles') {
      for (const t of plan.teams) {
        const tid = teamIdMap[t.key];
        const regIds = [];
        for (const mid of t.members) {
          const reg = regs.find(r => r.userId === mid);
          if (reg && reg._id) regIds.push(reg._id);
        }
        if (regIds.length > 0) {
          await db.collection('registrations').where({ _id: _.in(regIds) }).update({ data: { teamId: tid } });
        }
      }
    }

    // PERF-01: 批量插入 matches（chunk 500）
    const matchDocs = plan.matches.map((m, i) => {
      const order = m.roundOrder != null ? m.roundOrder : (i + 1);
      return {
        activityId,
        team1Id: teamIdMap[m.team1Key],
        team2Id: teamIdMap[m.team2Key],
        status: 'pending',
        roundOrder: order,
        court: m.court || getCourtLabel(order),
        round: 'group',
        team1Score: null,
        team2Score: null,
        scheduledTime: Date.now() + order * MATCH_SLOT_MS,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      };
    });
    if (matchDocs.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < matchDocs.length; i += CHUNK) {
        await db.collection('matches').add({ data: matchDocs.slice(i, i + CHUNK) });
      }
    }

    await db.collection('activities').doc(activityId).update({
      data: { status: 'grouping', groupingReasons: plan.reasons, updatedAt: db.serverDate() }
    });

    return { success: true, data: { teams: plan.teams.length, matches: plan.matches.length, reasons: plan.reasons }, message: '分组成功' };
  } catch (err) {
    logger.error('start-grouping', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '分组失败' };
  }
};

async function buildPlan(activity, regs, playersMap) {
  if (activity.type === 'court-doubles') {
    return await buildCourtDoublesPlan(activity._id, regs, playersMap);
  }
  if (activity.type === 'doubles') {
    return buildRotatingDoublesPlan(regs, playersMap);
  }
  const fixed = buildFixedTeams(regs, activity.type, playersMap);
  const rr = buildRoundRobinMatches(fixed.teams, playersMap);
  return { type: activity.type, teams: fixed.teams, reasons: fixed.reasons, matches: rr.matches, matchesCount: rr.matchesCount };
}

function mixedScore(userId, playersMap) {
  const p = playersMap[userId] || { level: DEFAULT_LEVEL, rating: null };
  const level = p.level != null ? p.level : 5;
  const rating = p.rating != null ? p.rating : null;
  return rating != null ? level * 10 + rating / 100 : level * 10;
}

function teamTotalLevel(members, playersMap) {
  return members.reduce((s, id) => s + ((playersMap[id] && playersMap[id].level) || 5), 0);
}

function buildFixedTeams(regs, type, playersMap) {
  const sorted = regs.slice().sort((a, b) => mixedScore(b.userId, playersMap) - mixedScore(a.userId, playersMap));
  const teams = [];
  const reasons = [];
  const used = new Set();
  if (type === 'singles') {
    for (const reg of sorted) {
      teams.push({ key: 't_' + reg.userId, members: [reg.userId], name: reg.nickname || '选手' });
      reasons.push('单打：' + (reg.nickname || '') + '单独成队');
    }
    return { teams, reasons };
  }
  const byUser = {};
  sorted.forEach(r => { byUser[r.userId] = r; });
  for (const reg of sorted) {
    if (used.has(reg.userId)) continue;
    const partner = reg.partnerId != null ? byUser[reg.partnerId] : null;
    if (partner && !used.has(partner.userId)) {
      teams.push({ key: 't_' + reg.userId + '_' + partner.userId, members: [reg.userId, partner.userId], name: (reg.nickname || '') + '/' + (partner.nickname || '') });
      reasons.push('固搭绑定：' + (reg.nickname || '') + '与' + (partner.nickname || '') + '互为搭档');
      used.add(reg.userId); used.add(partner.userId);
    }
  }
  let left = 0, right = sorted.length - 1;
  while (left < right) {
    const a = sorted[left], b = sorted[right];
    if (used.has(a.userId)) { left++; continue; }
    if (used.has(b.userId)) { right--; continue; }
    teams.push({ key: 't_' + a.userId + '_' + b.userId, members: [a.userId, b.userId], name: (a.nickname || '') + '/' + (b.nickname || '') });
    reasons.push('按水平最高配最低：' + (a.nickname || '') + '+' + (b.nickname || ''));
    used.add(a.userId); used.add(b.userId);
    left++; right--;
  }
  return { teams, reasons };
}

function buildRoundRobinMatches(teams, playersMap) {
  const ordered = teams.slice().sort((a, b) => teamTotalLevel(a.members, playersMap) - teamTotalLevel(b.members, playersMap));
  const matches = [];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      matches.push({ team1Key: ordered[i].key, team2Key: ordered[j].key });
    }
  }
  return { matches, matchesCount: matches.length };
}

async function buildCourtDoublesPlan(activityId, regs, playersMap) {
  const courtsRes = await db.collection('activity_courts').where({ activityId }).orderBy('courtNo', 'asc').get();
  const courts = courtsRes.data || [];
  if (courts.length === 0) throw new Error('尚未配置场地，无法按场地分组');
  const assignRes = await db.collection('court_assignments').where({ activityId }).get();
  const assignments = assignRes.data || [];
  const regByUser = {};
  regs.forEach(r => { regByUser[r.userId] = r; });
  const plan = { teams: [], matches: [], reasons: [], rules: ['按场地划分：每个场地独立进行轮转双打', '每场至少4人，奇数人数时轮空1人'] };
  let ro = 0;
  for (const court of courts) {
    const userIds = assignments.filter(a => a.courtId === court._id).map(a => a.userId);
    const sub = userIds.map(id => regByUser[id]).filter(Boolean);
    if (sub.length === 0) continue;
    const subPlan = buildRotatingDoublesPlan(sub, playersMap);
    subPlan.matches.forEach(pm => { ro++; pm.roundOrder = ro; pm.court = court.label || getCourtLabel(court.courtNo); });
    plan.teams.push(...subPlan.teams);
    plan.reasons.push(...subPlan.reasons);
    plan.matches.push(...subPlan.matches);
  }
  plan.matchesCount = plan.matches.length;
  plan.explanation = ['按场地划分双打，共' + courts.length + '个场地，各场地独立轮转'];
  return plan;
}
