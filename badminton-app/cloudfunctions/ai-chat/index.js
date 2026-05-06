/**
 * ai-chat 云函数 - AI 聊天（带用户数据上下文）
 *
 * 调用小米 Mimo API（OpenAI 兼容格式）
 * 每次对话前自动查询用户相关数据作为上下文注入
 */

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 小米 Mimo API Key
const MIMO_API_KEY = 'tp-co74cqsnatfrgd035fkkvg1ghwe4an1mrtr81d529lq06v8j';

const db = cloud.database();
const _ = db.command;

// 状态中文映射
const statusMap = {
  'registering': '报名中',
  'grouping': '分组中',
  'playing': '进行中',
  'challenge': '挑战赛',
  'final': '决赛',
  'finished': '已结束'
};

// 类型中文映射
const typeMap = {
  'singles': '单打',
  'doubles': '双打轮换',
  'fixed-doubles': '双打固搭'
};

// 构建用户数据上下文
async function buildUserContext(openid) {
  const lines = [];
  lines.push('你是羽毛球活动管理小程序的AI助手。请根据以下用户数据回答问题、提供分析和建议。如果用户的问题与以下数据无关，正常回答即可。');
  lines.push('');

  // 1. 用户信息
  try {
    const userResult = await db.collection('users').where({ _openid: openid }).limit(1).get();
    const user = (userResult.data || [])[0];
    if (user) {
      lines.push('【用户信息】昵称：' + (user.nickname || '未知') + '，等级：' + (user.level || 5));
      lines.push('');
    }
  } catch (e) {
    console.log('查询用户信息失败:', e.message);
  }

  // 2. 我组织的活动
  try {
    const orgResult = await db.collection('activities')
      .where({ organizer_id: openid })
      .orderBy('created_at', 'desc')
      .limit(20)
      .get();

    const organized = orgResult.data || [];
    if (organized.length > 0) {
      lines.push('【我组织的活动】(' + organized.length + '个)');
      for (const act of organized) {
        // 获取报名人数
        let regCount = 0;
        let maxCount = act.max_players || '?';
        try {
          const regRes = await db.collection('registrations')
            .where({ activity_id: act._id, cancel_status: _.neq('approved') })
            .count();
          regCount = regRes.total || 0;
        } catch (e) { /* ignore */ }

        const typeCn = typeMap[act.type] || act.type || '未知';
        const statusCn = statusMap[act.status] || act.status;
        const timeStr = act.time ? act.time.replace('T', ' ').substring(0, 16) : '时间待定';
        lines.push((act.name || '未命名') + ' (' + typeCn + ', ' + timeStr + ', ' + statusCn + ', ' + regCount + '/' + maxCount + '人)');
      }
      lines.push('');
    }
  } catch (e) {
    console.log('查询组织活动失败:', e.message);
  }

  // 3. 我参加的活动（排除我组织的）
  try {
    const regResult = await db.collection('registrations')
      .where({ user_id: openid, cancel_status: _.neq('approved') })
      .limit(50)
      .get();

    const regs = regResult.data || [];
    const actIds = [...new Set(regs.map(r => r.activity_id))];

    if (actIds.length > 0) {
      const actResult = await db.collection('activities')
        .where({ _id: _.in(actIds) })
        .orderBy('created_at', 'desc')
        .limit(20)
        .get();

      const acts = (actResult.data || []).filter(a => a.organizer_id !== openid);
      if (acts.length > 0) {
        lines.push('【我参加的活动】(' + acts.length + '个)');
        for (const act of acts) {
          let regCount = 0;
          let maxCount = act.max_players || '?';
          try {
            const regRes = await db.collection('registrations')
              .where({ activity_id: act._id, cancel_status: _.neq('approved') })
              .count();
            regCount = regRes.total || 0;
          } catch (e) { /* ignore */ }

          const typeCn = typeMap[act.type] || act.type || '未知';
          const statusCn = statusMap[act.status] || act.status;
          const timeStr = act.time ? act.time.replace('T', ' ').substring(0, 16) : '时间待定';
          lines.push((act.name || '未命名') + ' (' + typeCn + ', ' + timeStr + ', ' + statusCn + ', ' + regCount + '/' + maxCount + '人)');
        }
        lines.push('');
      }
    }
  } catch (e) {
    console.log('查询参加活动失败:', e.message);
  }

  // 4. 有比赛的活动 - 获取排名数据
  try {
    // 获取我参加或组织的所有活动ID
    const orgResult2 = await db.collection('activities')
      .where({ organizer_id: openid })
      .field({ _id: true })
      .limit(20)
      .get();

    const regResult2 = await db.collection('registrations')
      .where({ user_id: openid, cancel_status: _.neq('approved') })
      .field({ activity_id: true })
      .limit(50)
      .get();

    const myActIds = [...new Set([
      ...(orgResult2.data || []).map(a => a._id),
      ...(regResult2.data || []).map(r => r.activity_id)
    ])];

    if (myActIds.length > 0) {
      // 查找有积分记录的活动
      const scoresResult = await db.collection('scores')
        .where({ activity_id: _.in(myActIds) })
        .limit(500)
        .get();

      const scores = scoresResult.data || [];

      if (scores.length > 0) {
        // 按活动分组计算排名
        const actScoreMap = {};
        scores.forEach(s => {
          if (!actScoreMap[s.activity_id]) actScoreMap[s.activity_id] = {};
          if (!actScoreMap[s.activity_id][s.user_id]) {
            actScoreMap[s.activity_id][s.user_id] = 0;
          }
          actScoreMap[s.activity_id][s.user_id] += s.score_change;
        });

        // 获取活动名称
        const actNameMap = {};
        const actDetailResult = await db.collection('activities')
          .where({ _id: _.in(Object.keys(actScoreMap)) })
          .field({ _id: true, name: true })
          .limit(20)
          .get();
        (actDetailResult.data || []).forEach(a => {
          actNameMap[a._id] = a.name || '未命名';
        });

        // 获取用户昵称
        const allUserIds = [...new Set(scores.map(s => s.user_id))];
        let nickMap = {};
        if (allUserIds.length > 0) {
          const regNickResult = await db.collection('registrations')
            .where({ activity_id: _.in(Object.keys(actScoreMap)) })
            .field({ user_id: true, nickname: true })
            .limit(200)
            .get();
          (regNickResult.data || []).forEach(r => {
            nickMap[r.user_id] = r.nickname || '';
          });
        }

        lines.push('【活动排名数据】');
        for (const actId of Object.keys(actScoreMap)) {
          const rankings = Object.entries(actScoreMap[actId])
            .map(([uid, score]) => ({ uid, score, name: nickMap[uid] || uid }))
            .sort((a, b) => b.score - a.score);

          lines.push('');
          lines.push(actNameMap[actId] + '：');
          rankings.forEach((r, i) => {
            const sign = r.score >= 0 ? '+' : '';
            lines.push((i + 1) + '. ' + r.name + ' ' + sign + r.score + '分');
          });
        }
        lines.push('');
      }
    }
  } catch (e) {
    console.log('查询排名数据失败:', e.message);
  }

  let context = lines.join('\n');

  // 控制长度不超过 2000 字
  if (context.length > 2000) {
    context = context.substring(0, 2000) + '\n...(数据过多，已截断)';
  }

  return context;
}

// 调用小米 Mimo API
function callMimoAPI(messages) {
  return new Promise((resolve, reject) => {
    if (!MIMO_API_KEY) {
      return reject(new Error('未配置 MIMO_API_KEY'));
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
        'Authorization': 'Bearer ' + MIMO_API_KEY,
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
    await db.collection('ai_messages').add({
      data: {
        user_id: openid,
        role: 'user',
        content: message,
        created_at: db.serverDate()
      }
    });

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

    // 3. 构建用户数据上下文并注入
    const userContext = await buildUserContext(openid);
    apiMessages.unshift({
      role: 'system',
      content: userContext
    });

    // 4. 调用 AI API
    const aiReply = await callMimoAPI(apiMessages);

    // 5. 保存 AI 回复
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
