/**
 * ai-chat 云函数 - 小羽对话助手
 * 对齐 AiServiceImpl.buildUserContext / sanitizeChatReply
 * payload: { action: 'chat', message?, history? }
 * 历史读写由 ai-history 云函数负责，本函数不再提供 action:'history'
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
// ARCH-01: 共享 AI 模块（由 sync-shared.js 复制到本目录，必须本地 require）
const { callAI } = require('./ai.js');
const { rateLimit } = require('./rateLimit.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const SYSTEM_PROMPT = `你是小羽，一个羽毛球活动助手。你既可以回答各种日常问题，也可以协助用户管理羽毛球活动。

你的能力：
1. 回答各种问题：知识问答、聊天、写作、翻译、计算等
2. 协助羽毛球活动：查看可报名的活动、生成报名确认、生成取消报名确认等

重要规则：你只能建议和确认，不能替用户执行任何操作。用户确认前，绝不能声称"已报名""报名成功""已成功报名"等。只有收到"[系统通知] 操作执行结果："之后，你才可以确认该操作已完成。

请用友好、简洁的语气回答。如果是羽毛球相关问题，可以主动提供活动信息。不要使用 Markdown 标记符号（如 **加粗**、##标题、- 列表、引号代码、> 引用），用纯文本和简单换行排版。

【用户信息】昵称：{nickname}，等级：{level}

【可报名的活动】(N个)
- 活动ID: ...
  名称: ...，类型: ...，时间: ...，地点: ...

当用户要求报名时：
1. 如果用户明确指定了上面某个活动，先输出一句简短说明，然后必须紧跟以下操作卡片（不要用代码块）：
__ACTION__{"action":"join_activity","confirm_text":"确认报名参加活动","params":{"activityId":"<活动ID>","activityName":"<活动名称>"}}__END__
2. 如果用户没有指定活动，或描述模糊匹配到多个活动，请输出：
__SELECT__[{"id":"<ID>","name":"<名称>","time":"<时间>","location":"<地点>"}]__END__
并请用户选择要报名的活动。
3. 禁止在输出 __ACTION__ 之前说"已报名"或"报名成功"；报名是否成功以系统通知为准。
4. 如果用户要求取消报名，输出：
__ACTION__{"action":"cancel_registration","confirm_text":"确认申请取消报名","params":{"activityId":"<活动ID>","activityName":"<活动名称>"}}__END__
5. 用户只问问题或查看信息时，正常聊天回答，不要输出任何操作卡片标记。`;

// 清洗拼接进 SYSTEM_PROMPT 的可控字段，防止组织者用活动名/地点等内容注入提示词
function sanitizeText(s, maxLen) {
  if (s == null) return '';
  let t = String(s)
    .replace(/[\\'"`\r\n\t]/g, ' ')
    .replace(/[<>{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen > 0 && t.length > maxLen) t = t.slice(0, maxLen);
  return t;
}

// COST-08: 活动列表缓存 TTL（30 秒），云函数实例复用期间避免每次全量查 50 场活动
const ACT_CACHE_TTL_MS = 30 * 1000;

async function getActivitiesList(openid) {
  // COST-08: 命中缓存（距上次查询不到 30 秒）直接复用
  const now = Date.now();
  if (global.__actCache && global.__actCache.data && now - global.__actCache.ts < ACT_CACHE_TTL_MS) {
    return global.__actCache.data;
  }
  // COST-08: 白名单投影，不拉 openid 进 prompt；organizerId 仅用于反查昵称后丢弃
  const res = await db.collection('activities').where({ status: 'registering' })
    .orderBy('time', 'asc').limit(50)
    .field({ name: 1, type: 1, time: 1, location: 1, status: 1, maxPlayers: 1, currentPlayers: 1, organizerId: 1 })
    .get();
  const list = res.data || [];
  // AI-5: 批量反查组织者昵称，替换裸 organizerId
  const orgIds = [...new Set(list.map(a => a.organizerId).filter(Boolean))];
  let nameMap = {};
  if (orgIds.length > 0) {
    const usersRes = await db.collection('users').where({ openid: _.in(orgIds) }).field({ openid: 1, nickname: 1 }).get();
    (usersRes.data || []).forEach(u => { nameMap[u.openid] = u.nickname || ''; });
  }
  const data = list.map(a => ({
    id: a._id, name: a.name, type: a.type, time: a.time, location: a.location,
    status: a.status, maxPlayers: a.maxPlayers, currentPlayers: a.currentPlayers,
    organizer: nameMap[a.organizerId] || ''
  }));
  // COST-08: 写入全局缓存 { data, ts }
  global.__actCache = { data: data, ts: Date.now() };
  return data;
}

exports.main = async (event, context) => {
  const { action = 'chat', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { success: false, message: '未获取到用户身份，请重新进入小程序' };
  // COST-07: 限流 20 次/分钟
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };
  try {
    // i=134：删除未被调用的 action:'history' 分支，历史统一由 ai-history 提供
    if (action !== 'chat') return { success: false, message: '未知 action: ' + action };

    // i=170：message 长度截断，避免超长输入拖垮 AI 调用
    const rawMessage = payload.message;
    if (!rawMessage) return { success: false, message: '消息不能为空' };
    const message = String(rawMessage).slice(0, 2000);

    const userRes = await db.collection('users').where({ openid }).limit(1).get();
    const u = (userRes.data && userRes.data[0]) || { nickname: '球友', level: 5 };
    const acts = await getActivitiesList(openid);
    // AI-5: 对拼接进 SYSTEM_PROMPT 的活动名/地点/类型/昵称做清洗（不含 organizerId/openid）
    const actLines = acts.map(a => `- 活动ID: ${sanitizeText(a.id, 40)}\n  名称: ${sanitizeText(a.name, 50)}，类型: ${sanitizeText(a.type, 20)}，时间: ${sanitizeText(a.time, 30)}，地点: ${sanitizeText(a.location, 50)}，组织者: ${sanitizeText(a.organizer, 20)}`).join('\n');
    // i=107：用精确占位块替换，避免贪婪匹配吞掉后面的报名/取消报名操作指令
    const ACT_LIST_PLACEHOLDER = '【可报名的活动】(N个)\n- 活动ID: ...\n  名称: ...，类型: ...，时间: ...，地点: ...，组织者: ...';
    const system = SYSTEM_PROMPT
      .replace('{nickname}', sanitizeText(u.nickname || '球友', 20))
      .replace('{level}', sanitizeText(String(u.level != null ? u.level : 5), 8))
      .replace(ACT_LIST_PLACEHOLDER, '【可报名的活动】(' + acts.length + '个)\n' + (actLines || '（暂无）'));

    // i=112：取最近对话历史，随本轮消息一起传给 AI
    const rawHistory = (payload.history && payload.history.length)
      ? payload.history
      : (await db.collection('ai_messages').where(_.or([{ userId: openid }, { user_id: openid }])).limit(50).get()).data || [];
    const history = rawHistory
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      .slice(-12);

    let reply;
    try {
      reply = await callAI(system, message, { temperature: 0.7, history });
    } catch (e) {
    logger.error('ai-chat', (typeof action !== 'undefined' ? action : '-'), { err: e });
      reply = '抱歉，小羽服务异常，请稍后重试。';
    }

    // sanitizeChatReply：声称报名/取消报名成功但无操作卡片 → 改写（i=123 扩展取消报名，i=154 扩展正则 + 空列表保护）
    const joinSuccessRe = /报名成功|已成功报名|报名已成功|报名完成|已为你报名|报名已提交|已经报名|帮你报了|已替你报名|报名好了|参加成功|已成功参加|已为你参加/;
    const joinIntentRe = /帮我报名|我想报名|我要报名|报名参加|帮我参加|帮我报|想报名|要报名|报名|参加活动/;
    const cancelSuccessRe = /取消成功|已取消报名|已为你取消|取消完成|已成功取消|取消已提交|已提交取消|已经取消|帮你取消|取消好了|退出成功|已退出/;
    const cancelIntentRe = /帮我取消|我想取消|我要取消|取消报名|退出活动|取消参加|想取消|要取消|取消/;
    const selectCards = acts.map(a => `{"id":"${sanitizeText(a.id, 40)}","name":"${sanitizeText(a.name, 50)}","time":"${sanitizeText(a.time, 30)}","location":"${sanitizeText(a.location, 50)}","organizer":"${sanitizeText(a.organizer, 20)}"}`).join(',');
    if (!/__ACTION__/.test(reply) && !/__SELECT__/.test(reply)) {
      if (joinSuccessRe.test(reply) && joinIntentRe.test(message)) {
        if (acts.length === 0) {
          reply = '我还没有替你提交报名。当前暂无可报名的活动。';
        } else {
          reply = '我还没有替你提交报名，请先选择要报名的活动：\n__SELECT__[' + selectCards + ']__END__';
        }
      } else if (cancelSuccessRe.test(reply) && cancelIntentRe.test(message)) {
        reply = '我还没有替你提交取消报名申请。请确认要取消的活动后，我再生成取消报名确认卡片。';
      }
    }

    // AI-35: [系统通知] 协议文本用 assistant role 持久化，不再冒充用户消息
    const isSys = /^\[系统通知\]/.test(message);
    // AI-20: 消息写入时带上 activityId，供 delete-activity 级联清理
    const activityId = String(payload.activityId || '').slice(0, 64);

    // AI-10: 操作卡片消息落库时记录 actionStatus/actionResultText，便于重载时恢复
    const hasActionCard = /__ACTION__\{[\s\S]*?\}__END__/.test(reply);
    const actionStatus = hasActionCard ? 'pending' : '';

    await db.collection('ai_messages').add({
      data: { userId: openid, role: isSys ? '__system_feedback' : 'user', content: message, activityId, createdAt: db.serverDate() }
    });
    const assistantAdd = await db.collection('ai_messages').add({
      data: { userId: openid, role: 'assistant', content: reply, actionStatus, actionResultText: '', activityId, createdAt: db.serverDate() }
    });
    const assistantMessageId = (assistantAdd && (assistantAdd.id || assistantAdd._id)) || '';

    // AI-6/PERF-22: 最小读放大清理旧消息——count 超限时只读最老的 excess 条并删除
    const MAX_AI_MESSAGES = 50;
    const userWhere = _.or([{ userId: openid }, { user_id: openid }]);
    const countRes = await db.collection('ai_messages').where(userWhere).count();
    if (countRes && countRes.total > MAX_AI_MESSAGES) {
      const excess = countRes.total - MAX_AI_MESSAGES;
      const oldest = await db.collection('ai_messages')
        .where(userWhere)
        .orderBy('createdAt', 'asc')
        .limit(excess)
        .get();
      for (const m of (oldest.data || [])) {
        await db.collection('ai_messages').doc(m._id).remove();
      }
    }

    return { success: true, data: { reply: reply, content: reply, actionStatus: actionStatus, assistantMessageId: assistantMessageId }, message: 'ok' };
  } catch (err) {
    logger.error('ai-chat', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '对话失败' };
  }
};
