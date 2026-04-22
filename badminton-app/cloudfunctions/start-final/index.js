/**
 * startFinal 云函数 - 开始决赛
 * 
 * 流程：
 * 1. 确认所有挑战赛已结束
 * 2. 汇总每个人的个人总积分（跨所有 team 的 scores 累加）
 * 3. 取个人排名前4，蛇形组队：第1名+第4名 vs 第2名+第3名
 * 4. 为决赛创建新的 team 记录
 * 5. 创建决赛比赛，更新活动状态
 * 
 * 注意：轮换双打下 team 是临时搭档，按个人积分排名更能体现真实实力。
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

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
    
    // 获取所有队伍
    const teamsResult = await db.collection('teams').where({
      activity_id: activityId
    }).get();
    
    const teams = teamsResult.data || [];
    
    // 汇总每个人的个人总积分
    const playerScores = {}; // userId -> { totalScore, name, avatar, level }
    
    for (const team of teams) {
      const teamMembers = team.members || [];
      
      // 获取该队伍的所有积分记录（包括小组赛和挑战赛）
      const scoresResult = await db.collection('scores').where({
        activity_id: activityId,
        team_id: team._id
      }).get();
      
      const teamTotalScore = (scoresResult.data || []).reduce((total, score) => total + score.score_change, 0);
      
      // 将队伍积分平均分配给每个成员（双打两人平分）
      const perPlayerScore = teamMembers.length > 0 ? teamTotalScore / teamMembers.length : 0;
      
      for (const memberId of teamMembers) {
        if (!playerScores[memberId]) {
          // 从 registrations 获取成员信息
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
    
    // 按个人积分降序排列
    const rankedPlayers = Object.values(playerScores).sort((a, b) => b.totalScore - a.totalScore);
    
    if (rankedPlayers.length < 4) {
      return {
        success: false,
        error: `参与人数不足（需要至少4人，当前${rankedPlayers.length}人），无法进行决赛`
      };
    }
    
    // 取前4名，蛇形组队：第1名+第4名 vs 第2名+第3名
    const top4 = rankedPlayers.slice(0, 4);
    const team1Players = [top4[0], top4[3]]; // 第1名 + 第4名
    const team2Players = [top4[1], top4[2]]; // 第2名 + 第3名
    
    // 创建决赛用的两个新 team
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
    
    // 创建决赛比赛
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
  } catch (err) {
    console.error('开始决赛失败：', err);
    return {
      success: false,
      error: err.message || '开始决赛失败'
    };
  }
};
