/**
 * getRankings 云函数 - 获取排名
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
  const { activityId, type = 'all' } = event;
  
  if (!activityId) {
    return {
      success: false,
      error: '活动ID不能为空'
    };
  }
  
  try {
    const registrationsResult = await db.collection('registrations').where({
      activity_id: activityId
    }).get();
    
    const registrations = registrationsResult.data || [];
    
    const regNicknames = {};
    registrations.forEach(reg => {
      regNicknames[reg.user_id] = reg.nickname;
    });
    
    const userIds = registrations.map(r => r.user_id);
    const usersResult = await db.collection('users').where({
      _openid: db.command.in(userIds)
    }).get();
    
    const usersMap = {};
    (usersResult.data || []).forEach(user => {
      usersMap[user._openid] = user;
    });
    
    const scoresResult = await db.collection('scores').where({
      activity_id: activityId
    }).get();
    
    const scores = scoresResult.data || [];
    
    const individualScores = {};
    
    const userTotalScores = {};
    scores.forEach(s => {
      if (!userTotalScores[s.user_id]) {
        userTotalScores[s.user_id] = {
          total: 0,
          group: 0,
          challenge: 0,
          final: 0
        };
      }
      userTotalScores[s.user_id].total += s.score_change;
      if (s.source === 'group') {
        userTotalScores[s.user_id].group += s.score_change;
      } else if (s.source === 'challenge') {
        userTotalScores[s.user_id].challenge += s.score_change;
      } else if (s.source === 'final') {
        userTotalScores[s.user_id].final += s.score_change;
      }
    });
    
    for (const reg of registrations) {
      const userScore = userTotalScores[reg.user_id] || { total: 0, group: 0, challenge: 0, final: 0 };
      
       individualScores[reg.user_id] = {
         userId: reg.user_id,
         nickname: (reg.nickname || usersMap[reg.user_id]?.nickname || '').toString(),
         avatar: reg.avatar || usersMap[reg.user_id]?.avatar || '',
         level: reg.level || 5,
         teamId: reg.team_id,
         groupScore: userScore.group,
         challengeScore: userScore.challenge,
         finalScore: userScore.final,
         totalScore: userScore.total
       };
    }
    
    const individualRankings = Object.values(individualScores).sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      return a.nickname.localeCompare(b.nickname);
    }).map((item, index) => ({
      ...item,
      rank: index + 1
    }));
    
    const teamsResult = await db.collection('teams').where({
      activity_id: activityId
    }).get();
    
    const teams = teamsResult.data || [];
    
    const teamRankings = teams.map(team => {
      const teamScores = scores.filter(s => s.team_id === team._id);
      
      const uniqueUserScores = {};
      teamScores.forEach(s => {
        if (!uniqueUserScores[s.user_id]) {
          uniqueUserScores[s.user_id] = 0;
        }
        uniqueUserScores[s.user_id] += s.score_change;
      });
      
      const uniqueScores = Object.entries(uniqueUserScores).map(([user_id, score_change]) => ({
        user_id,
        score_change,
        source: teamScores.find(s => s.user_id === user_id)?.source || 'group'
      }));
      
      const totalScore = calculateTeamTotalScore(uniqueScores);
      const groupScore = calculateTeamTotalScore(uniqueScores.filter(s => s.source === 'group'));
      const challengeScore = calculateTeamTotalScore(uniqueScores.filter(s => s.source === 'challenge'));
      
       const members = (team.members || []).map(memberId => {
         const reg = registrations.find(r => r.user_id === memberId);
         return {
           userId: memberId,
           nickname: (regNicknames[memberId] || usersMap[memberId]?.nickname || '未知用户').toString(),
           avatar: reg?.avatar || usersMap[memberId]?.avatar || '',
           level: reg?.level || usersMap[memberId]?.level || 5
         };
       });
      
      return {
        teamId: team._id,
        name: team.name || '待命名队伍',
        captainId: team.captain_id,
        members,
        totalScore,
        groupScore,
        challengeScore
      };
    }).sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      return a.name.localeCompare(b.name);
    }).map((item, index) => ({
      ...item,
      rank: index + 1
    }));
    
    const result = { success: true };
    
    if (type === 'individual' || type === 'all') {
      result.data = result.data || {};
      result.data.individualRankings = individualRankings;
    }
    
    if (type === 'team' || type === 'all') {
      result.data = result.data || {};
      result.data.teamRankings = teamRankings;
    }
    
    return result;
  } catch (err) {
    console.error('获取排名失败：', err);
    return {
      success: false,
      error: err.message || '获取排名失败'
    };
  }
};
