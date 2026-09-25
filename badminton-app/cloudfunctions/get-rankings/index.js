/**
 * get-rankings 云函数 - 排名
 * 对齐 RankingServiceImpl（03.4）：个人按场均积分；队伍按成员去重累加总积分
 * payload: { activityId }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { ratingOfLevel } = require('./rating.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'rank', payload = {} } = event;
  try {
    if (action !== 'rank') return { success: false, message: '未知 action: ' + action };
    const { activityId } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };

    // 云数据库单次 get 默认最多返回 100 条，显式 limit(1000) 避免静默截断
    const scoresRes = await db.collection('scores').where({ activityId }).limit(1000).get();
    const rcRes = await db.collection('rating_changes').where({ activityId }).limit(1000).get();
    const regsRes = await db.collection('registrations').where({ activityId, applyStatus: 'active', cancelStatus: _.neq('approved') }).limit(1000).get();
    const teamsRes = await db.collection('teams').where({ activityId }).limit(1000).get();
    const usersRes = await db.collection('users').where({ openid: _.in((regsRes.data || []).map(r => r.userId)) }).limit(1000).get();

    const umap = {};
    (usersRes.data || []).forEach(u => { umap[u.openid] = u; });
    const scores = scoresRes.data || [];
    const rcs = rcRes.data || [];

    // 个人
    const indiv = {};
    (regsRes.data || []).forEach(r => {
      indiv[r.userId] = {
        userId: r.userId,
        nickname: r.nickname,
        avatar: r.avatar,
        level: r.level,
        rating: umap[r.userId] ? umap[r.userId].rating : ratingOfLevel(r.level),
        totalScore: 0,
        groupScore: 0,
        playedMatches: new Set(),
        ratingDelta: 0
      };
    });
    scores.forEach(s => {
      if (!indiv[s.userId]) return;
      indiv[s.userId].totalScore += s.scoreChange;
      if (s.source === 'group') indiv[s.userId].groupScore += s.scoreChange;
      indiv[s.userId].playedMatches.add(s.matchId);
    });
    rcs.forEach(rc => {
      if (indiv[rc.userId]) indiv[rc.userId].ratingDelta += rc.delta;
    });
    const individualRankings = Object.values(indiv).map(p => {
      const played = p.playedMatches.size;
      return {
        userId: p.userId,
        nickname: p.nickname,
        avatar: p.avatar,
        level: p.level,
        rating: p.rating,
        ratingDelta: p.ratingDelta,
        totalScore: p.totalScore,
        matchCount: played,
        avgScore: played > 0 ? Math.round((p.totalScore / played) * 10) / 10 : 0
      };
    });
    individualRankings.sort((a, b) => b.avgScore - a.avgScore || b.totalScore - a.totalScore || a.nickname.localeCompare(b.nickname));

    // 队伍
    const teamMap = {};
    (teamsRes.data || []).forEach(t => { teamMap[t._id] = t; });
    const teamAgg = {};
    Object.values(indiv).forEach(p => {
      // 找到包含该用户的队伍
      const team = (teamsRes.data || []).find(t => (t.members || []).includes(p.userId));
      if (!team) return;
      if (!teamAgg[team._id]) {
        teamAgg[team._id] = { teamId: team._id, name: team.name, members: team.members, totalScore: 0 };
      }
      teamAgg[team._id].totalScore += p.totalScore;
    });
    const teamRankings = Object.values(teamAgg).sort((a, b) => b.totalScore - a.totalScore || a.name.localeCompare(b.name));
    teamRankings.forEach((t, i) => { t.rank = i + 1; });

    // 映射团队成员 openid → nickname
    const allMemberIds = [...new Set(teamRankings.flatMap(t => t.members || []))];
    if (allMemberIds.length > 0) {
      const memberRes = await db.collection('users').where({ openid: _.in(allMemberIds) }).limit(1000).get();
      const memberMap = {};
      (memberRes.data || []).forEach(u => { memberMap[u.openid] = { userId: u.openid, nickname: u.nickname || '未知', avatar: u.avatar || '', level: u.level || 5 }; });
      teamRankings.forEach(t => {
        t.members = (t.members || []).map(uid => memberMap[uid] || { userId: uid, nickname: '未知', avatar: '', level: 5 });
      });
    }

    individualRankings.forEach((p, i) => { p.rank = i + 1; });

    return { success: true, data: { individualRankings, teamRankings }, message: 'ok' };
  } catch (err) {
    logger.error('get-rankings', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '获取排名失败' };
  }
};
