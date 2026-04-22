/**
 * startChallenge 云函数 - 开始挑战赛
 * 
 * 流程：
 * 1. 确认所有小组赛已结束
 * 2. 计算各队积分，排名
 * 3. 创建1场挑战赛：倒数第N名 vs 第一名（确保两队无共享成员）
 * 4. 更新活动状态为挑战赛
 * 
 * 注意：轮换双打下同一个人可能出现在多个 team 中，
 * 因此从末位往上扫描，找到第一个与第一名无共享成员的队伍。
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function calculateTeamTotalScore(scores) {
  return (scores || []).reduce((total, score) => total + score.score_change, 0);
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { activityId } = event;
  
  if (!activityId) {
    return {
      success: false,
      error: '活动ID不能为空'
    };
  }
  
  try {
    const activityResult = await db.collection('activities').doc(activityId).get();
    
    if (!activityResult.data) {
      return {
        success: false,
        error: '活动不存在'
      };
    }
    
    const activity = activityResult.data;
    
    if (activity.organizer_id !== openid) {
      return {
        success: false,
        error: '只有组织者才能开始挑战赛'
      };
    }
    
    const matchesResult = await db.collection('matches').where({
      activity_id: activityId,
      round: 'group'
    }).get();
    
    const groupMatches = matchesResult.data || [];
    
    const unfinishedMatches = groupMatches.filter(m => m.status !== 'confirmed');
    if (unfinishedMatches.length > 0) {
      return {
        success: false,
        error: `还有${unfinishedMatches.length}场比赛未完成`
      };
    }
    
    const teamsResult = await db.collection('teams').where({
      activity_id: activityId
    }).get();
    
    const teams = teamsResult.data || [];
    
    const teamScores = [];
    for (const team of teams) {
      const scoresResult = await db.collection('scores').where({
        activity_id: activityId,
        team_id: team._id,
        source: 'group'
      }).get();
      
      const totalScore = calculateTeamTotalScore(scoresResult.data);
      teamScores.push({
        ...team,
        groupScore: totalScore
      });
    }
    
    teamScores.sort((a, b) => b.groupScore - a.groupScore);
    
    if (teamScores.length < 2) {
      return {
        success: false,
        error: '队伍不足，无法进行挑战赛'
      };
    }
    
    const firstPlace = teamScores[0];
    const firstPlaceMembers = new Set(firstPlace.members || []);
    
    // 从末位往上扫描，找到第一个与第一名无共享成员的队伍
    let challenger = null;
    for (let i = teamScores.length - 1; i >= 1; i--) {
      const candidate = teamScores[i];
      const candidateMembers = new Set(candidate.members || []);
      const hasOverlap = [...firstPlaceMembers].some(m => candidateMembers.has(m));
      if (!hasOverlap) {
        challenger = candidate;
        break;
      }
    }
    
    if (!challenger) {
      return {
        success: false,
        error: '所有队伍都与第一名有共享成员，无法组成挑战赛'
      };
    }
    
    // 创建1场挑战赛：挑战者挑战第一名
    const createdMatches = [];
    const matchData = {
      activity_id: activityId,
      round: 'challenge',
      venue: '挑战赛',
      team1_id: challenger._id,
      team2_id: firstPlace._id,
      team1_score: null,
      team2_score: null,
      status: 'pending',
      score_submitter: null,
      team1_confirmed: false,
      team2_confirmed: false,
      completed_at: null,
      created_at: db.serverDate()
    };
    
    const matchResult = await db.collection('matches').add({
      data: matchData
    });
    
    createdMatches.push({
      ...matchData,
      _id: matchResult._id,
      team1: challenger,
      team2: firstPlace
    });
    
    await db.collection('activities').doc(activityId).update({
      data: {
        status: 'challenge'
      }
    });
    
    return {
      success: true,
      data: {
        firstPlace,
        challenger,
        allTeamScores: teamScores,
        challengeMatches: createdMatches,
        message: `挑战赛已创建：${challenger.name || '挑战者'} vs ${firstPlace.name || '首位'}`
      }
    };
  } catch (err) {
    console.error('开始挑战赛失败：', err);
    return {
      success: false,
      error: err.message || '开始挑战赛失败'
    };
  }
};
