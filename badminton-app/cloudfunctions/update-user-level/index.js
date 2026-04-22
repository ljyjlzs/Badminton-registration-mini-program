/**
 * updateUserLevel 云函数 - 更新用户等级
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { activityId, level } = event;

  if (!level || level < 1 || level > 10) {
    return { success: false, error: '等级必须在1-10之间' };
  }

  try {
    // 检查活动状态，只有报名期间才能修改等级
    if (activityId) {
      const activityResult = await db.collection('activities').doc(activityId).get();
      const activity = activityResult.data;
      
      if (activity && activity.status !== 'registering') {
        return { success: false, error: '活动已开始，无法修改等级' };
      }
    }

    const userResult = await db.collection('users').where({
      _openid: openid
    }).get();

    if (userResult.data && userResult.data.length > 0) {
      await db.collection('users').doc(userResult.data[0]._id).update({
        data: { level: level, updated_at: db.serverDate() }
      });
    }

    if (activityId) {
      await db.collection('registrations').where({
        activity_id: activityId,
        user_id: openid
      }).update({
        data: { level: level, updated_at: db.serverDate() }
      });
    }

    return { success: true, data: { level: level } };
  } catch (err) {
    console.error('更新等级失败：', err);
    return { success: false, error: err.message || '更新等级失败' };
  }
};