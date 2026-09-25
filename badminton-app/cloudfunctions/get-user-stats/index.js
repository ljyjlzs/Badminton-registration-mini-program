/**
 * get-user-stats 云函数 - 用户统计
 * 支持 action: get
 * payload: { period: 'season' | 'year' | 'all' }
 */
var cloud = require('wx-server-sdk');
const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
var db = cloud.database();
var _ = db.command;

exports.main = async function(event) {
  var action = event.action || 'get';
  var payload = event.payload || {};
  var wxContext = cloud.getWXContext();
  // 安全：openid 只取调用者身份，忽略 payload 中的 openid，防止越权查看他人数据
  var openid = wxContext.OPENID;
  var period = payload.period || 'season';

  try {
    // 获取用户信息
    var userRes = await db.collection('users').where({ openid: openid }).limit(1).get();
    var user = (userRes.data && userRes.data.length > 0) ? userRes.data[0] : {};

    // 计算时间范围
    var now = new Date();
    var startDate = null;
    
    if (period === 'season') {
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 3);
    } else if (period === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    // 查询积分记录
    // 注意：链式 .where() 会覆盖前一个条件，必须合并成单次 where
    var scoreWhere = { userId: openid };
    if (startDate) {
      scoreWhere.createdAt = _.gte(startDate);
    }
    var scores = await db.collection('scores').where(scoreWhere).limit(1000).get();
    var scoreList = scores.data || [];

    // 统计基础数据
    var matchSet = {};
    var winCount = 0;
    var totalScore = 0;
    
    scoreList.forEach(function(s) {
      matchSet[s.matchId] = true;
      totalScore += (s.scoreChange || 0);
      if ((s.scoreChange || 0) > 0) winCount++;
    });

    var matchCount = Object.keys(matchSet).length;
    var winRate = matchCount > 0 ? parseFloat(((winCount / matchCount) * 100).toFixed(1)) : 0;

    // 查询报名记录
    // 同上：链式 .where() 会覆盖 userId 条件，必须合并成单次 where
    var regWhere = {
      userId: openid,
      applyStatus: 'active',
      cancelStatus: _.neq('approved')
    };
    if (startDate) {
      regWhere.createdAt = _.gte(startDate);
    }
    var regs = await db.collection('registrations').where(regWhere).limit(1000).get();
    var activityCount = new Set((regs.data || []).map(r => r.activityId)).size;

    // 查询徽章
    var badges = await db.collection('badges').where({ userId: openid }).get();

    // 查询最近比赛（最多10场）
    var recentMatches = [];
    var matchIds = Object.keys(matchSet).slice(0, 10);
    if (matchIds.length > 0) {
      var mres = await db.collection('matches').where({ _id: _.in(matchIds) }).get();
      var mmap = {};
      (mres.data || []).forEach(function(m) { mmap[m._id] = m; });
      var tids = [];
      matchIds.forEach(function(id) {
        var m = mmap[id];
        if (m && m.team1Id && tids.indexOf(m.team1Id) === -1) tids.push(m.team1Id);
        if (m && m.team2Id && tids.indexOf(m.team2Id) === -1) tids.push(m.team2Id);
      });
      var tmap = {};
      if (tids.length > 0) {
        var tres = await db.collection('teams').where({ _id: _.in(tids) }).get();
        (tres.data || []).forEach(function(t) { tmap[t._id] = t; });
      }
      for (var i = 0; i < matchIds.length; i++) {
        var match = mmap[matchIds[i]];
        if (match) {
          var team1Name = (match.team1Id && tmap[match.team1Id] && tmap[match.team1Id].name) || '队伍1';
          var team2Name = (match.team2Id && tmap[match.team2Id] && tmap[match.team2Id].name) || '队伍2';
          recentMatches.push({
            matchId: match._id,
            team1Name: team1Name,
            team2Name: team2Name,
            team1Score: match.team1Score,
            team2Score: match.team2Score,
            status: match.status,
            createdAt: match.createdAt
          });
        }
      }
    }

    // 排名趋势（最近5次积分变化）
    var rankingTrend = scoreList
      .sort(function(a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .slice(0, 5)
      .map(function(s) {
        return {
          date: s.createdAt,
          scoreChange: s.scoreChange
        };
      });

    // 排名
    var allUsers = await db.collection('users').orderBy('rating', 'desc').limit(100).get();
    var rank = '-';
    (allUsers.data || []).forEach(function(u, i) {
      if (u.openid === openid) rank = '#' + (i + 1);
    });

    // BUG-10/BUG-82: highlights 取 scoreChange 最大的记录，rankList 取 rating 排名前 N
    var highlights = scoreList
      .slice()
      .sort(function(a, b) { return (b.scoreChange || 0) - (a.scoreChange || 0); })
      .slice(0, 3)
      .map(function(s) {
        return { date: s.createdAt, scoreChange: s.scoreChange, matchId: s.matchId };
      });
    var rankList = (allUsers.data || []).slice(0, 5).map(function(u, i) {
      return { rank: i + 1, nickname: u.nickname || u.nickName || '玩家', rating: u.rating || 0 };
    });

    return {
      success: true,
      data: {
        activityCount: activityCount,
        matchCount: matchCount,
        winRate: winRate,
        totalScore: totalScore,
        badges: badges.data || [],
        recentMatches: recentMatches,
        rankingTrend: rankingTrend,
        rating: user.rating || 1000,
        level: user.level || 5,
        rank: rank,
        aiStyle: buildAiStyle(user, winRate),
        highlights: highlights,
        rankList: rankList
      },
      message: 'ok'
    };
  } catch (err) {
    logger.error('get-user-stats', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '获取统计失败' };
  }
};

// 由 rating/level/胜率拼一句中文球风描述
function buildAiStyle(user, winRate) {
  var level = user.level || 5;
  var rating = user.rating || 1000;
  var style;
  if (winRate >= 60) {
    style = '进攻型选手，胜率突出';
  } else if (winRate >= 40) {
    style = '攻守均衡型选手';
  } else {
    style = '稳健防守型选手，仍在成长';
  }
  return 'Lv.' + level + '（水平分 ' + rating + '），胜率 ' + winRate + '%，' + style + '。';
}
