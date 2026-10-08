/**
 * court-submit-score 云函数 - 按场地提交比分（08.5）
 * 直接镜像 submit-score 的写入逻辑：同一 scores / rating_changes / matches 集合，camelCase 同字段
 * 对齐 ScoreServiceImpl.submitScore + RatingServiceImpl.applyMatch（03.3 + 04.1）
 * payload: { matchId, team1Score, team2Score }（兼容 scoreA/scoreB 别名；可包在 {action,payload} 或直接平铺）
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
// ARCH-02: 评分引擎参数化，公式统一在 _shared/rating.js（由 sync-shared.js 复制）
const ratingEngine = require('./rating.js');
// ENG-11: 比分范围常量（由 sync-shared.js 复制）
const { SCORE_MIN, SCORE_MAX } = require('./constants.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'submit', payload = {} } = event;
  const data = (payload && Object.keys(payload).length) ? payload : event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    if (action !== 'submit' && action !== 'modify') return { success: false, message: '未知 action: ' + action };
    const { matchId, team1Score, team2Score, scoreA, scoreB } = data;
    const s1 = Number(team1Score != null ? team1Score : scoreA);
    const s2 = Number(team2Score != null ? team2Score : scoreB);
    if (!matchId) return { success: false, message: 'matchId 不能为空' };
    if (isNaN(s1) || isNaN(s2) || s1 < SCORE_MIN || s2 < SCORE_MIN || s1 > SCORE_MAX || s2 > SCORE_MAX) {
      return { success: false, message: '比分范围 0-30' };
    }
    if (s1 === s2) return { success: false, message: '不允许平局' };

    const matchRes = await db.collection('matches').doc(matchId).get();
    if (!matchRes.data) return { success: false, message: '比赛不存在' };
    const match = matchRes.data;
    if (action === 'submit' && match.status === 'finished') return { success: false, message: '比赛已结束' };
    if (action === 'modify' && match.status !== 'finished') return { success: false, message: '比赛未结束，无法修改' };

    const actRes = await db.collection('activities').doc(match.activityId).get();
    if (!actRes.data) return { success: false, message: '活动不存在' };
    const activity = actRes.data;

    const t1 = await db.collection('teams').doc(match.team1Id).get();
    const t2 = await db.collection('teams').doc(match.team2Id).get();
    if (!t1.data || !t2.data) return { success: false, message: '队伍数据异常' };
    const m1 = t1.data.members || [], m2 = t2.data.members || [];

    const isMember = m1.includes(openid) || m2.includes(openid);
    if (!isMember && activity.organizerId !== openid) {
      return { success: false, message: '仅参赛成员或组织者可提交比分' };
    }

    // ARCH-03: 幂等回滚与写入包进事务，中途失败不留下不一致
    const transaction = await db.startTransaction();
    try {
      // BUG-7: 分页循环取全量，避免默认 20 条上限截断
      async function getAllTx(tx, collName, where) {
        let rows = [], skip = 0;
        const PAGE = 100;
        while (true) {
          const res = await tx.collection(collName).where(where).skip(skip).limit(PAGE).get();
          const data = res.data || [];
          rows = rows.concat(data);
          if (data.length < PAGE) break;
          skip += PAGE;
        }
        return rows;
      }
      // 幂等：撤销旧 scores/rating_changes 并回滚 rating
      const oldScores = await getAllTx(transaction, 'scores', { matchId });
      const oldRC = await getAllTx(transaction, 'rating_changes', { matchId });
      const userRevert = {};
      oldRC.forEach(rc => {
        userRevert[rc.userId] = (userRevert[rc.userId] || 0) - rc.delta;
      });
      const revertKeys = Object.keys(userRevert);
      // PERF-14：revertKeys 与 m1+m2（rating_changes 写入的同一批 userId）合并为一次 users 查询，结果复用
      const allUserIds = [];
      const seenUid = {};
      const pushUid = uid => {
        if (uid && !seenUid[uid]) { seenUid[uid] = 1; allUserIds.push(uid); }
      };
      revertKeys.forEach(pushUid);
      m1.forEach(pushUid);
      m2.forEach(pushUid);
      const umap = {};
      if (allUserIds.length > 0) {
        const usersRes = await transaction.collection('users').where({ openid: _.in(allUserIds) }).get();
        (usersRes.data || []).forEach(u => { umap[u.openid] = u; });
      }
      for (const uid of revertKeys) {
        if (umap[uid] && umap[uid]._id) {
          await transaction.collection('users').doc(umap[uid]._id).update({ data: { rating: _.inc(userRevert[uid]) } });
        }
      }
      await transaction.collection('scores').where({ matchId }).remove();
      await transaction.collection('rating_changes').where({ matchId }).remove();

      // 写 scores（对齐 Score 实体：activityId/matchId/userId/source/scoreChange，无 teamId）
      const scoreRows = [];
      m1.forEach(uid => scoreRows.push({ activityId: match.activityId, matchId, userId: uid, source: 'group', scoreChange: s1 - s2 }));
      m2.forEach(uid => scoreRows.push({ activityId: match.activityId, matchId, userId: uid, source: 'group', scoreChange: s2 - s1 }));
      for (const row of scoreRows) {
        await transaction.collection('scores').add({ data: { ...row, createdAt: db.serverDate() } });
      }

      // 更新 rating（04.1）
      await applyRating(match.activityId, matchId, m1, m2, s1, s2, transaction, umap);

      // 更新比赛
      await transaction.collection('matches').doc(matchId).update({
        data: { status: 'finished', team1Score: s1, team2Score: s2, updatedAt: db.serverDate() }
      });

      // 清理现场比分快照
      await transaction.collection('match_live_states').where({ matchId }).remove();

      await transaction.commit();
    } catch (txErr) {
    logger.error('court-submit-score', (typeof action !== 'undefined' ? action : '-'), { err: txErr });
      await transaction.rollback();
      return { success: false, message: '提交失败已回滚' };
    }

    // 自动完结：所有比赛都结束后，活动自动变为 finished（modify 不触发）
    if (action === 'submit') {
      try {
        var allMatches = await db.collection('matches').where({ activityId: match.activityId }).get();
        var allFinished = (allMatches.data || []).length > 0 && allMatches.data.every(function(m) { return m.status === 'finished'; });
        if (allFinished) {
          await db.collection('activities').doc(match.activityId).update({
            data: { status: 'finished', updatedAt: db.serverDate() }
          });
        }
      } catch (e) {
    logger.error('court-submit-score', (typeof action !== 'undefined' ? action : '-'), { err: e }); /* 不影响比分提交 */ }
    }

    return { success: true, data: { matchId, team1Score: s1, team2Score: s2 }, message: action === 'modify' ? '比分已修改' : '比分已提交' };
  } catch (err) {
    logger.error('court-submit-score', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '提交失败' };
  }
};

// ARCH-02: 公式收敛到 _shared/rating.js，此处仅转发
// PERF-14: umap 由调用方统一预取并传入，这里不再重复查询 users
async function applyRating(activityId, matchId, m1, m2, s1, s2, transaction, umap) {
  return ratingEngine.applyRating(transaction || db, activityId, matchId, m1, m2, s1, s2, _, umap);
}
