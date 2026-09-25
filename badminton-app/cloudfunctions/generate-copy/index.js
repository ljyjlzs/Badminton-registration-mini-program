/**
 * generate-copy 云函数 - 活动文案（announcement/share/invite 三字段，无降级）
 * 对齐 AiServiceImpl.generateCopy（05.4）
 * payload: { activityId, regenerate? }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
// ARCH-01: 共享 AI 模块（由 sync-shared.js 复制到本目录，必须本地 require）
const { callAIJson } = require('./ai.js');
const { rateLimit } = require('./rateLimit.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const SYSTEM_PROMPT = `你是羽毛球活动文案助手。根据活动信息生成三种中文文案，只输出 JSON，不要输出任何其他文字。JSON 字段：announcement(群公告), share(分享语), invite(邀请语)。要求：中文、不用 emoji；群公告80字以内；分享语40字以内；邀请语40字以内且包含被邀请人昵称占位，格式如{昵称}。`;

exports.main = async (event, context) => {
  const { action = 'generate', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  // COST-07: 限流 20 次/分钟
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };
  try {
    if (action !== 'generate') return { success: false, message: '未知 action: ' + action };
    const { activityId, regenerate } = payload;
    if (!activityId) return { success: false, message: 'activityId 不能为空' };
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) return { success: false, message: '活动不存在' };
    if (act.data.organizerId !== openid) return { success: false, message: '仅组织者可生成文案' };

    if (!regenerate) {
      const cached = await db.collection('activity_copy').where({ activityId }).limit(1).get();
      if (cached.data && cached.data.length > 0 &&
          cached.data[0].announcement && cached.data[0].share && cached.data[0].invite) {
        return { success: true, data: { copy: cached.data[0] }, message: 'ok' };
      }
    }

    const typeLabel = { singles: '单打', doubles: '双打轮换', 'fixed-doubles': '双打固搭', 'court-doubles': '按场地双打' }[act.data.type] || '双打';
    const user = `活动名：${act.data.name}\n时间：${act.data.time}\n地点：${act.data.location}\n类型：${typeLabel}\n当前人数：${act.data.currentPlayers}\n上限：${act.data.maxPlayers}\n组织者：${act.data.organizerId}`;

    let result;
    try {
      result = await callAIJson(SYSTEM_PROMPT, user);
    } catch (e) {
    logger.error('generate-copy', (typeof action !== 'undefined' ? action : '-'), { err: e });
      return { success: false, message: 'AI 文案生成失败，请稍后重试' };
    }
    // AI-21: 类型 + 长度 + {昵称} 占位符校验，防止 TypeError 与超长/缺占位文案落库
    const s = function(v) { return (typeof v === 'string' ? v.trim() : ''); };
    const announcement = s(result.announcement);
    const share = s(result.share);
    const invite = s(result.invite);
    if (!announcement || !share || !invite) {
      console.error('generate-copy AI 结果不合规:', JSON.stringify(result));
      return { success: false, message: 'AI 文案生成失败，请稍后重试' };
    }
    if (announcement.length > 120 || share.length > 60 || invite.length > 60) {
      console.error('generate-copy AI 结果超长:', JSON.stringify(result));
      return { success: false, message: 'AI 文案生成失败，请稍后重试' };
    }
    if (invite.indexOf('{昵称}') < 0) {
      console.error('generate-copy AI 缺少{昵称}占位符:', JSON.stringify(result));
      return { success: false, message: 'AI 文案生成失败，请稍后重试' };
    }

    const doc = {
      activityId, scene: 'announcement/share/invite',
      announcement: announcement, share: share, invite: invite,
      createdAt: db.serverDate(), updatedAt: db.serverDate()
    };
    const existing = await db.collection('activity_copy').where({ activityId }).limit(1).get();
    if (existing.data && existing.data.length > 0) {
      await db.collection('activity_copy').doc(existing.data[0]._id).update({ data: doc });
    } else {
      await db.collection('activity_copy').add({ data: doc });
    }
    return { success: true, data: { copy: doc }, message: 'ok' };
  } catch (err) {
    logger.error('generate-copy', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '生成失败' };
  }
};
