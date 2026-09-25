/**
 * 共享 AI 调用模块（ARCH-01）
 * 部署方式：由 sync-shared.js 复制到各云函数目录，云函数内 require('./ai.js')
 * ⚠️ 云函数打包不能跨目录 require('../_shared/ai.js')，必须复制后本地引用
 */
const https = require('https');

/**
 * 调用 AI 返回纯文本
 * opts.temperature 覆盖默认温度（对话默认 0.7，JSON 任务默认 0.2）
 * opts.json      true 时强制 response_format=json_object 并返回已解析对象
 */
function callAI(system, user, opts = {}) {
  return new Promise((resolve, reject) => {
    const base = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
    if (!base || !process.env.AI_API_KEY) {
      return reject(new Error('AI_NOT_ENABLED'));
    }
    const path = process.env.AI_API_PATH || '/v1/chat/completions';
    // 兼容 base 已含 /chat/completions 的旧配置
    const url = /\/chat\/completions$/.test(base) ? base : (base + path);
    // 支持跨轮上下文：opts.history 拼进 messages
    const messages = [{ role: 'system', content: system }];
    const history = Array.isArray(opts.history) ? opts.history : [];
    for (const h of history) {
      if (!h || (h.role !== 'user' && h.role !== 'assistant')) continue;
      const c = h.content == null ? '' : String(h.content);
      if (!c) continue;
      messages.push({ role: h.role, content: c.slice(0, 2000) });
    }
    messages.push({ role: 'user', content: user });
    const body = JSON.stringify({
      model: process.env.AI_MODEL || 'mimo-v2.6-pro',
      messages,
      temperature: opts.temperature != null ? opts.temperature : 0.7,
      max_tokens: opts.maxTokens || 3000,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {})
    });
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      // AI-18/AI-25: 统一 25s 超时，防止挂起拖垮云函数
      timeout: 25000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.AI_API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        // AI-19: 先检查 HTTP 状态码，4xx/5xx 不再被静默吞成空回复
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const snippet = data.slice(0, 300);
          return reject(new Error('AI_HTTP_' + res.statusCode + ':' + snippet));
        }
        try {
          const json = JSON.parse(data);
          // COST-13: 只打 usage 字段，便于成本监控
          console.log('[ai-usage]', JSON.stringify(json.usage || {}));
          if (json.error) {
            return reject(new Error('AI_ERROR:' + (json.error.message || JSON.stringify(json.error).slice(0, 200))));
          }
          // AI-19: choices 缺失时拒绝而非静默返回空串
          if (!json.choices || !json.choices[0] || !json.choices[0].message) {
            return reject(new Error('AI_BAD_RESPONSE'));
          }
          const content = json.choices[0].message.content || '';
          if (opts.json) {
            let cleaned = content
              .replace(/^```json/, '')
              .replace(/^```/, '')
              .replace(/```$/, '')
              .trim();
            try { resolve(JSON.parse(cleaned)); }
            catch (e) { reject(new Error('AI_JSON_PARSE')); }
          } else {
            resolve(content);
          }
        } catch (e) { reject(new Error('AI_BAD_RESPONSE')); }
      });
    });
    req.on('error', e => reject(e));
    // AI-18/AI-25: 超时主动销毁请求
    req.on('timeout', () => { req.destroy(); reject(new Error('AI_TIMEOUT')); });
    req.write(body);
    req.end();
  });
}

/**
 * 调用 AI 并解析 JSON（temperature 默认 0.2，适合结构化输出）
 */
function callAIJson(system, user, opts = {}) {
  return callAI(system, user, Object.assign({}, opts, { json: true, temperature: opts.temperature != null ? opts.temperature : 0.2 }));
}

/**
 * 视觉理解：传入 base64 图片 + 提示词，返回文本描述（ARCH-01/ENG-14）
 */
function callVision(base64, prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const base = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
    if (!base || !process.env.AI_API_KEY) return reject(new Error('AI_NOT_ENABLED'));
    const path = process.env.AI_API_PATH || '/v1/chat/completions';
    const url = /\/chat\/completions$/.test(base) ? base : (base + path);
    const body = JSON.stringify({
      model: process.env.AI_VISION_MODEL || process.env.AI_MODEL || 'mimo-v2.6-pro',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64 } }
        ]
      }],
      max_tokens: opts.maxTokens || 300
    });
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      timeout: 25000,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.AI_API_KEY, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('AI_HTTP_' + res.statusCode));
        }
        try {
          const json = JSON.parse(data);
          console.log('[ai-usage]', JSON.stringify(json.usage || {}));
          const content = json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : '';
          const note = (content || '').trim();
          if (!note) return reject(new Error('AI_EMPTY_VISION'));
          resolve(note);
        } catch (e) { reject(new Error('AI_JSON_PARSE')); }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('AI_TIMEOUT')); });
    req.write(body); req.end();
  });
}

module.exports = { callAI, callAIJson, callVision };
