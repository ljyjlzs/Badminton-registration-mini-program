/**
 * createChallengeMatch 云函数 - 创建挑战赛
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { activityId, challengerTeamId } = event;
  
  if (!activityId || !challengerTeamId) {
    return {
      success: false,
      error: '参数不完整'
    };
  }
  
  try {
    // 获取活动
    const activityResult = await db.collection('activities').doc(activityId).get();
    
    if (!activityResult.data) {
      return {
        success: false,
        error: '活动不存在'
      };
    }
    
    const activity = activityResult.data;
    
    // 验证组织者权限
    if (activity.organizer_id !== openid) {
      return {
        success: false,
        error: '只有组织者才能创建挑战赛'
      };
    }
    
    // 获取晋级队（积分最高的队伍，这里简化处理，取挑战赛配对的第一支队伍）
    const teamsResult = await db.collection('teams')
      .where({
        activity_id: activityId
      })
      .orderBy('group_score', 'desc')
      .limit(1)
      .get();
    
    if (!teamsResult.data || teamsResult.data.length === 0) {
      return {
        success: false,
        error: '未找到晋级队伍'
      };
    }
    
    const qualifiedTeam = teamsResult.data[0];
    
    // 创建挑战赛比赛
    const matchData = {
      activity_id: activityId,
      round: 'challenge',
      venue: '挑战赛',
      team1_id: qualifiedTeam._id,
      team2_id: challengerTeamId,
      team1_score: null,
      team2_score: null,
      status: 'pending',
      score_submitter: null,
      team1_confirmed: false,
      team2_confirmed: false,
      completed_at: null,
      created_at: db.serverDate()
    };
    
    const result = await db.collection('matches').add({
      data: matchData
    });
    
    return {
      success: true,
      data: {
        matchId: result._id
      }
    };
  } catch (err) {
    console.error('创建挑战赛失败：', err);
    return {
      success: false,
      error: err.message || '创建挑战赛失败'
    };
  }
};
