var cloud = require('wx-server-sdk');
var logger = require('./logger');
// ARCH-02: 评分引擎参数化，公式统一在 _shared/rating.js（由 sync-shared.js 复制）
var ratingEngine = require('./rating.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
var db = cloud.database();
var _ = db.command;

exports.main = async function(event, context) {
  var action = event.action || 'submit';
  var payload = event.payload || {};
  var wxContext = cloud.getWXContext();
  var openid = wxContext.OPENID;
  try {
    if (action !== 'submit' && action !== 'modify') return { success: false, message: '未知 action: ' + action };
    var matchId = payload.matchId;
    var team1Score = payload.team1Score;
    var team2Score = payload.team2Score;
    if (!matchId) return { success: false, message: 'matchId 不能为空' };
    var s1 = Number(team1Score), s2 = Number(team2Score);
    if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0 || s1 > 30 || s2 > 30) {
      return { success: false, message: '比分范围 0-30' };
    }
    if (s1 === s2) return { success: false, message: '不允许平局' };

    // BUG-14: 读 match → 校验 status → 写操作，整体放入事务
    var transaction = await db.startTransaction();
    try {
      var matchRes = await transaction.collection('matches').doc(matchId).get();
      if (!matchRes.data) { await transaction.rollback(); return { success: false, message: '比赛不存在' }; }
      var match = matchRes.data;
      if (action === 'submit' && match.status === 'finished') { await transaction.rollback(); return { success: false, message: '比赛已结束' }; }
      if (action === 'modify' && match.status !== 'finished') { await transaction.rollback(); return { success: false, message: '比赛未结束，无法修改' }; }

      var actRes = await transaction.collection('activities').doc(match.activityId).get();
      if (!actRes.data) { await transaction.rollback(); return { success: false, message: '活动不存在' }; }
      var activity = actRes.data;

      var t1 = await transaction.collection('teams').doc(match.team1Id).get();
      var t2 = await transaction.collection('teams').doc(match.team2Id).get();
      if (!t1.data || !t2.data) { await transaction.rollback(); return { success: false, message: '队伍数据异常' }; }
      var m1 = t1.data.members || [], m2 = t2.data.members || [];

      var isMember = m1.indexOf(openid) !== -1 || m2.indexOf(openid) !== -1;
      if (!isMember && activity.organizerId !== openid) {
        await transaction.rollback();
        return { success: false, message: '仅参赛成员或组织者可提交比分' };
      }

      // BUG-7: 分页循环取全量，避免默认 20 条上限截断
      async function getAllTx(tx, collName, where) {
        var rows = [], skip = 0, PAGE = 100;
        while (true) {
          var res = await tx.collection(collName).where(where).skip(skip).limit(PAGE).get();
          var data = res.data || [];
          rows = rows.concat(data);
          if (data.length < PAGE) break;
          skip += PAGE;
        }
        return rows;
      }
      // Revert old scores/rating
      var oldScores = await getAllTx(transaction, 'scores', { matchId: matchId });
      var oldRC = await getAllTx(transaction, 'rating_changes', { matchId: matchId });
      var userRevert = {};
      oldRC.forEach(function(rc) {
        userRevert[rc.userId] = (userRevert[rc.userId] || 0) - rc.delta;
      });
      var revertKeys = Object.keys(userRevert);
      // PERF-14：合并 revert 与 applyRating 两次 users 查询为一次，结果复用
      var allUserIds = [];
      var seenUid = {};
      function pushUid(uid) {
        if (uid && !seenUid[uid]) { seenUid[uid] = 1; allUserIds.push(uid); }
      }
      revertKeys.forEach(pushUid);
      m1.forEach(pushUid);
      m2.forEach(pushUid);
      var umap = {};
      if (allUserIds.length > 0) {
        var usersRes = await transaction.collection('users').where({ openid: _.in(allUserIds) }).get();
        (usersRes.data || []).forEach(function(u) { umap[u.openid] = u; });
      }
      for (var i = 0; i < revertKeys.length; i++) {
        var uid = revertKeys[i];
        if (umap[uid] && umap[uid]._id) {
          await transaction.collection('users').doc(umap[uid]._id).update({ data: { rating: _.inc(userRevert[uid]) } });
        }
      }
      await transaction.collection('scores').where({ matchId: matchId }).remove();
      await transaction.collection('rating_changes').where({ matchId: matchId }).remove();

      // Write new scores
      var scoreRows = [];
      m1.forEach(function(uid) { scoreRows.push({ activityId: match.activityId, matchId: matchId, userId: uid, source: 'group', scoreChange: s1 - s2 }); });
      m2.forEach(function(uid) { scoreRows.push({ activityId: match.activityId, matchId: matchId, userId: uid, source: 'group', scoreChange: s2 - s1 }); });
      for (var j = 0; j < scoreRows.length; j++) {
        var row = scoreRows[j];
        row.createdAt = db.serverDate();
        await transaction.collection('scores').add({ data: row });
      }

      // Apply rating
      await applyRating(transaction, match.activityId, matchId, m1, m2, s1, s2, umap);

      // Update match
      await transaction.collection('matches').doc(matchId).update({
        data: { status: 'finished', team1Score: s1, team2Score: s2, updatedAt: db.serverDate() }
      });

      // Clear live score
      await transaction.collection('match_live_states').where({ matchId: matchId }).remove();

      await transaction.commit();
    } catch (txErr) {
      // 失败回滚，保证读-删-写的原子性
      try { await transaction.rollback(); } catch (e) { /* ignore */ }
      return { success: false, message: '提交失败已回滚: ' + (txErr.message || '未知错误') };
    }

    // 自动完结：所有比赛都结束后，活动自动变为 finished
    if (action === 'submit') {
      try {
        var allMatches = await db.collection('matches').where({ activityId: match.activityId }).get();
        var allFinished = (allMatches.data || []).length > 0 && allMatches.data.every(function(m) { return m.status === 'finished'; });
        if (allFinished) {
          await db.collection('activities').doc(match.activityId).update({
            data: { status: 'finished', updatedAt: db.serverDate() }
          });
        }
      } catch (e) { /* 不影响比分提交 */ }
    }

    return { success: true, data: { matchId: matchId, team1Score: s1, team2Score: s2 }, message: action === 'modify' ? '比分已修改' : '比分已提交' };
  } catch (err) {
    logger.error('submit-score', action, { err: err });
    return { success: false, message: err.message || '提交失败' };
  }
};

// ARCH-02: 公式收敛到 _shared/rating.js，此处仅转发，保持事务语义
// PERF-14: umap 由调用方统一预取并传入，这里不再重复查询 users
async function applyRating(transaction, activityId, matchId, m1, m2, s1, s2, umap) {
  return ratingEngine.applyRating(transaction, activityId, matchId, m1, m2, s1, s2, _, umap);
}
