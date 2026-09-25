/**
 * update-registration-level 云函数 - 更新报名等级
 * 支持 action: update
 * payload: { activityId, level, registrationId? }
 * 当传入 registrationId 时，验证当前用户是组织者，允许修改代报人等级
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action = 'update', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    if (action === 'update') return await updateLevel(payload, openid);
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('update-registration-level', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '更新失败' };
  }
};

async function updateLevel(payload, openid) {
  const { activityId, level, registrationId } = payload;

  if (!activityId) return { success: false, message: 'activityId 不能为空' };

  // 验证等级范围
  if (!level || level < 1 || level > 10) {
    return { success: false, message: '等级必须在1-10之间' };
  }

  let regRecord;

  if (registrationId) {
    // 组织者修改代报人等级：先验证活动归属，再按 registrationId 查询
    const activity = await db.collection('activities').doc(activityId).get();
    if (!activity.data || activity.data.organizerId !== openid) {
      return { success: false, message: '只有组织者才能修改代报人等级' };
    }
    const regRes = await db.collection('registrations').doc(registrationId).get();
    if (!regRes.data || regRes.data.activityId !== activityId) {
      return { success: false, message: '报名记录不存在' };
    }
    regRecord = regRes.data;
  } else {
    // 修改自己的报名等级
    const reg = await db.collection('registrations')
      .where({
        activityId,
        userId: openid,
        cancelStatus: _.neq('approved')
      })
      .get();

    if (!reg.data || reg.data.length === 0) {
      return { success: false, message: '您尚未报名此活动' };
    }
    regRecord = reg.data[0];
  }

  // 更新等级
  await db.collection('registrations').doc(regRecord._id).update({
    data: {
      level: Number(level),
      updatedAt: db.serverDate()
    }
  });

  return {
    success: true,
    data: { level: Number(level) },
    message: '等级更新成功'
  };
}
