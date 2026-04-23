/**
 * getActivities 云函数 - 获取活动列表
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { type, keyword } = event; // 'organized' | 'joined' | 'available' | 'search'
  
  try {
    let activities = [];
    
    if (type === 'search') {
      // 搜索可参加的活动（报名中状态，按关键词匹配名称或地点）
      try {
        let query = {
          status: 'registering'
        };
        
        const result = await db.collection('activities')
          .where(query)
          .orderBy('time', 'asc')
          .limit(100)
          .get();
        
        activities = result.data || [];
        
        // 关键词过滤（云数据库不支持模糊查询，在前端过滤）
        if (keyword && keyword.trim()) {
          const kw = keyword.trim().toLowerCase();
          // 类型中文映射
          const typeMap = {
            'singles': '单打',
            'doubles': '双打轮换',
            'fixed-doubles': '双打固搭'
          };
          activities = activities.filter(a => {
            const nameMatch = a.name && a.name.toLowerCase().includes(kw);
            const locationMatch = a.location && a.location.toLowerCase().includes(kw);
            const typeCn = typeMap[a.type] || '';
            const typeMatch = typeCn.includes(kw) || (a.type && a.type.toLowerCase().includes(kw));
            return nameMatch || locationMatch || typeMatch;
          });
        }
      } catch (e) {
        console.log('查询search失败:', e.message);
        activities = [];
      }
    } else if (type === 'organized') {
      try {
        const result = await db.collection('activities')
          .where({
            organizer_id: openid
          })
          .orderBy('created_at', 'desc')
          .limit(100)
          .get();
        
        activities = result.data || [];
      } catch (e) {
        console.log('查询organized失败:', e.message);
        activities = [];
      }
    } else if (type === 'joined') {
      try {
        const regResult = await db.collection('registrations')
          .where({
            user_id: openid
          })
          .limit(100)
          .get();
        
        const activityIds = (regResult.data || []).map(r => r.activity_id);
        
        if (activityIds.length > 0) {
          const actResult = await db.collection('activities')
            .where({
              _id: db.command.in(activityIds)
            })
            .orderBy('created_at', 'desc')
            .limit(100)
            .get();
          
          activities = actResult.data || [];
        }
      } catch (e) {
        console.log('查询joined失败:', e.message);
        activities = [];
      }
    } else if (type === 'available') {
      try {
        const result = await db.collection('activities')
          .where({
            status: 'registering'
          })
          .orderBy('time', 'asc')
          .limit(100)
          .get();
        
        activities = result.data || [];
      } catch (e) {
        console.log('查询available失败:', e.message);
        activities = [];
      }
    } else if (type === 'unavailable') {
      try {
        const result = await db.collection('activities')
          .where({
            status: db.command.in(['grouping', 'playing', 'challenge', 'final', 'finished'])
          })
          .orderBy('time', 'desc')
          .limit(100)
          .get();
        
        activities = result.data || [];
      } catch (e) {
        console.log('查询unavailable失败:', e.message);
        activities = [];
      }
    }
    
    // 根据比赛状态自动计算活动状态
    for (let activity of activities) {
      if (activity.status !== 'registering') {
        try {
          const matchesResult = await db.collection('matches')
            .where({
              activity_id: activity._id
            })
            .get();
          
          const matches = matchesResult.data || [];
          
          if (matches.length > 0) {
            const hasPlaying = matches.some(m => m.status === 'playing' || m.status === 'confirming');
            const allGroupConfirmed = matches.filter(m => m.round === 'group').every(m => m.status === 'confirmed');
            const allChallengeConfirmed = matches.filter(m => m.round === 'challenge').every(m => m.status === 'confirmed');
            const allFinalConfirmed = matches.filter(m => m.round === 'final').every(m => m.status === 'confirmed');
            const hasChallenge = matches.some(m => m.round === 'challenge');
            const hasFinal = matches.some(m => m.round === 'final');
            
            if (hasPlaying) {
              activity.status = 'playing';
            } else if (activity.status === 'challenge' && hasChallenge && allChallengeConfirmed && !hasFinal) {
              // 挑战赛全部结束但还没有决赛时，保持challenge状态
            } else if (activity.status === 'final' && allFinalConfirmed) {
              activity.status = 'finished';
            } else if (!hasChallenge && !hasFinal && allGroupConfirmed) {
              // 小组赛全部结束且没有挑战赛时，保持playing状态，等待组织者点击"开始挑战赛"
              activity.status = 'playing';
            } else if (hasChallenge && !hasFinal && allChallengeConfirmed) {
              // 挑战赛结束但没有决赛时，保持challenge状态
              activity.status = 'challenge';
            } else if (hasFinal && allFinalConfirmed) {
              // 决赛结束
              activity.status = 'finished';
            } else if (hasChallenge) {
              // 有挑战赛
              activity.status = 'challenge';
            } else if (hasFinal && !allFinalConfirmed) {
              // 有决赛且决赛未完成时，保持final状态
              activity.status = 'final';
            }
          }
        } catch (e) {
          console.log('计算活动状态失败:', e.message);
        }
      }
    }
    
    return {
      success: true,
      data: activities
    };
  } catch (err) {
    console.error('获取活动列表失败：', err);
    return {
      success: false,
      error: err.message || '获取活动列表失败'
    };
  }
};
