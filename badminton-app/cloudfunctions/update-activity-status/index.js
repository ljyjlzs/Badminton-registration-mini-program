var cloud = require('wx-server-sdk');
const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
var db = cloud.database();
var _ = db.command;

exports.main = async function(event, context) {
  var action = event.action || 'update';
  var payload = event.payload || {};
  var wxContext = cloud.getWXContext();
  var openid = wxContext.OPENID;
  try {
    if (action !== 'update') return { success: false, message: '未知 action: ' + action };
    var activityId = payload.activityId;
    if (!activityId) return { success: false, message: 'activityId 必填' };

    var actRes = await db.collection('activities').doc(activityId).get();
    if (!actRes.data) return { success: false, message: '活动不存在' };
    if (actRes.data.organizerId !== openid && actRes.data._openid !== openid) {
      return { success: false, message: '仅组织者可操作' };
    }

    var updateData = { updatedAt: db.serverDate() };

    // 状态更新
    if (payload.status) {
      var validStatuses = ['registering', 'grouping', 'playing', 'finished'];
      if (validStatuses.indexOf(payload.status) === -1) {
        return { success: false, message: '非法状态: ' + payload.status };
      }
      // 状态转换验证：不允许回退
      var currentStatus = actRes.data.status;
      var transitions = { registering: ['grouping'], grouping: ['playing', 'finished'], playing: ['finished'], finished: [] };
      if (transitions[currentStatus] && transitions[currentStatus].indexOf(payload.status) === -1) {
        return { success: false, message: '不允许从 ' + currentStatus + ' 转为 ' + payload.status };
      }
      updateData.status = payload.status;
    }

    // 容量调整（不允许小于当前已报名人数）
    if (payload.maxPlayers != null) {
      var maxP = Number(payload.maxPlayers);
      if (isNaN(maxP) || maxP < 1) return { success: false, message: '人数上限必须大于0' };
      var regCount = await db.collection('registrations').where({
        activityId: activityId,
        applyStatus: 'active',
        cancelStatus: _.neq('approved')
      }).count();
      if (maxP < regCount.total) {
        return { success: false, message: '人数上限不能小于当前已报名人数（' + regCount.total + '人）' };
      }
      updateData.maxPlayers = maxP;
    }

    // 相册备注/标题（AI战报采纳 + 相册标题编辑）
    if (payload.albumNote !== undefined) {
      updateData.albumNote = payload.albumNote;
    }
    if (payload.albumTitle !== undefined) {
      updateData.albumTitle = payload.albumTitle;
    }

    // 队伍命名（与活动字段更新合并处理，不提前 return）
    var teamResult = null;
    if (payload.teamId && payload.teamName) {
      var teamRes = await db.collection('teams').doc(payload.teamId).get();
      if (!teamRes.data) return { success: false, message: '队伍不存在' };
      if (teamRes.data.activityId !== activityId) return { success: false, message: '队伍不属于此活动' };
      await db.collection('teams').doc(payload.teamId).update({
        data: { name: payload.teamName.trim(), updatedAt: db.serverDate() }
      });
      teamResult = { teamId: payload.teamId, teamName: payload.teamName.trim() };
    }

    await db.collection('activities').doc(activityId).update({ data: updateData });

    // 调整容量上限后，若有空位则自动候补补位
    var promoted = [];
    if (payload.maxPlayers != null) {
      promoted = await promoteWaitlist(activityId);
    }

    // 如果活动状态变为 finished，生成徽章
    let badges = [];
    if (payload.status === 'finished') {
      badges = await generateBadges(activityId);
    }

    return { success: true, data: Object.assign({ status: updateData.status, maxPlayers: updateData.maxPlayers, promoted, updatedAt: Date.now(), badges }, teamResult || {}), message: teamResult ? '队名已更新' : '已更新' };
  } catch (err) {
    logger.error('update-activity-status', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '更新失败' };
  }
};

// 候补补位：容量提高后按 waitlistOrder 将候补用户转为 active，直到满员
async function promoteWaitlist(activityId) {
  var promoted = [];
  // 最多补位 50 人，防止死循环
  for (var i = 0; i < 50; i++) {
    var actRes = await db.collection('activities').doc(activityId).get();
    var act = actRes.data;
    if (!act) break;
    if ((act.currentPlayers || 0) >= (act.maxPlayers || 0)) break;

    var waiting = await db.collection('registrations')
      .where({ activityId: activityId, applyStatus: 'waiting' })
      .orderBy('waitlistOrder', 'asc')
      .limit(1)
      .get();
    if (!waiting.data || waiting.data.length === 0) break;

    var w = waiting.data[0];
    await db.collection('registrations').doc(w._id).update({
      data: { applyStatus: 'active', waitlistOrder: null, updatedAt: db.serverDate() }
    });
    await db.collection('activities').doc(activityId).update({ data: { currentPlayers: _.inc(1) } });
    promoted.push({ userId: w.userId, nickname: w.nickname });
  }
  return promoted;
}

// 生成徽章函数
async function generateBadges(activityId) {
  // 查询所有比赛记录
  const matches = await db.collection('matches')
    .where({ activityId, status: 'finished' })
    .get();
  
  // 查询所有积分记录
  const scores = await db.collection('scores')
    .where({ activityId })
    .get();
  
  // 统计每个用户的总分
  const userScores = {};
  scores.data.forEach(s => {
    if (!userScores[s.userId]) {
      userScores[s.userId] = {
        totalScore: 0,
        matchCount: 0,
        winCount: 0,
        maxWinScore: 0
      };
    }
    userScores[s.userId].totalScore += s.scoreChange;
    userScores[s.userId].matchCount++;
    if (s.scoreChange > 0) userScores[s.userId].winCount++;
    if (s.scoreChange > userScores[s.userId].maxWinScore) {
      userScores[s.userId].maxWinScore = s.scoreChange;
    }
  });
  
  // 查询所有报名记录
  const registrations = await db.collection('registrations')
    .where({ activityId, applyStatus: 'active' })
    .get();
  
  const badges = [];
  
  // MVP：总分最高
  let mvpUserId = null;
  let mvpScore = -Infinity;
  for (const [userId, stats] of Object.entries(userScores)) {
    if (stats.totalScore > mvpScore) {
      mvpScore = stats.totalScore;
      mvpUserId = userId;
    }
  }
  if (mvpUserId) {
    const mvpReg = registrations.data.find(r => r.userId === mvpUserId);
    badges.push({
      activityId,
      userId: mvpUserId,
      badgeCode: 'mvp',
      title: 'MVP',
      description: `${mvpReg?.nickname || '未知'} 本次比赛得分最高`,
      createdAt: db.serverDate()
    });
  }
  
  // 努力奖：参与比赛最多
  let hardWorkerUserId = null;
  let maxMatches = 0;
  for (const [userId, stats] of Object.entries(userScores)) {
    if (stats.matchCount > maxMatches) {
      maxMatches = stats.matchCount;
      hardWorkerUserId = userId;
    }
  }
  if (hardWorkerUserId) {
    const hardWorkerReg = registrations.data.find(r => r.userId === hardWorkerUserId);
    badges.push({
      activityId,
      userId: hardWorkerUserId,
      badgeCode: 'hard_worker',
      title: '努力奖',
      description: `${hardWorkerReg?.nickname || '未知'} 完成${maxMatches}场以上比赛`,
      createdAt: db.serverDate()
    });
  }
  
  // 最大胜分：单场胜分最多
  let biggestWinUserId = null;
  let maxWinScore = 0;
  for (const [userId, stats] of Object.entries(userScores)) {
    if (stats.maxWinScore > maxWinScore) {
      maxWinScore = stats.maxWinScore;
      biggestWinUserId = userId;
    }
  }
  if (biggestWinUserId) {
    const biggestWinReg = registrations.data.find(r => r.userId === biggestWinUserId);
    badges.push({
      activityId,
      userId: biggestWinUserId,
      badgeCode: 'biggest_win',
      title: '最大胜分',
      description: `${biggestWinReg?.nickname || '未知'} 单场胜分${maxWinScore}分`,
      createdAt: db.serverDate()
    });
  }
  
  // 保存徽章
  for (const badge of badges) {
    await db.collection('badges').add({ data: badge });
  }
  
  return badges;
}
