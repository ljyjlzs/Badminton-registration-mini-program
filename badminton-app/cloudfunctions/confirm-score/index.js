/**
 * confirmScore 云函数 - 确认/拒绝比分
 * 
 * 积分规则：
 * - 小组赛：胜者+比分差，败者-比分差
 * - 挑战赛：胜者+10分，败者+0分
 * - 决赛：胜者+15分，败者+0分
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
      return { team1ScoreChange: 10, team2ScoreChange: 0 };
    } else if (team2Score > team1Score) {
      return { team1ScoreChange: 0, team2ScoreChange: 10 };
    }
  } else if (round === 'final') {
    if (team1Score > team2Score) {
      return { team1ScoreChange: 15, team2ScoreChange: 0 };
    } else if (team2Score > team1Score) {
      return { team1ScoreChange: 0, team2ScoreChange: 15 };
    }
  }
  return { team1ScoreChange: 0, team2ScoreChange: 0 };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { activityId, matchId, confirmed } = event;
  
  if (!activityId || !matchId) {
    return { success: false, error: '活动ID和比赛ID不能为空' };
  }
  
  try {
    const matchResult = await db.collection('matches').doc(matchId).get();
    if (!matchResult.data) {
      return { success: false, error: '比赛不存在' };
    }
    
    const match = matchResult.data;
    
    console.log('confirm-score - 当前用户:', openid);
    console.log('confirm-score - 比赛team1_id:', match.team1_id);
    console.log('confirm-score - 比赛team2_id:', match.team2_id);
    
    // 直接从teams表获取成员来判断用户属于哪个队伍
    const team1Result = await db.collection('teams').doc(match.team1_id).get();
    const team2Result = await db.collection('teams').doc(match.team2_id).get();
    
    const team1Members = team1Result.data?.members || [];
    const team2Members = team2Result.data?.members || [];
    
    console.log('confirm-score - team1成员:', team1Members);
    console.log('confirm-score - team2成员:', team2Members);
    
    const isInTeam1 = team1Members.includes(openid);
    const isInTeam2 = team2Members.includes(openid);
    
    // 获取活动信息判断是否为组织者
    const activityResult = await db.collection('activities').doc(activityId).get();
    const isOrganizer = activityResult.data?.organizer_id === openid;
    
    console.log('confirm-score - 是否在team1:', isInTeam1, '是否在team2:', isInTeam2, '是否组织者:', isOrganizer);
    
    // 组织者也可以确认比分（方便组织者代为操作）
    if (!isInTeam1 && !isInTeam2 && !isOrganizer) {
      return { success: false, error: '只有比赛参与者或组织者才能确认比分' };
    }
    
    // 如果用户既不是参与者也不是组织者，不应该到这里
    // 参与者按队伍确认，组织者按队伍ID确认
    let userTeamId;
    let isTeam1;
    
    if (isInTeam1) {
      userTeamId = match.team1_id;
      isTeam1 = true;
    } else if (isInTeam2) {
      userTeamId = match.team2_id;
      isTeam1 = false;
    } else {
      // 组织者不在任何队伍中，视为同时确认双方
      isTeam1 = null;
    }
    
    const updateData = {};
    if (isTeam1 === true) {
      updateData.team1_confirmed = confirmed;
    } else if (isTeam1 === false) {
      updateData.team2_confirmed = confirmed;
    } else {
      // 组织者确认：同时确认双方
      updateData.team1_confirmed = confirmed;
      updateData.team2_confirmed = confirmed;
    }
    
    await db.collection('matches').doc(matchId).update({ data: updateData });
    
    const updatedMatch = await db.collection('matches').doc(matchId).get();
    const currentMatch = updatedMatch.data;
    
    if (!confirmed) {
      return {
        success: true,
        data: { match: currentMatch, status: 'rejected', message: '已拒绝比分，等待重新录入' }
      };
    }
    
    if (currentMatch.team1_confirmed && currentMatch.team2_confirmed) {
      let scoreChanges;
      if (currentMatch.round === 'group') {
        scoreChanges = calculateGroupScore(currentMatch.team1_score, currentMatch.team2_score);
      } else {
        scoreChanges = calculateChallengeScore(currentMatch.team1_score, currentMatch.team2_score, currentMatch.round);
      }
      
      const team1 = await db.collection('teams').doc(match.team1_id).get();
      const team2 = await db.collection('teams').doc(match.team2_id).get();
      
      const scoreRecords = [];
      
      for (const memberId of (team1.data?.members || [])) {
        await db.collection('scores').add({
          data: {
            activity_id: activityId,
            user_id: memberId,
            team_id: match.team1_id,
            match_id: matchId,
            score_change: scoreChanges.team1ScoreChange,
            source: currentMatch.round
          }
        });
      }
      
      for (const memberId of (team2.data?.members || [])) {
        await db.collection('scores').add({
          data: {
            activity_id: activityId,
            user_id: memberId,
            team_id: match.team2_id,
            match_id: matchId,
            score_change: scoreChanges.team2ScoreChange,
            source: currentMatch.round
          }
        });
      }
      
      await db.collection('matches').doc(matchId).update({
        data: { status: 'confirmed', completed_at: db.serverDate() }
      });
      
      return {
        success: true,
        data: {
          match: { ...currentMatch, status: 'confirmed' },
          status: 'confirmed',
          message: '比分已确认，比赛结束'
        }
      };
    }
    
    return {
      success: true,
      data: {
        match: currentMatch,
        status: 'waiting',
        message: '已确认，等待对方确认'
      }
    };
  } catch (err) {
    console.error('确认比分失败：', err);
    return { success: false, error: err.message || '确认比分失败' };
  }
};