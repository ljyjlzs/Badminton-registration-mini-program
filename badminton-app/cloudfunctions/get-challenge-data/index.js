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
    return { success: false, error: '活动ID不能为空' };
  }
  
  try {
    const activityResult = await db.collection('activities').doc(activityId).get();
    if (!activityResult.data) {
      return { success: false, error: '活动不存在' };
    }
    
    const isOrganizer = activityResult.data.organizer_id === openid;
    
    const registrationsResult = await db.collection('registrations')
      .where({ activity_id: activityId })
      .get();
    
    const registrations = registrationsResult.data || [];
    
    const regNicknames = {};
    const regAvatars = {};
    registrations.forEach(reg => {
      regNicknames[reg.user_id] = reg.nickname;
      regAvatars[reg.user_id] = reg.avatar || '';
    });
    
    const teamsResult = await db.collection('teams')
      .where({ activity_id: activityId })
      .get();
    
    const teams = teamsResult.data || [];
    
    const qualifiedTeams = teams
      .filter(t => !t.is_eliminated)
      .map(t => ({
        ...t,
        memberNames: (t.members || []).map(m => regNicknames[m] || m).join(' / '),
        memberAvatars: (t.members || []).map(m => regAvatars[m] || '')
      }));
    
    const eliminatedTeams = teams
      .filter(t => t.is_eliminated)
      .map(t => ({
        ...t,
        memberNames: (t.members || []).map(m => regNicknames[m] || m).join(' / '),
        memberAvatars: (t.members || []).map(m => regAvatars[m] || '')
      }));
    
    // 获取淘汰队伍的成员信息（从 teams 表的 members 字段获取）
    const eliminatedPlayerIds = eliminatedTeams.flatMap(t => t.members || []);
    const eliminatedPlayers = eliminatedPlayerIds.map(userId => {
      const reg = registrations.find(r => r.user_id === userId);
      return {
        userId: userId,
        nickname: regNicknames[userId] || '未知用户',
        avatar: regAvatars[userId] || '',
        level: reg?.level || 5
      };
    });
    
    const matchesResult = await db.collection('matches')
      .where({
        activity_id: activityId,
        round: 'challenge'
      })
      .get();
    
    const challengeMatches = matchesResult.data || [];
    
    let challengeMatch = null;
    if (challengeMatches.length > 0) {
      const match = challengeMatches[0];
      const team1 = teams.find(t => t._id === match.team1_id);
      const team2 = teams.find(t => t._id === match.team2_id);
      
      challengeMatch = {
        ...match,
        team1_name: team1?.name || '队伍1',
        team2_name: team2?.name || '队伍2',
        team1_members: (team1?.members || []).map(m => regNicknames[m] || m).join(' / '),
        team2_members: (team2?.members || []).map(m => regNicknames[m] || m).join(' / ')
      };
    }
    
    return {
      success: true,
      data: {
        qualifiedTeams,
        eliminatedPlayers,
        challengeMatch,
        isOrganizer
      }
    };
  } catch (err) {
    return { success: false, error: err.message || '获取挑战赛数据失败' };
  }
};
