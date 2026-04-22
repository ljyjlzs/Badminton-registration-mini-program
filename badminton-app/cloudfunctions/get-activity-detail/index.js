/**
 * getActivityDetail 云函数 - 获取活动详情
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
    // 获取活动
    const activityResult = await db.collection('activities').doc(activityId).get();
    
    if (!activityResult.data) {
      return {
        success: false,
        error: '活动不存在'
      };
    }
    
    const activity = activityResult.data;
    
    // 获取报名列表
    const registrationsResult = await db.collection('registrations')
      .where({
        activity_id: activityId
      })
      .get();

    const isSingles = activity.type === 'singles';
    const isFixedDoubles = activity.type === 'fixed-doubles';
    
    // 获取用户信息
    const userIds = (registrationsResult.data || []).map(r => r.user_id);
    let usersMap = {};
    
    if (userIds.length > 0) {
      const usersResult = await db.collection('users')
        .where({
          _openid: db.command.in(userIds)
        })
        .get();
      
      (usersResult.data || []).forEach(user => {
        usersMap[user._openid] = user;
      });
    }
    
    // 组合报名信息
    const registrations = (registrationsResult.data || []).map(reg => ({
      ...reg,
      nickname: reg.nickname || usersMap[reg.user_id]?.nickname || '未知用户',
      avatar: reg.avatar || usersMap[reg.user_id]?.avatar || '',
      level: reg.level,
      partner_id: reg.partner_id || null
    }));

    // 构建报名昵称和头像映射
    const regNicknames = {};
    const regAvatars = {};
    registrations.forEach(reg => {
      regNicknames[reg.user_id] = reg.nickname;
      regAvatars[reg.user_id] = reg.avatar;
    });
    
    // 为报名记录添加搭档昵称
    registrations.forEach(reg => {
      if (reg.partner_id && regNicknames[reg.partner_id]) {
        reg.partner_nickname = regNicknames[reg.partner_id];
      }
    });

    // 获取当前用户的报名记录
    const userRegistration = registrations.find(r => r.user_id === openid);
    
    let matches = [];
    let teams = [];
    
    if (activity.status !== 'registering') {
      const matchesResult = await db.collection('matches')
        .where({
          activity_id: activityId
        })
        .get();
      
      const teamIds = new Set();
      (matchesResult.data || []).forEach(m => {
        if (m.team1_id) teamIds.add(m.team1_id);
        if (m.team2_id) teamIds.add(m.team2_id);
      });
      
      let teamsMap = {};
      if (teamIds.size > 0) {
        const teamsResult = await db.collection('teams')
          .where({
            _id: db.command.in([...teamIds])
          })
          .get();
        
        (teamsResult.data || []).forEach(team => {
          teamsMap[team._id] = team;
        });
        
        teams = Object.values(teamsMap).map(team => ({
          _id: team._id,
          name: team.name || '待命名队伍',
          captain_id: team.captain_id,
          members: (team.members || []).map(m => regNicknames[m] || m).join(' / ') || '',
          memberAvatars: (team.members || []).map(m => regAvatars[m] || ''),
          total_level: team.total_level || 0
        }));
      }
      
      matches = (matchesResult.data || []).map(match => {
        const team1 = teamsMap[match.team1_id] || {};
        const team2 = teamsMap[match.team2_id] || {};
        
        const team1Members = team1.members || [];
        const team2Members = team2.members || [];
        
        let team1Display, team2Display;
        
        if (isSingles) {
          team1Display = team1Members.length > 0 ? (regNicknames[team1Members[0]] || team1Members[0] || '选手1') : '选手1';
          team2Display = team2Members.length > 0 ? (regNicknames[team2Members[0]] || team2Members[0] || '选手2') : '选手2';
        } else {
          team1Display = team1.name || '队伍1';
          team2Display = team2.name || '队伍2';
        }
        
        return {
          ...match,
          team1_name: team1Display,
          team2_name: team2Display,
          team1_totalLevel: team1.total_level || 0,
          team2_totalLevel: team2.total_level || 0,
          team1_members: team1Members.map(m => regNicknames[m] || m).join(' / ') || '',
          team2_members: team2Members.map(m => regNicknames[m] || m).join(' / ') || ''
        };
      });
    }
    
    // 根据比赛状态自动计算活动状态
    if (activity.status !== 'registering' && matches.length > 0) {
      const hasPlaying = matches.some(m => m.status === 'playing' || m.status === 'confirming');
      const allGroupConfirmed = matches.filter(m => m.round === 'group').every(m => m.status === 'confirmed');
      const allChallengeConfirmed = matches.filter(m => m.round === 'challenge').every(m => m.status === 'confirmed');
      const allFinalConfirmed = matches.filter(m => m.round === 'final').every(m => m.status === 'confirmed');
      const hasChallenge = matches.some(m => m.round === 'challenge');
      const hasFinal = matches.some(m => m.round === 'final');
      const hasGroup = matches.some(m => m.round === 'group');
      
      if (activity.status === 'grouping') {
        if (hasPlaying) {
          activity.status = 'playing';
        }
      } else if (activity.status === 'playing') {
        if (hasChallenge && allGroupConfirmed && !hasPlaying) {
          activity.status = 'playing';
        }
      } else if (activity.status === 'challenge') {
        if (hasFinal) {
          if (allFinalConfirmed && !hasPlaying) {
            activity.status = 'finished';
          } else {
            activity.status = 'final';
          }
        }
      } else if (activity.status === 'final') {
        if (allFinalConfirmed && !hasPlaying) {
          activity.status = 'finished';
        }
      } else if (activity.status === 'finished') {
        // keep finished
      } else {
        if (hasPlaying) {
          activity.status = 'playing';
        } else if (hasFinal && allFinalConfirmed) {
          activity.status = 'finished';
        }
      }
    }
    
    return {
      success: true,
      data: {
        activity,
        registrations,
        matches,
        teams,
        userRegistration,
        isOrganizer: activity.organizer_id === openid
      }
    };
  } catch (err) {
    console.error('获取活动详情失败：', err);
    return {
      success: false,
      error: err.message || '获取活动详情失败'
    };
  }
};
