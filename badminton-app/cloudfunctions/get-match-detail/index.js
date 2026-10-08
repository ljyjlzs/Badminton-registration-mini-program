/**
 * get-match-detail 云函数 - 单场比分详情（对齐新 schema：team1Id/team2Id + teams 集合）
 * 动作：detail
 * payload: { matchId }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
// ENG-11: 默认等级常量（由 sync-shared.js 复制）
const { DEFAULT_LEVEL } = require('./constants.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action = 'detail', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action !== 'detail') return { success: false, message: '未知 action: ' + action };
    const { matchId } = payload;
    if (!matchId) return { success: false, message: 'matchId 不能为空' };

    const matchRes = await db.collection('matches').doc(matchId).get();
    if (!matchRes.data) return { success: false, message: '比赛不存在' };
    const match = matchRes.data;
    const activityId = match.activityId;

    // PERF-04: activities/teams 互不依赖（都只用 match 上的字段），并行查询
    const round1 = await Promise.all([
      db.collection('activities').doc(activityId).get(),
      db.collection('teams').doc(match.team1Id).get(),
      db.collection('teams').doc(match.team2Id).get()
    ]);
    const actRes = round1[0];
    const isOrganizer = actRes.data && actRes.data.organizerId === openid;
    const t1 = round1[1].data || { members: [] };
    const t2 = round1[2].data || { members: [] };

    // users 依赖 t1/t2 的 members，保留串行
    const memberIds = [...(t1.members || []), ...(t2.members || [])];
    const usersRes = await db.collection('users').where({ openid: _.in(memberIds) }).get();
    const umap = {};
    (usersRes.data || []).forEach(u => { umap[u.openid] = u; });
    const toMember = (uid) => {
      const u = umap[uid] || {};
      return { userId: uid, nickname: u.nickname || '球友', avatar: u.avatar || '', level: u.level || DEFAULT_LEVEL };
    };
    const team1 = { id: t1._id, name: t1.name, members: (t1.members || []).map(toMember) };
    const team2 = { id: t2._id, name: t2.name, members: (t2.members || []).map(toMember) };

    const matchMembers = memberIds;
    const isScorer = isOrganizer || matchMembers.includes(openid);
    const userTeam = (t1.members || []).includes(openid) ? '1' : ((t2.members || []).includes(openid) ? '2' : null);

    return {
      success: true,
      data: {
        match: {
          id: match._id,
          team1Id: match.team1Id,
          team2Id: match.team2Id,
          team1Score: match.team1Score,
          team2Score: match.team2Score,
          status: match.status,
          court: match.court,
          roundOrder: match.roundOrder,
          round: match.round
        },
        team1, team2,
        isOrganizer, isScorer, userTeam
      },
      message: 'ok'
    };
  } catch (err) {
    logger.error('get-match-detail', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '获取比赛详情失败' };
  }
};
