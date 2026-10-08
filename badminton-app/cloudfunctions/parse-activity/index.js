/**
 * parse-activity 云函数 - 聊天建活动草稿
 * 对齐 AiServiceImpl.parseActivity（05.3）：chatJson 逐字 prompt + normalizeDraft + fillMissingLocation
 * payload: { message }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
// ARCH-01: 共享 AI 模块（由 sync-shared.js 复制到本目录，必须本地 require）
const { callAIJson } = require('./ai.js');
const { rateLimit } = require('./rateLimit.js');
// ENG-11: 活动上限常量（由 sync-shared.js 复制）
const { ACTIVITY_LIMITS } = require('./constants.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const SYSTEM_PROMPT = `你是羽毛球活动助手。把用户一句话解析成活动草稿，只输出 JSON，不要输出任何其他文字。JSON 字段：name, time(格式 yyyy-MM-dd HH:mm:ss), location, province, city, district, type(singles/doubles/fixed-doubles), maxPlayers(整数), missing(数组)。规则：1. 相对时间按当前时间 {now} 计算，例如今天/明天/周X/下周五/晚上/HH:mm。2. 用户提到城市或区名时，必须补全省市区。例如"深圳宝安"-> province="广东省", city="深圳市", district="宝安区"；"广州天河"-> province="广东省", city="广州市", district="天河区"。3. 用户没给地点时 location 填空字符串，并在 missing 中加入 location；完全没提地区时 province/city/district 都填空，并在 missing 中加入对应字段。4. 用户提到的球馆名称直接作为 location，例如"超越羽毛球馆"-> location="超越羽毛球馆"。5. 不确定活动类型时用 doubles。6. 名称为空时生成"M月d日羽毛球局"。7. 提到"老地方"时 location 填空字符串（由后端回填）。8. 用户提到报名人数时 maxPlayers 填整数（如"8人双打"填 8），没提到填 null。`;

function normalizeDraft(d) {
  const draft = d || {};
  let type = draft.type;
  if (type !== 'singles' && type !== 'fixed-doubles') type = 'doubles';
  const minPlayers = type === 'singles' ? 3 : ACTIVITY_LIMITS.MIN_PLAYERS;
  let maxPlayers = draft.maxPlayers != null ? Number(draft.maxPlayers) : 8;
  if (isNaN(maxPlayers)) maxPlayers = 8;
  if (maxPlayers < minPlayers) maxPlayers = minPlayers;
  if (maxPlayers > ACTIVITY_LIMITS.MAX_PLAYERS) maxPlayers = ACTIVITY_LIMITS.MAX_PLAYERS;
  let name = draft.name || '';
  if (!name) {
    const now = new Date();
    name = (now.getMonth() + 1) + '月' + now.getDate() + '日羽毛球局';
  }
  if (name.length > 50) name = name.slice(0, 50);
  // time 校验（AI-39）：typeof 字符串守卫 + 格式正则 AND 日期真实可解析；空/非法一律置空并记入 missing
  const missing = Array.isArray(draft.missing) ? draft.missing.slice() : [];
  let time = typeof draft.time === 'string' ? draft.time : '';
  const timeText = time.trim();
  const timeOk = timeText !== ''
    && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(timeText)
    && !isNaN(new Date(timeText.replace(' ', 'T')).getTime());
  if (!timeOk) {
    time = '';
    if (missing.indexOf('time') === -1) missing.push('time');
  }
  return {
    name, time, location: draft.location || '',
    province: draft.province || '', city: draft.city || '', district: draft.district || '',
    type, minPlayers, maxPlayers, missing, source: 'ai'
  };
}

exports.main = async (event, context) => {
  const { action = 'parse', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  // COST-07: 限流 20 次/分钟
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };
  try {
    if (action !== 'parse') return { success: false, message: '未知 action: ' + action };
    // AI-13: 同时兼容 message 与 input 字段；i=170: 长度截断，防止超长输入
    const rawText = payload.message || payload.input;
    if (!rawText) return { success: false, message: 'message 不能为空' };
    const text = String(rawText).slice(0, 2000);

    const now = new Date();
    const nowStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const system = SYSTEM_PROMPT.replace('{now}', nowStr);

    let parsed;
    try {
      parsed = await callAIJson(system, text);
    } catch (e) {
    logger.error('parse-activity', (typeof action !== 'undefined' ? action : '-'), { err: e });
      if (!text || !/时间|地点|省|市|区/.test(text)) {
        return { success: false, message: 'AI 暂时无法识别，请手动填写' };
      }
      parsed = {};
    }

    let draft = normalizeDraft(parsed);

    // fillMissingLocation：空 location/region 用组织者上一场活动回填
    if (!draft.location && (!draft.province || !draft.city || !draft.district)) {
      const last = await db.collection('activities').where({ organizerId: openid }).orderBy('createdAt', 'desc').limit(1).get();
      if (last.data && last.data.length > 0) {
        const la = last.data[0];
        if (!draft.location && la.location) draft.location = la.location;
        if (!draft.province && la.province) draft.province = la.province;
        if (!draft.city && la.city) draft.city = la.city;
        if (!draft.district && la.district) draft.district = la.district;
      }
    }
    // AI-23: 回填后清理 missing 数组，地址已填上时前端不再提示「地点缺失」
    const filled = ['location', 'province', 'city', 'district'].filter(function(k) { return draft[k]; });
    draft.missing = (draft.missing || []).filter(function(k) { return filled.indexOf(k) < 0; });

    return { success: true, data: { draft }, message: 'ok' };
  } catch (err) {
    logger.error('parse-activity', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '解析失败' };
  }
};
