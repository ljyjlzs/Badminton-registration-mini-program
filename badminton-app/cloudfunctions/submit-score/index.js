/**
 * submitScore 云函数 - 提交/修改比分
 * 
 * 功能：
 * 1. 验证记分权限（对局双方队员 或 组织者）
 * 2. 验证比分范围（0-30）
 * 3. 提交比分并直接确认（无需对方确认）
 * 4. 计算积分并记录
 * 
 * 入参：{ activityId, matchId, team1Score, team2Score }
 * 出参：{ success, data: { match } }
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function calculateGroupScore(team1Score, team2Score) {
  const scoreDiff = Math.abs(team1Score - team2Score);
  if (team1Score > team2Score) {
    return { team1ScoreChange: scoreDiff, team2ScoreChange: -scoreDiff };
  } else if (team2Score > team1Score) {
    return { team1ScoreChange: -scoreDiff, team2ScoreChange: scoreDiff };
  } else {
    return { team1ScoreChange: 0, team2ScoreChange: 0 };
  }
}

function calculateChallengeScore(team1Score, team2Score, round) {
  if (round === 'challenge') {
    if (team1Score > team2Score) {
      return { team1ScoreChange: 10, team2ScoreChange: -10 };
    } else if (team2Score > team1Score) {
      return { team1ScoreChange: -10, team2ScoreChange: 10 };
    }
  } else if (round === 'final') {
    if (team1Score > team2Score) {
      return { team1ScoreChange: 15, team2ScoreChange: -15 };
    } else if (team2Score > team1Score) {
      return { team1ScoreChange: -15, team2ScoreChange: 15 };
    }
  }
  return { team1ScoreChange: 0, team2ScoreChange: 0 };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { activityId, matchId, team1Score, team2Score } = event;
  
  if (!activityId || !matchId) {
    return { success: false, error: '活动ID和比赛ID不能为空' };
  }
  
  if (team1Score < 0 || team1Score > 30 || team2Score < 0 || team2Score > 30) {
    return { success: false, error: '比分必须在0-30之间' };
  }
  
  if (team1Score === team2Score) {
    return { success: false, error: '比分不能相同' };
  }
  
  try {
    // 查询活动
    const activityResult = await db.collection('activities').doc(activityId).get();
    if (!activityResult.data) {
      return { success: false, error: '活动不存在' };
    }
    const activity = activityResult.data;
    const isOrganizer = activity.organizer_id === openid;
    
    // 查询比赛
    const matchResult = await db.collection('matches').doc(matchId).get();
    if (!matchResult.data) {
      return { success: false, error: '比赛不存在' };
    }
    const match = matchResult.data;
    
    if (match.activity_id !== activityId) {
      return { success: false, error: '比赛不属于该活动' };
    }
    
    // 允许修改已确认的比赛（pending / playing / confirmed 都可以）
    // confirmed 时需要先删除旧积分记录再重新计算
    
    // 获取队伍信息
    const team1Result = await db.collection('teams').doc(match.team1_id).get();
    const team2Result = await db.collection('teams').doc(match.team2_id).get();
    
    const team1Members = team1Result.data?.members || [];
    const team2Members = team2Result.data?.members || [];
    
    const isInTeam1 = team1Members.includes(openid);
    const isInTeam2 = team2Members.includes(openid);
    const isPlayer = isInTeam1 || isInTeam2;
    
    // 权限验证：对局双方队员 或 组织者
    if (!isPlayer && !isOrganizer) {
      return { success: false, error: '只有对局双方或组织者才能填写比分' };
    }
    
    // 如果之前已确认（重新修改），先删除旧的积分记录
    if (match.status === 'confirmed') {
      await db.collection('scores').where({
        match_id: matchId
      }).remove();
    }
    
    // 如果比赛之前已经是 confirmed 状态要重新修改，需要把状态改回来
    // 更新比分，直接确认
    await db.collection('matches').doc(matchId).update({
      data: {
        team1_score: team1Score,
        team2_score: team2Score,
        status: 'confirmed',
        score_submitter: openid,
        completed_at: db.serverDate()
      }
    });
    
    // 计算积分
    let scoreChanges;
    if (match.round === 'group') {
      scoreChanges = calculateGroupScore(team1Score, team2Score);
    } else {
      scoreChanges = calculateChallengeScore(team1Score, team2Score, match.round);
    }
    
    // 记录积分
    for (const memberId of team1Members) {
      await db.collection('scores').add({
        data: {
          activity_id: activityId,
          user_id: memberId,
          team_id: match.team1_id,
          match_id: matchId,
          score_change: scoreChanges.team1ScoreChange,
          source: match.round
        }
      });
    }
    
    for (const memberId of team2Members) {
      await db.collection('scores').add({
        data: {
          activity_id: activityId,
          user_id: memberId,
          team_id: match.team2_id,
          match_id: matchId,
          score_change: scoreChanges.team2ScoreChange,
          source: match.round
        }
      });
    }
    
    const updatedMatch = await db.collection('matches').doc(matchId).get();
    
    return {
      success: true,
      data: {
        match: updatedMatch.data,
        message: '比分已提交'
      }
    };
  } catch (err) {
    console.error('提交比分失败：', err);
    return { success: false, error: err.message || '提交比分失败' };
  }
};
