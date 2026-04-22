/**
 * setTeamName 云函数 - 设置队名
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { teamId, name, activityId } = event;
  
  if (!teamId || !name) {
    return {
      success: false,
      error: '参数不完整'
    };
  }
  
  if (name.length > 20) {
    return {
      success: false,
      error: '队名不能超过20个字符'
    };
  }
  
  try {
    // 获取队伍
    const teamResult = await db.collection('teams').doc(teamId).get();
    
    if (!teamResult.data) {
      return {
        success: false,
        error: '队伍不存在'
      };
    }
    
    const team = teamResult.data;
    
    // 检查是否为队长或组织者
    let isOrganizer = false;
    if (activityId) {
      const activityResult = await db.collection('activities').doc(activityId).get();
      if (activityResult.data && activityResult.data.organizer_id === openid) {
        isOrganizer = true;
      }
    }
    
    if (team.captain_id !== openid && !isOrganizer) {
      return {
        success: false,
        error: '只有队长或组织者才能设置队名'
      };
    }
    
    // 更新队名
    await db.collection('teams').doc(teamId).update({
      data: {
        name: name.trim()
      }
    });
    
    return {
      success: true
    };
  } catch (err) {
    console.error('设置队名失败：', err);
    return {
      success: false,
      error: err.message || '设置队名失败'
    };
  }
};
