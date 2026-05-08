/**
 * joinActivity 云函数 - 报名参加活动
 *
 * 功能：
 * 1. 验证活动状态（必须是 registering）
 * 2. 验证人数是否已满
 * 3. 验证是否已报名
 * 4. 创建报名记录
 *
 * 入参：{ activityId, level, nickname, avatar, partnerId, activityName }
 *   - activityId: 活动的 _id（优先使用）
 *   - activityName: 活动名称（当 activityId 为空时，按名称精确查找）
 * 出参：{ success, data: { registrationId } }
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { activityId, level, nickname, avatar, partnerId, activityName } = event;

  if (!avatar) {
    return {
      success: false,
      error: '请上传头像'
    };
  }

  if (!nickname || nickname.trim().length < 2) {
    return {
      success: false,
      error: '请输入有效的名字（至少2个字符）'
    };
  }

  if (!level || level < 1 || level > 10) {
    return {
      success: false,
      error: '等级必须在1-10之间'
    };
  }

  // 解析真实活动ID：优先用 activityId，否则按 activityName 查找
  let realActivityId = activityId;

  if (!realActivityId && activityName && activityName.trim()) {
    // AI 可能传了活动名称，按名称精确匹配 registering 状态的活动
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
        return {
          success: false,
          error: '未找到名为「' + activityName + '」的可报名活动'
        };
      }
    } catch (e) {
      return {
        success: false,
        error: '按活动名称查找失败：' + (e.message || '未知错误')
      };
    }
  }

  if (!realActivityId) {
    return {
      success: false,
      error: '活动ID不能为空'
    };
  }

  try {
    const activityResult = await db.collection('activities').doc(realActivityId).get();

    if (!activityResult.data) {
      return {
        success: false,
        error: '活动不存在'
      };
    }

    const activity = activityResult.data;

    if (activity.status !== 'registering') {
      return {
        success: false,
        error: '活动已开始或已结束，无法报名'
      };
    }

    if (activity.current_players >= activity.max_players) {
      return {
        success: false,
        error: '活动报名已满'
      };
    }

    // 查找该用户在此活动中的所有报名记录
    const allRegs = await db.collection('registrations').where({
      activity_id: realActivityId,
      user_id: openid
    }).get();

    // 已有未取消的活跃记录 → 拒绝
    const activeReg = (allRegs.data || []).find(r => r.cancel_status !== 'approved');
    if (activeReg) {
      return {
        success: false,
        error: '您已报名此活动'
      };
    }

    // 有已取消的记录 → 复用该条记录，通过 update 重新激活
    const cancelledReg = (allRegs.data || []).find(r => r.cancel_status === 'approved');

    // 固搭模式：如果当前用户已被别人选为搭档，需要检查
    if (activity.type === 'fixed-doubles') {
      const boundReg = await db.collection('registrations').where({
        activity_id: realActivityId,
        partner_id: openid,
        cancel_status: _.neq('approved')
      }).get();
      if (boundReg.data && boundReg.data.length > 0) {
        return { success: false, error: '您已被选为搭档，无需再报名' };
      }
    }

    // 固搭模式：验证搭档合法性
    if (activity.type === 'fixed-doubles' && partnerId) {
      const partnerReg = await db.collection('registrations').where({
        activity_id: realActivityId,
        user_id: partnerId,
        cancel_status: _.neq('approved')
      }).get();

      if (!partnerReg.data || partnerReg.data.length === 0) {
        return { success: false, error: '所选搭档尚未报名' };
      }

      if (partnerReg.data[0].partner_id) {
        return { success: false, error: '所选搭档已有搭档，请选择其他人' };
      }
    }

    let registrationId;

    if (cancelledReg) {
      // 复用已取消的记录：清除取消状态，更新最新信息
      await db.collection('registrations').doc(cancelledReg._id).update({
        data: {
          nickname: nickname.trim(),
          avatar: avatar,
          level: level,
          team_id: null,
          is_eliminated: false,
          partner_id: partnerId || null,
          cancel_status: _.remove(),
          cancel_reason: _.remove(),
          cancel_requested_at: _.remove(),
          cancel_processed_at: _.remove(),
          cancel_processed_by: _.remove(),
          created_at: db.serverDate()
        }
      });
      registrationId = cancelledReg._id;
    } else {
      // 全新报名
      const registrationData = {
        activity_id: realActivityId,
        user_id: openid,
        nickname: nickname.trim(),
        avatar: avatar,
        level: level,
        team_id: null,
        is_eliminated: false,
        partner_id: partnerId || null,
        created_at: db.serverDate()
      };

      const regResult = await db.collection('registrations').add({
        data: registrationData
      });
      registrationId = regResult._id;
    }

    await db.collection('activities').doc(realActivityId).update({
      data: {
        current_players: _.inc(1)
      }
    });

    // 固搭模式：互相绑定搭档关系
    if (partnerId) {
      await db.collection('registrations').where({
        activity_id: realActivityId,
        user_id: partnerId
      }).update({
        data: { partner_id: openid }
      });
    }

    return {
      success: true,
      data: {
        registrationId: registrationId
      }
    };
  } catch (err) {
    console.error('报名失败：', err);
    return {
      success: false,
      error: err.message || '报名失败'
    };
  }
};
