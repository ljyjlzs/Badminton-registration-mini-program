/**
 * rules-qa 云函数 - 规则问答
 * 对齐 RulesQaServiceImpl（05.5）：chatJson 逐字 prompt + 校验 + fallback
 * payload: { question }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
// ARCH-01: 共享 AI 模块（由 sync-shared.js 复制到本目录，必须本地 require）
const { callAIJson } = require('./ai.js');
const { rateLimit } = require('./rateLimit.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const SYSTEM_PROMPT = `你是羽毛球小程序规则助手。根据给定规则原文回答问题，只输出 JSON。字段：answer(300字内), references=[{sectionId, quotes=[原文片段]}]。要求：1. 只能引用下方原文，逐字摘录，不能改写。2. 引用的 sectionId 必须真实存在。3. 原文没有的内容回答"规则原文未提及"，不得编造。4. 不用 emoji。不用 Markdown，用编号分点。`;

function strip(s) { return (s || '').replace(/\s+/g, ''); }

exports.main = async (event, context) => {
  const { action = 'ask', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  // COST-07: 限流 20 次/分钟
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };
  try {
    if (action !== 'ask') return { success: false, message: '未知 action: ' + action };
    const question = (payload.question || '').trim();
    if (!question) return { success: false, message: '问题不能为空' };
    if (question.length > 200) return { success: false, message: '问题最长200字' };

    const rulesRes = await db.collection('rules').where({ type: 'rules' }).limit(1).get();
    const sections = (rulesRes.data && rulesRes.data[0] && rulesRes.data[0].sections) || [];
    let ctxText = sections.map((s, i) => `sectionId=${i}\n${s.match_rules || ''}\n${s.scoring_rules || ''}\n${s.common_rules || ''}`).join('\n---\n');

    let result;
    try {
      result = await callAIJson(SYSTEM_PROMPT, '规则原文：\n' + ctxText + '\n\n问题：' + question);
    } catch (e) {
    logger.error('rules-qa', (typeof action !== 'undefined' ? action : '-'), { err: e });
      // AI-28: 区分错误类型，AI 未开启才报未开启，其余走 fallback
      console.error('rules-qa AI 调用失败:', e && e.message);
      if (e.message === 'AI_NOT_ENABLED') {
        return { success: false, message: 'AI 功能未开启' };
      }
      return fallback(sections, question);
    }

    if (!result.answer || result.answer.length > 300) return fallback(sections, question);
    // 校验 quotes 为规则子串且 sectionId 真实
    const refs = result.references || [];
    for (const r of refs) {
      const sec = sections[Number(r.sectionId)];
      if (!sec) return fallback(sections, question);
      const hay = strip((sec.match_rules || '') + (sec.scoring_rules || '') + (sec.common_rules || ''));
      for (const q of (r.quotes || [])) {
        if (!q || !hay.includes(strip(q))) return fallback(sections, question);
      }
    }
    return { success: true, data: { answer: result.answer, references: refs }, message: 'ok' };
  } catch (err) {
    logger.error('rules-qa', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '问答失败' };
  }
};

function fallback(sections, question) {
  // AI-41: 清洗问题后按 2-gram 滑动窗口打分
  const q = (question || '').replace(/[的了吗呢吧啊\s]/g, '');
  const grams = [];
  for (let i = 0; i < q.length - 1; i++) grams.push(q.slice(i, i + 2));
  if (q.length === 1) grams.push(q); // 极短问题退化为单字，避免无候选

  const scored = [];
  sections.forEach((s, i) => {
    // AI-41: 三字段换行拼接，避免字段边界粘连造成误命中
    const text = [s.match_rules || '', s.scoring_rules || '', s.common_rules || ''].join('\n');
    if (!grams.length || !text) return;
    let hit = 0;
    grams.forEach(g => { if (text.includes(g)) hit++; });
    const rate = hit / grams.length;
    // AI-41: 命中率 > 0.3 才入选
    if (rate > 0.3) scored.push({ sectionId: String(i), text: text, rate: rate });
  });
  scored.sort((a, b) => b.rate - a.rate);
  const top = scored.slice(0, 3);

  // AI-41: answer 附上第一条命中 section 的 quote 原文（首个非空字段），无 quote 才用纯文字
  let answer;
  if (top.length) {
    const quote = top[0].text.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
    answer = quote ? '根据规则原文，相关条款如下：\n' + quote : '根据规则原文，相关条款如下：';
  } else {
    answer = '规则原文未提及';
  }

  // 不伪造 quotes：只给出真实 sectionId，quotes 留空由前端展示原文入口
  const refs = top.map(r => ({ sectionId: r.sectionId, quotes: [] }));
  // AI-38: 兜底标记，前端据此显示兜底横幅
  return { success: true, data: { answer, references: refs, fallback: true, isFallback: true }, message: 'ok' };
}
