/**
 * photo-ai-note 云函数 - AI 图片理解（06）
 * 动作：aiNote(单张) / batchAiNote(活动全部)
 * 依赖 AI_BASE_URL + AI_API_KEY（支持视觉的模型）；未配置则返回提示
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const { rateLimit } = require('./rateLimit.js');
const { callVision } = require('./ai.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

async function noteOne(photoId, prompt) {
  const photo = await db.collection('photos').doc(photoId).get();
  if (!photo.data) throw new Error('图片不存在');
  const dl = await cloud.downloadFile({ fileID: photo.data.fileID });
  // COST-03/06: jimp 降采样到长边 1024 再 base64，控制视觉 token；失败回退原图
  let base64 = '';
  try {
    const Jimp = require('jimp');
    const img = await Jimp.read(dl.fileContent);
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    const longEdge = Math.max(w, h);
    const MAX_EDGE = 1024;
    if (longEdge > MAX_EDGE) {
      const scale = MAX_EDGE / longEdge;
      img.resize(Math.round(w * scale), Math.round(h * scale));
    }
    const out = await img.getBufferAsync(Jimp.MIME_JPEG);
    base64 = out.toString('base64');
  } catch (e) {
    logger.error('photo-ai-note', (typeof action !== 'undefined' ? action : '-'), { err: e });
    // 降采样失败或 jimp 未安装时回退原图；若体积过大可在此跳过（fileContent.length > 500*1024）
    base64 = dl.fileContent.toString('base64');
  }
  if (!process.env.AI_VISION_MODEL) { throw new Error('AI_VISION_MODEL 未配置，视觉功能不可用'); }
  // AI-24: 失败写 __failed__ 标记，避免空 note 被反复捞出重试
  const note = await callVision(base64, prompt);
  await db.collection('photos').doc(photoId).update({ data: { aiNote: note, aiNotedAt: db.serverDate() } });
  return note;
}

exports.main = async (event) => {
  const { action = 'aiNote', payload = {} } = event;
  // AI-9: 身份校验 + 组织者校验
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: '未获取到用户身份，请重新进入小程序' };
  // COST-07: 限流 20 次/分钟（photo-ai-note 已有 openid）
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };

  async function assertOrganizer(activityId) {
    const act = await db.collection('activities').doc(activityId).get();
    if (!act.data) throw new Error('活动不存在');
    if (act.data.organizerId !== openid) throw new Error('仅组织者可生成 AI 小记');
  }

  try {
    const prompt = '请用一句话描述这张羽毛球活动照片（40字内，中文，不用 emoji），突出氛围或动作。';
    if (action === 'aiNote') {
      const { photoId } = payload;
      if (!photoId) return { success: false, message: 'photoId 不能为空' };
      try {
        const photo = await db.collection('photos').doc(photoId).get();
        if (!photo.data) return { success: false, message: '图片不存在' };
        if (!photo.data.activityId) return { success: false, message: '仅组织者可生成 AI 小记' };
        await assertOrganizer(photo.data.activityId);
        const note = await noteOne(photoId, prompt);
        return { success: true, data: { photoId, aiNote: note }, message: 'ok' };
      } catch (e) {
    logger.error('photo-ai-note', (typeof action !== 'undefined' ? action : '-'), { err: e });
        // AI-24: 按错误类型给出准确文案
        if (e.message === '仅组织者可生成 AI 小记' || e.message === '活动不存在') {
          return { success: false, message: e.message };
        }
        if (e.message === 'AI_EMPTY_VISION') {
          await db.collection('photos').doc(photoId).update({ data: { aiNote: '__failed__', aiNotedAt: db.serverDate() } }).catch(function() {});
          return { success: false, message: '图片理解失败，已跳过' };
        }
        return { success: false, message: e.message === 'AI_NOT_ENABLED' ? '图片理解未开启' : '图片理解失败，请稍后重试' };
      }
    }
    if (action === 'batchAiNote' || action === 'generate') {
      const { activityId } = payload;
      if (!activityId) return { success: false, message: 'activityId 不能为空' };
      try {
        await assertOrganizer(activityId);
      } catch (e) {
    logger.error('photo-ai-note', (typeof action !== 'undefined' ? action : '-'), { err: e });
        return { success: false, message: e.message || '仅组织者可生成 AI 小记' };
      }
      // AI-17: 返回活动全部照片（含已有 aiNote 的），避免重进页面时卡片消失；
      // 仅对未生成笔记的照片调用视觉模型，已有的原样返回；AI-24: __failed__ 不再重试
      const MAX_FETCH = 100;
      const MAX_NEW_PER_BATCH = 3;
      const list = await db.collection('photos').where({ activityId }).limit(MAX_FETCH).get();
      const results = [];
      // AI-25: 累计耗时熔断，防止批量处理拖垮云函数超时
      const batchStart = Date.now();
      let newCount = 0;
      for (const p of list.data || []) {
        const existing = typeof p.aiNote === 'string' ? p.aiNote : '';
        const isFailed = existing === '__failed__';
        const hasNote = !!existing && !isFailed;
        if (hasNote) {
          // 已有笔记原样返回（hasNote: true），不重复调用视觉模型
          results.push({ photoId: p._id, aiNote: existing, hasNote: true });
          continue;
        }
        if (isFailed) {
          // AI-24: 失败标记照片不重试，返回空笔记占位（hasNote: false）
          results.push({ photoId: p._id, aiNote: '', hasNote: false, error: 'skip' });
          continue;
        }
        if (newCount >= MAX_NEW_PER_BATCH || Date.now() - batchStart > 22000) {
          // 超出本批生成额度/熔断：仍返回占位（hasNote: false），下次再生成
          results.push({ photoId: p._id, aiNote: '', hasNote: false });
          continue;
        }
        newCount += 1;
        try {
          results.push({ photoId: p._id, aiNote: await noteOne(p._id, prompt), hasNote: true });
        } catch (e) {
    logger.error('photo-ai-note', (typeof action !== 'undefined' ? action : '-'), { err: e });
          // AI-24: 失败写标记，下次不再重试
          if (e.message === 'AI_EMPTY_VISION' || e.message === 'AI_TIMEOUT' || e.message === 'AI_JSON_PARSE') {
            await db.collection('photos').doc(p._id).update({ data: { aiNote: '__failed__', aiNotedAt: db.serverDate() } }).catch(function() {});
          }
          results.push({ photoId: p._id, aiNote: '', hasNote: false, error: 'skip' });
        }
      }
      return { success: true, data: { results }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('photo-ai-note', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || 'AI 理解失败' };
  }
};
