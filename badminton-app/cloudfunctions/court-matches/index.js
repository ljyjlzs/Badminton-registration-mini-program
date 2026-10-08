/**
 * court-matches 云函数 - 按场地生成/读取赛程（08.4，03.1B 轮转双打）
 * 动作：generate（每场地取 assignedUserIds → 轮转双打 → 建 teams 文档 + match.team1Id/team2Id，court=场地标签）
 *       list    （返回本活动按场地的比赛，含队伍成员昵称）
 * 对齐 GroupingPlanServiceImpl.buildRotatingDoublesPlan + Match 实体(team1Id/team2Id/team1Score/team2Score)
 * payload: { action, activityId }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { buildRotatingDoublesPlan, getCourtLabel } = require('./rotating.js');
// ENG-11: 赛程间隔常量（由 sync-shared.js 复制到本目录）
const { MATCH_SLOT_MS } = require('./constants.js');
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

    if (action === 'list') {
      const matchesRes = await db.collection('matches').where({ activityId }).orderBy('roundOrder', 'asc').get();
      const ms = matchesRes.data || [];
      // PERF-03/06：循环前批查 teams/users，替代每场 4 次串行查询
      const teamIds = [...new Set(ms.flatMap(m => [m.team1Id, m.team2Id]).filter(Boolean))];
      const teamsRes = teamIds.length ? await db.collection('teams').where({ _id: _.in(teamIds) }).get() : { data: [] };
      const teamMap2 = {};
      (teamsRes.data || []).forEach(t => { teamMap2[t._id] = t; });
      const allMembers = [...new Set((teamsRes.data || []).flatMap(t => t.members || []))];
      const usersRes = allMembers.length ? await db.collection('users').where({ openid: _.in(allMembers) }).get() : { data: [] };
      const um = {};
      (usersRes.data || []).forEach(u => { um[u.openid] = u; });
      function enrichFromMap(teamId) {
        if (!teamId) return { id: '', name: '队伍', members: [] };
        const t = teamMap2[teamId];
        if (!t) return { id: teamId, name: '队伍', members: [] };
        const members = t.members || [];
        return {
          id: t._id,
          name: t.name || '队伍',
          members: members.map(uid => ({
            userId: uid,
            nickname: um[uid] ? um[uid].nickname : '球友',
            avatar: um[uid] ? um[uid].avatar : '',
            level: um[uid] ? um[uid].level : 5
          }))
        };
      }
      const list = [];
      for (const m of ms) {
        const team1 = enrichFromMap(m.team1Id);
        const team2 = enrichFromMap(m.team2Id);
        list.push({
          _id: m._id, court: m.court, roundOrder: m.roundOrder, status: m.status,
          team1Score: m.team1Score, team2Score: m.team2Score, team1, team2
        });
      }
      return { success: true, data: { matches: list, isOrganizer: act.data.organizerId === openid, activity: { type: act.data.type, status: act.data.status } }, message: 'ok' };
    }

    // generate
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可生成赛程' };
    if (act.data.status !== 'registering') return { success: false, message: '活动状态不允许分组' };

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
    const playersMap = {};
    assignments.forEach(a => {
      const u = userMap[a.userId] || {};
      playersMap[a.userId] = { level: u.level != null ? u.level : 5, rating: u.rating != null ? u.rating : null, nickname: u.nickname || '' };
    });

    const allMatches = [];
    let ro = 0;
    for (const court of courts) {
      const subIds = assignments.filter(a => a.courtId === court._id).map(a => a.userId);
      if (subIds.length < 4) continue;
      const subRegs = subIds.map(id => ({ userId: id }));
      const plan = buildRotatingDoublesPlan(subRegs, playersMap);
      // 每个 court 的 plan 独立，在 court 内批量插入该 court 的 teams
      const teamDocs = plan.teams.map(t => ({
        activityId, name: t.name, members: t.members, createdAt: db.serverDate(), updatedAt: db.serverDate()
      }));
      let ids = [];
      if (teamDocs.length > 0) {
        const addRes = await db.collection('teams').add({ data: teamDocs });
        ids = addRes._ids || (addRes._id ? [addRes._id] : []);
      }
      const teamIdMap = {};
      plan.teams.forEach((t, i) => { teamIdMap[t.key] = ids[i]; });
      plan.matches.forEach(m => {
        ro++;
        allMatches.push({
          activityId, round: 'group', court: court.label || getCourtLabel(court.courtNo), roundOrder: ro,
          team1Id: teamIdMap[m.team1Key], team2Id: teamIdMap[m.team2Key],
          team1Score: null, team2Score: null, status: 'pending',
          scheduledTime: Date.now() + ro * MATCH_SLOT_MS,
          createdAt: db.serverDate(), updatedAt: db.serverDate()
        });
      });
    }
    if (allMatches.length > 0) await db.collection('matches').add({ data: allMatches });
    await db.collection('activities').doc(activityId).update({ data: { status: 'grouping' } });
    return { success: true, data: { count: allMatches.length }, message: 'ok' };
  } catch (err) {
    logger.error('court-matches', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '生成赛程失败' };
  }
};
