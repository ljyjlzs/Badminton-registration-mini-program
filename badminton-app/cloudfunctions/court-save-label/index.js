/**
 * court-save-label 云函数 - 仅改场地标签（08.1 saveLayout）
 * payload: { activityId, labels: [{ courtNo, label }] }
 */
const cloud = require('wx-server-sdk');

const logger = require('./logger');
const { requireArr } = require('./validate.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  try {
    const { activityId, labels } = payload;
    if (!activityId || !Array.isArray(labels)) return { success: false, message: 'activityId/labels 必填' };
    // SEC-06: 数组入参长度校验
    const labelsCheck = requireArr(labels, 'labels');
    if (!labelsCheck.ok) return { success: false, message: labelsCheck.message };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data || act.data.organizerId !== openid) return { success: false, message: '仅组织者可编辑' };

    for (const it of labels) {
      const c = await db.collection('activity_courts').where({ activityId, courtNo: Number(it.courtNo) }).limit(1).get();
      if (c.data && c.data.length > 0) {
        await db.collection('activity_courts').doc(c.data[0]._id).update({ data: { label: it.label } });
      }
    }
    return { success: true, message: 'ok' };
  } catch (err) {
    logger.error('court-save-label', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '保存标签失败' };
  }
};
