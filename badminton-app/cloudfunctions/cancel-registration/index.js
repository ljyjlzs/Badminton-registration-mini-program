/**
 * cancel-registration 云函数 - 用户申请取消报名
 *
 * 功能：
 * 1. 校验用户已报名、活动处于报名中状态
 * 2. 设置 cancel_status = 'pending'，等待组织者审批
 *
 * 入参：{ activityId, activityName }
 *   - activityId: 活动的 _id（优先使用）
 *   - activityName: 活动名称（当 activityId 为空时，按名称精确查找）
 * 出参：{ success, data: { cancel_status } }
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { activityId, activityName } = event;

  // 解析真实活动ID：优先用 activityId，否则按 activityName 查找
  let realActivityId = activityId;

  if (!realActivityId && activityName && activityName.trim()) {
    try {
      const nameResult = await db.collection('activities')
        .where({
          name: activityName.trim(),
          status: 'registering'
        })
        .limit(1)
        .get();

      if (nameResult.data && nameResult.data.length > 0) {
        realActivityId = nameResult.data[0]._id;
      } else {
        return { success: false, error: '未找到名为「' + activityName + '」的报名中活动' };
      }
    } catch (e) {
      return {
        success: false,
        error: '按活动名称查找失败：' + (e.message || '未知错误')
      };
    }
  }

  if (!realActivityId) {
    return { success: false, error: '缺少活动ID' };
  }

  try {
    // 1. 校验活动状态
    const activityResult = await db.collection('activities').doc(realActivityId).get();
    const activity = activityResult.data;

    if (!activity) {
      return { success: false, error: '活动不存在' };
    }

    if (activity.status !== 'registering') {
      return { success: false, error: '活动已不在报名阶段，无法取消' };
    }

    // 2. 校验用户已报名
    const regResult = await db.collection('registrations').where({
      activity_id: realActivityId,
      user_id: openid,
      cancel_status: db.command.in([null, 'rejected']) // 只能取消正常状态或被拒绝过的
    }).get();

    if (!regResult.data || regResult.data.length === 0) {
      return { success: false, error: '您未报名此活动' };
    }

    const registration = regResult.data[0];

    // 3. 检查是否已经有 pending 的取消申请
    if (registration.cancel_status === 'pending') {
      return { success: false, error: '您已提交过取消申请，请等待组织者确认' };
    }

    // 4. 设置 cancel_status = 'pending'
    await db.collection('registrations').doc(registration._id).update({
      data: {
        cancel_status: 'pending',
        cancel_requested_at: db.serverDate()
      }
    });

    return {
      success: true,
      data: {
        cancel_status: 'pending'
      },
      message: '已提交取消申请，等待组织者确认'
    };
  } catch (err) {
    console.error('取消报名失败：', err);
    return { success: false, error: err.message || '取消报名失败' };
  }
};
