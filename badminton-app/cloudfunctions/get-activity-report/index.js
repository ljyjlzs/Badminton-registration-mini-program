var cloud = require('wx-server-sdk');
const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
var db = cloud.database();
var _ = db.command;

exports.main = async function(event) {
  var action = event.action || 'get';
  var payload = event.payload || {};
  var wxContext = cloud.getWXContext();
  var openid = wxContext.OPENID;

  try {
    if (action === 'get') {
      var activityId = payload.activityId;
      if (!activityId) return { success: false, message: 'activityId 不能为空' };

      var actRes = await db.collection('activities').doc(activityId).get();
      if (!actRes.data) return { success: false, message: '活动不存在' };
      var activity = actRes.data;

      // BUG-7: 分页循环取全量，每页 .limit(1000)（单次 get 上限），避免默认 20 条上限截断
      async function getAll(coll, where) {
        var rows = [], skip = 0;
        while (true) {
          var res = await coll.where(where).skip(skip).limit(1000).get();
          var data = res.data || [];
          rows = rows.concat(data);
          if (data.length < 1000) break;
          skip += 1000;
        }
        return rows;
      }
      var regs = await getAll(db.collection('registrations'), { activityId: activityId, cancelStatus: _.neq('approved') });
      var matches = await getAll(db.collection('matches'), { activityId: activityId });
      var scores = await getAll(db.collection('scores'), { activityId: activityId });

      var matchList = matches;
      var regList = regs;
      var scoreList = scores;

      var finishedMatches = matchList.filter(function(m) { return m.status === 'finished'; });
      var totalScore = 0;
      scoreList.forEach(function(s) { totalScore += Math.abs(s.scoreChange || 0); });

      var typeLabels = { singles: '单打', doubles: '双打轮转', 'fixed-doubles': '双打固搭', 'court-doubles': '按场地双打' };
      var statusTextMap = { registering: '报名中', grouping: '分组中', playing: '比赛中', finished: '已结束' };

      // 计算 MVP（得分最高的人）
      var userScores = {};
      scoreList.forEach(function(s) {
        if (!userScores[s.userId]) userScores[s.userId] = { total: 0, wins: 0, games: 0 };
        userScores[s.userId].total += (s.scoreChange || 0);
        userScores[s.userId].games++;
        if ((s.scoreChange || 0) > 0) userScores[s.userId].wins++;
      });

      var mvpId = null;
      var mvpScore = -Infinity;
      Object.keys(userScores).forEach(function(uid) {
        if (userScores[uid].total > mvpScore) {
          mvpScore = userScores[uid].total;
          mvpId = uid;
        }
      });

      var mvpName = '';
      if (mvpId) {
        var mvpReg = regList.find(function(r) { return r.userId === mvpId; });
        if (mvpReg) mvpName = mvpReg.nickname || '';
      }

      // 生成 badges
      var badges = [];
      if (mvpName) {
        badges.push({ id: 'mvp', icon: '🏆', title: 'MVP', description: mvpName + ' 本次比赛得分最高' });
      }
      if (finishedMatches.length >= 5) {
        badges.push({ id: 'marathon', icon: '🏃', title: '马拉松', description: '完成5场以上比赛' });
      }
      if (regList.length >= 10) {
        badges.push({ id: 'popular', icon: '🎉', title: '人气王', description: '超过10人参加' });
      }

      var status = 'none';
      if (activity.status === 'finished') status = 'finished';
      else if (activity.status === 'playing' || activity.status === 'grouping') status = 'generating';

      var content = [
        activity.name || '羽毛球活动',
        (activity.location || '') + ' · ' + (activity.time || ''),
        '参与人数: ' + regList.length,
        '完成场次: ' + finishedMatches.length + '/' + matchList.length,
        '总得分: ' + totalScore,
        mvpName ? ('MVP: ' + mvpName) : ''
      ].filter(Boolean).join('\n');

      return {
        success: true,
        data: {
          status: status,
          report: {
            activityName: activity.name || '羽毛球活动',
            time: activity.time || '',
            location: activity.location || '',
            type: typeLabels[activity.type] || '双打轮转',
            status: activity.status || 'playing',
            statusText: statusTextMap[activity.status] || '进行中',
            totalPlayers: regList.length,
            totalMatches: matchList.length,
            finishedMatches: finishedMatches.length,
            totalScore: totalScore,
            mvpName: mvpName,
            mvpScore: mvpScore,
            content: content
          },
          badges: badges
        },
        message: 'ok'
      };
    }

    if (action === 'generate') {
      return { success: true, data: { status: 'generating' }, message: '已触发生成' };
    }

    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('get-activity-report', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '获取战报失败' };
  }
};
