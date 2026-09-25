/**
 * court-start 云函数 - 按场地开始分组（08.4）
 * 与 court-matches 等价：每个场地取 assignedUserIds → 轮转双打 → 建 teams 文档 + match.team1Id/team2Id
 * 仅组织者、registering 状态可调用
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { buildRotatingDoublesPlan } = require('./rotating.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'generate', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可生成赛程' };
    if (act.data.status !== 'registering') return { success: false, message: '活动状态不允许分组' };

    // BUG-34: 条件更新抢锁，防止并发重复生成
    const lockRes = await db.collection('activities').where({ _id: activityId, status: 'registering' }).update({ data: { status: 'generating' } });
    if (lockRes.stats.updated === 0) return { success: false, message: '赛程生成中，请勿重复操作' };

    // 重新生成：先删旧 teams，再删 matches，避免残留孤儿队伍
    await db.collection('teams').where({ activityId }).remove();
    await db.collection('matches').where({ activityId, court: _.neq('') }).remove();

    const courtsRes = await db.collection('activity_courts').where({ activityId }).orderBy('courtNo', 'asc').get();
    const courts = courtsRes.data || [];
    if (courts.length === 0) return { success: false, message: '尚未配置场地，无法按场地分组' };
    const assignRes = await db.collection('court_assignments').where({ activityId }).get();
    const assignments = assignRes.data || [];

    const userIds = [...new Set(assignments.map(a => a.userId))];
    const usersRes = await db.collection('users').where({ openid: _.in(userIds) }).get();
    const userMap = {};
    (usersRes.data || []).forEach(u => { userMap[u.openid] = u; });
    // BUG-74: 优先用报名时的 reported level，而非 users.level
    const regRes = await db.collection('registrations').where({ activityId, userId: _.in(userIds), applyStatus: 'active' }).get();
    const regLevelMap = {};
    (regRes.data || []).forEach(r => { regLevelMap[r.userId] = r.level; });
    const playersMap = {};
    assignments.forEach(a => {
      const u = userMap[a.userId] || {};
      const level = regLevelMap[a.userId] != null ? regLevelMap[a.userId] : (u.level != null ? u.level : 5);
      playersMap[a.userId] = { level: level, rating: u.rating != null ? u.rating : null, nickname: u.nickname || '' };
    });

    const allMatches = [];
    let ro = 0;
    for (const court of courts) {
      const subIds = assignments.filter(a => a.courtId === court._id).map(a => a.userId);
      if (subIds.length < 4) continue;
      const subRegs = subIds.map(id => ({ userId: id }));
      const plan = buildRotatingDoublesPlan(subRegs, playersMap);
      const teamIdMap = {};
      if (plan.teams.length > 0) {
        const teamDocs = plan.teams.map(t => ({
          activityId, name: t.name, members: t.members, createdAt: db.serverDate(), updatedAt: db.serverDate()
        }));
        const addRes = await db.collection('teams').add({ data: teamDocs });
        const ids = addRes._ids || (addRes._id ? [addRes._id] : []);
        plan.teams.forEach((t, i) => { teamIdMap[t.key] = ids[i]; });
      }
      plan.matches.forEach(m => {
        ro++;
        allMatches.push({
          activityId, round: 'group', court: court.label || '场地A', roundOrder: ro,
          team1Id: teamIdMap[m.team1Key], team2Id: teamIdMap[m.team2Key],
          team1Score: null, team2Score: null, status: 'pending',
          scheduledTime: Date.now() + ro * 15 * 60 * 1000,
          createdAt: db.serverDate(), updatedAt: db.serverDate()
        });
      });
    }
    if (allMatches.length > 0) await db.collection('matches').add({ data: allMatches });
    await db.collection('activities').doc(activityId).update({ data: { status: 'grouping' } });
    return { success: true, data: { count: allMatches.length }, message: 'ok' };
  } catch (err) {
    logger.error('court-start', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '生成赛程失败' };
  }
};
