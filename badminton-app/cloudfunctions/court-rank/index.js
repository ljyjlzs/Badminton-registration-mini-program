/**
 * court-rank 云函数 - 按场地活动排名（08.6，同 03.4 get-rankings）
 * 直接读 scores 集合（scoreChange）汇总，与 RankingServiceImpl 一致
 * payload: { activityId, type?: 'all'|'individual'|'team' }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { ratingOfLevel } = require('./rating.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { payload = {} } = event;
  try {
    const { activityId, type = 'all' } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };

    // PERF-36: 分页循环取全量，避免默认 20 条上限
    async function getAll(coll, where) {
      let rows = [], skip = 0;
      const PAGE = 100;
      while (true) {
        const res = await coll.where(where).skip(skip).limit(PAGE).get();
        const data = res.data || [];
        rows = rows.concat(data);
        if (data.length < PAGE) break;
        skip += PAGE;
      }
      return rows;
    }
    const scores = await getAll(db.collection('scores'), { activityId });
    const regs = await getAll(db.collection('registrations'), { activityId, applyStatus: 'active' });
    const userIds = regs.map(r => r.userId);
    const usersRes = await db.collection('users').where({ openid: _.in(userIds) }).get();
    const userMap = {};
    (usersRes.data || []).forEach(u => { userMap[u.openid] = u; });

    // 个人：按 scoreChange 汇总 totalScore / groupScore（source==='group'）
    const indiv = {};
    scores.forEach(s => {
      if (!indiv[s.userId]) indiv[s.userId] = { userId: s.userId, totalScore: 0, groupScore: 0, matchIds: new Set() };
      indiv[s.userId].totalScore += s.scoreChange;
      if (s.source === 'group') indiv[s.userId].groupScore += s.scoreChange;
      if (s.matchId) indiv[s.userId].matchIds.add(s.matchId);
    });
    const individualRankings = Object.values(indiv).map(p => {
      const u = userMap[p.userId] || {};
      const played = p.matchIds.size;
      const avg = played > 0 ? Math.round((p.totalScore / played) * 10) / 10 : 0;
      return {
        userId: p.userId,
        nickname: u.nickname || '球友',
        avatar: u.avatar || '',
        level: u.level || 5,
        rating: u.rating != null ? u.rating : ratingOfLevel(u.level || 5),
        ratingDelta: 0,
        totalScore: p.totalScore,
        groupScore: p.groupScore,
        matchCount: played,
        avgScore: avg,
        rank: 0
      };
    });
    individualRankings.sort((a, b) => {
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return (a.nickname || '').localeCompare(b.nickname || '');
    });
    individualRankings.forEach((r, i) => r.rank = i + 1);

    // 队伍：按成员逐行累加 scoreChange（与个人一致，不做去重）
    const teamsRes = await db.collection('teams').where({ activityId }).limit(1000).get();
    const teams = teamsRes.data || [];
    const teamRankings = teams.map(t => {
      const members = t.members || [];
      let total = 0, group = 0;
      scores.forEach(s => {
        if (members.indexOf(s.userId) !== -1) {
          total += s.scoreChange;
          if (s.source === 'group') group += s.scoreChange;
        }
      });
      const memberInfos = members.map(mid => {
        const u = userMap[mid] || {};
        return { userId: mid, nickname: u.nickname || '球友', avatar: u.avatar || '', level: u.level || 5 };
      });
      return { teamId: t._id, name: t.name || '待命名队伍', members: memberInfos, totalScore: total, groupScore: group, rank: 0 };
    });
    teamRankings.sort((a, b) => b.totalScore - a.totalScore || (a.name || '').localeCompare(b.name || ''));
    teamRankings.forEach((t, i) => t.rank = i + 1);

    const data = { individualRankings, teamRankings };
    if (type === 'individual') data.teamRankings = [];
    if (type === 'team') data.individualRankings = [];
    return { success: true, data, message: 'ok' };
  } catch (err) {
    logger.error('court-rank', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '排名失败' };
  }
};
