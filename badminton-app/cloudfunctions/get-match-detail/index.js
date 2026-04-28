/**
 * getMatchDetail 云函数 - 获取比赛详情
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { activityId, matchId } = event;
  
  if (!activityId || !matchId) {
    return {
      success: false,
      error: '参数不完整'
    };
  }
  
  try {
    // 获取比赛
    const matchResult = await db.collection('matches').doc(matchId).get();
    
    if (!matchResult.data) {
      return {
        success: false,
        error: '比赛不存在'
      };
    }
    
    const match = matchResult.data;
    
    // 获取队伍信息
    const team1Result = await db.collection('teams').doc(match.team1_id).get();
    const team2Result = await db.collection('teams').doc(match.team2_id).get();
    
    const team1 = team1Result.data || {};
    const team2 = team2Result.data || {};
    
    // 获取报名信息
    const registrationsResult = await db.collection('registrations')
      .where({
        activity_id: activityId
      })
      .get();
    
    const registrations = registrationsResult.data || [];
    const regNicknames = {};
    const regLevels = {};
    registrations.forEach(reg => {
      regNicknames[reg.user_id] = reg.nickname;
      regLevels[reg.user_id] = reg.level;
    });
    
    // 获取用户信息
    const userIds = [...(team1.members || []), ...(team2.members || [])];
    let usersMap = {};
    
    if (userIds.length > 0) {
      const usersResult = await db.collection('users')
        .where({
          _openid: db.command.in(userIds)
        })
        .get();
      
      usersResult.data.forEach(user => {
        usersMap[user._openid] = user;
      });
    }
    
    // 组合队伍信息
    const team1Members = (team1.members || []).map(userId => ({
      userId,
      nickname: regNicknames[userId] || usersMap[userId]?.nickname || '未知用户',
      avatar: usersMap[userId]?.avatar || '',
      level: regLevels[userId] || usersMap[userId]?.level || 5
    }));
    
    const team2Members = (team2.members || []).map(userId => ({
      userId,
      nickname: regNicknames[userId] || usersMap[userId]?.nickname || '未知用户',
      avatar: usersMap[userId]?.avatar || '',
      level: regLevels[userId] || usersMap[userId]?.level || 5
    }));
    
    // 获取活动信息判断组织者
    const activityResult = await db.collection('activities').doc(activityId).get();
    const isOrganizer = activityResult.data?.organizer_id === openid;
    
    // 检查用户队伍
    let userTeam = null;
    if (team1.members?.includes(openid)) {
      userTeam = match.team1_id;
    } else if (team2.members?.includes(openid)) {
      userTeam = match.team2_id;
    }
    
    // 判断是否为记分员（对局双方队员 + 组织者都可以记分）
    const isPlayer = team1.members?.includes(openid) || team2.members?.includes(openid);
    const isScorer = isOrganizer || isPlayer;
    
    return {
      success: true,
      data: {
        match,
        team1: { ...team1, members: team1Members },
        team2: { ...team2, members: team2Members },
        isOrganizer,
        isScorer,
        userTeam
      }
    };
  } catch (err) {
    console.error('获取比赛详情失败：', err);
    return {
      success: false,
      error: err.message || '获取比赛详情失败'
    };
  }
};
