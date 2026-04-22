/**
 * submitScore 云函数 - 提交比分
 * 
 * 功能：
 * 1. 验证记分权限（组织者或指定记分员）
 * 2. 验证比分范围（0-30）
 * 3. 创建比分记录
 * 4. 更新比赛状态为确认中
 * 
 * 入参：{ activityId, matchId, team1Score, team2Score }
 * 出参：{ success, data: { match } }
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { activityId, matchId, team1Score, team2Score } = event;
  
  // 验证必填字段
  if (!activityId || !matchId) {
    return {
      success: false,
      error: '活动ID和比赛ID不能为空'
    };
  }
  
  // 验证比分范围
  if (team1Score < 0 || team1Score > 30 || team2Score < 0 || team2Score > 30) {
    return {
      success: false,
      error: '比分必须在0-30之间'
    };
  }
  
  try {
    // 查询活动
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
        error: '只有组织者才能记分'
      };
    }
    
    // 查询比赛
    const matchResult = await db.collection('matches').doc(matchId).get();
    
    if (!matchResult.data) {
      return {
        success: false,
        error: '比赛不存在'
      };
    }
    
    const match = matchResult.data;
    
    console.log('比赛当前状态:', match.status);
    
    // 验证比赛属于该活动
    if (match.activity_id !== activityId) {
      return {
        success: false,
        error: '比赛不属于该活动'
      };
    }
    
    // 验证比赛状态（pending/playing都可以提交比分，confirming可以重新提交）
    if (match.status === 'confirmed') {
      return {
        success: false,
        error: '比赛已完成或不存在'
      };
    }
    
    // 获取队伍信息来判断用户属于哪个队伍
    const team1Result = await db.collection('teams').doc(match.team1_id).get();
    const team2Result = await db.collection('teams').doc(match.team2_id).get();
    
    const team1Members = team1Result.data?.members || [];
    const team2Members = team2Result.data?.members || [];
    
    console.log('team1 成员:', team1Members);
    console.log('team2 成员:', team2Members);
    console.log('当前用户:', openid);
    
    // 判断记分者属于哪个队伍
    const isInTeam1 = team1Members.includes(openid);
    const isInTeam2 = team2Members.includes(openid);
    
    console.log('是否在team1:', isInTeam1);
    console.log('是否在team2:', isInTeam2);
    
    // 提交比分时：如果在某队伍中则自动确认该队，否则双方都不自动确认（等确认阶段再操作）
    const team1Confirmed = isInTeam1;
    const team2Confirmed = isInTeam2;

    // 更新比赛比分
    await db.collection('matches').doc(matchId).update({
      data: {
        team1_score: team1Score,
        team2_score: team2Score,
        status: 'confirming',
        score_submitter: openid,
        team1_confirmed: team1Confirmed,
        team2_confirmed: team2Confirmed
      }
    });
    
    // 获取更新后的比赛信息
    const updatedMatch = await db.collection('matches').doc(matchId).get();
    
    return {
      success: true,
      data: {
        match: updatedMatch.data
      }
    };
  } catch (err) {
    console.error('提交比分失败：', err);
    return {
      success: false,
      error: err.message || '提交比分失败'
    };
  }
};
