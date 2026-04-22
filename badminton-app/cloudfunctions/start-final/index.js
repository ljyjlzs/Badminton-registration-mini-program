/**
 * startFinal 云函数 - 开始决赛
 * 
 * 根据活动类型走不同逻辑：
 * 
 * 固搭双打 / 单打：
 *   队伍从头到尾不变，按队伍积分排名取前2队直接打决赛，不新建队伍
 * 
 * 轮换双打：
 *   按个人积分排名前4，蛇形组队：第1名+第4名 vs 第2名+第3名
 *   创建新的决赛队伍（因为轮换双打下 team 是临时搭档）
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

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
        error: '只有组织者才能开始决赛'
      };
    }
    
    // 确认挑战赛已结束
    const challengeMatchesResult = await db.collection('matches').where({
      activity_id: activityId,
      round: 'challenge'
    }).get();
    
    const challengeMatches = challengeMatchesResult.data || [];
    const unfinishedMatches = challengeMatches.filter(m => m.status !== 'confirmed');
    if (unfinishedMatches.length > 0) {
      return {
        success: false,
        error: `还有${unfinishedMatches.length}场挑战赛未完成`
      };
    }
    
    // 获取所有非决赛队伍（排除轮换双打可能创建的决赛队伍）
    const teamsResult = await db.collection('teams').where({
      activity_id: activityId,
      is_final_team: _.neq(true)
    }).get();
    
    const teams = teamsResult.data || [];
    
    const activityType = activity.type || 'doubles';
    const isDoublesRotation = activityType === 'doubles';
    
    if (isDoublesRotation) {
      // ===== 轮换双打：按个人积分蛇形组队 =====
      return await handleDoublesFinal(activityId, activity, teams);
    } else {
      // ===== 固搭双打 / 单打：按队伍积分取前2队 =====
      return await handleFixedFinal(activityId, activity, teams);
    }
  } catch (err) {
    console.error('开始决赛失败：', err);
    return {
      success: false,
      error: err.message || '开始决赛失败'
    };
  }
};

/**
 * 固搭双打 / 单打：按队伍积分排名，取前2队直接打决赛
 */
async function handleFixedFinal(activityId, activity, teams) {
  // 计算每个队伍的总积分
  const teamScores = [];
  for (const team of teams) {
    const scoresResult = await db.collection('scores').where({
      activity_id: activityId,
      team_id: team._id
    }).get();
    
    const totalScore = (scoresResult.data || []).reduce((total, score) => total + score.score_change, 0);
    teamScores.push({
      ...team,
      totalScore: totalScore
    });
  }
  
  teamScores.sort((a, b) => b.totalScore - a.totalScore);
  
  if (teamScores.length < 2) {
    return {
      success: false,
      error: '队伍数量不足，无法进行决赛'
    };
  }
  
  const finalTeams = teamScores.slice(0, 2);
  
  // 直接用原有队伍创建决赛，不新建队伍
  const matchData = {
    activity_id: activityId,
    round: 'final',
    venue: '决赛',
    team1_id: finalTeams[0]._id,
    team2_id: finalTeams[1]._id,
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
  
  await db.collection('activities').doc(activityId).update({
    data: {
      status: 'final'
    }
  });
  
  return {
    success: true,
    data: {
      finalMatch: {
        ...matchData,
        _id: matchResult._id,
        team1: finalTeams[0],
        team2: finalTeams[1]
      },
      teamRankings: teamScores.map((t, i) => ({
        rank: i + 1,
        name: t.name,
        totalScore: Math.round(t.totalScore * 100) / 100
      })),
      message: `决赛已创建：${finalTeams[0].name || '队伍1'} vs ${finalTeams[1].name || '队伍2'}`
    }
  };
}

/**
 * 轮换双打：按个人积分排名前4，蛇形组队
 */
async function handleDoublesFinal(activityId, activity, teams) {
  // 汇总每个人的个人总积分
  const playerScores = {};
  
  for (const team of teams) {
    const teamMembers = team.members || [];
    
    const scoresResult = await db.collection('scores').where({
      activity_id: activityId,
      team_id: team._id
    }).get();
    
    const teamTotalScore = (scoresResult.data || []).reduce((total, score) => total + score.score_change, 0);
    const perPlayerScore = teamMembers.length > 0 ? teamTotalScore / teamMembers.length : 0;
    
    for (const memberId of teamMembers) {
      if (!playerScores[memberId]) {
        const regResult = await db.collection('registrations').where({
          activity_id: activityId,
          user_id: memberId
        }).get();
        
        const reg = regResult.data && regResult.data[0];
        playerScores[memberId] = {
          userId: memberId,
          totalScore: 0,
          nickname: reg ? reg.nickname : memberId,
          avatar: reg ? reg.avatar : '',
          level: reg ? (reg.level || 0) : 0
        };
      }
      playerScores[memberId].totalScore += perPlayerScore;
    }
  }
  
  const rankedPlayers = Object.values(playerScores).sort((a, b) => b.totalScore - a.totalScore);
  
  if (rankedPlayers.length < 4) {
    return {
      success: false,
      error: `参与人数不足（需要至少4人，当前${rankedPlayers.length}人），无法进行决赛`
    };
  }
  
  const top4 = rankedPlayers.slice(0, 4);
  const team1Players = [top4[0], top4[3]];
  const team2Players = [top4[1], top4[2]];
  
  const team1Data = {
    activity_id: activityId,
    name: `决赛A队(${team1Players.map(p => p.nickname).join('&')})`,
    members: team1Players.map(p => p.userId),
    captain_id: team1Players[0].userId,
    is_final_team: true,
    created_at: db.serverDate()
  };
  
  const team2Data = {
    activity_id: activityId,
    name: `决赛B队(${team2Players.map(p => p.nickname).join('&')})`,
    members: team2Players.map(p => p.userId),
    captain_id: team2Players[0].userId,
    is_final_team: true,
    created_at: db.serverDate()
  };
  
  const team1Result = await db.collection('teams').add({ data: team1Data });
  const team2Result = await db.collection('teams').add({ data: team2Data });
  
  const matchData = {
    activity_id: activityId,
    round: 'final',
    venue: '决赛',
    team1_id: team1Result._id,
    team2_id: team2Result._id,
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
  
  await db.collection('activities').doc(activityId).update({
    data: {
      status: 'final'
    }
  });
  
  return {
    success: true,
    data: {
      finalMatch: {
        ...matchData,
        _id: matchResult._id,
        team1: {
          ...team1Data,
          _id: team1Result._id,
          playerNames: team1Players.map(p => p.nickname)
        },
        team2: {
          ...team2Data,
          _id: team2Result._id,
          playerNames: team2Players.map(p => p.nickname)
        }
      },
      playerRankings: top4.map((p, i) => ({
        rank: i + 1,
        nickname: p.nickname,
        totalScore: Math.round(p.totalScore * 100) / 100
      })),
      message: `决赛已创建：${team1Data.name} vs ${team2Data.name}`
    }
  };
}
