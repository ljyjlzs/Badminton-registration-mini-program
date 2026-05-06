/**
 * ai-chat 云函数 - AI 聊天
 * 
 * 调用小米 Mimo API（OpenAI 兼容格式）
 * API Key 通过环境变量 MIMO_API_KEY 配置
 */

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 调用小米 Mimo API
function callMimoAPI(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.MIMO_API_KEY;
    if (!apiKey) {
      return reject(new Error('未配置 MIMO_API_KEY 环境变量'));
    }
    
    const payload = JSON.stringify({
      model: 'mimo-v2.5-pro',
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000
    });
    
    const options = {
      hostname: 'token-plan-cn.xiaomimimo.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };
    
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.choices && result.choices[0]) {
            resolve(result.choices[0].message.content);
          } else {
            reject(new Error('API 返回格式异常: ' + data.substring(0, 200)));
          }
        } catch (e) {
          reject(new Error('解析 API 响应失败: ' + data.substring(0, 200)));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('API 请求超时'));
    });
    req.write(payload);
    req.end();
  });
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { message } = event;
  
  if (!message || !message.trim()) {
    return { success: false, error: '消息内容不能为空' };
  }
  
  try {
    // 1. 保存用户消息
    const userMsg = {
      user_id: openid,
      role: 'user',
      content: message,
      created_at: db.serverDate()
    };
    await db.collection('ai_messages').add({ data: userMsg });
    
    // 2. 获取历史消息（最近10条）
    const historyResult = await db.collection('ai_messages')
      .where({ user_id: openid })
      .orderBy('created_at', 'desc')
      .limit(10)
      .get();
    
    const history = (historyResult.data || []).reverse();
    const apiMessages = history.map(m => ({
      role: m.role,
      content: m.content
    }));
    
    // 3. 调用 AI API
    const aiReply = await callMimoAPI(apiMessages);
    
    // 4. 保存 AI 回复
    await db.collection('ai_messages').add({
      data: {
        user_id: openid,
        role: 'assistant',
        content: aiReply,
        created_at: db.serverDate()
      }
    });
    
    return {
      success: true,
      data: {
        content: aiReply
      }
    };
  } catch (err) {
    console.error('AI 聊天失败:', err);
    return {
      success: false,
      error: err.message || 'AI 服务异常，请稍后重试'
    };
  }
};
