/**
 * startMatch 云函数 - 开始比赛
 * 将比赛状态从 pending 改为 playing
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { activityId, matchId } = event;
  
  console.log('start-match called:', { activityId, matchId, openid });
  
  if (!activityId || !matchId) {
    return { success: false, error: '参数不完整' };
  }
  
  try {
    const activityResult = await db.collection('activities').doc(activityId).get();
    if (!activityResult.data) {
      console.log('活动不存在');
      return { success: false, error: '活动不存在' };
    }
    
    console.log('活动组织者:', activityResult.data.organizer_id);
    console.log('当前用户:', openid);
    
    if (activityResult.data.organizer_id !== openid) {
      console.log('权限校验失败');
      return { success: false, error: '只有组织者可以开始比赛' };
    }
    
    const matchResult = await db.collection('matches').doc(matchId).get();
    if (!matchResult.data) {
      console.log('比赛不存在');
      return { success: false, error: '比赛不存在' };
    }
    
    const match = matchResult.data;
    console.log('比赛当前状态:', match.status);
    
    if (match.status !== 'pending') {
      console.log('比赛状态不是pending，当前状态:', match.status);
      return { success: false, error: '比赛状态不是待开始，当前状态: ' + match.status };
    }
    
    const updateResult = await db.collection('matches').doc(matchId).update({
      data: {
        status: 'playing',
        started_at: db.serverDate()
      }
    });
    
    console.log('更新结果:', updateResult);
    
    return {
      success: true,
      data: { message: '比赛已开始', status: 'playing' }
    };
  } catch (err) {
    console.error('开始比赛失败：', err);
    return { success: false, error: err.message || '开始比赛失败' };
  }
};