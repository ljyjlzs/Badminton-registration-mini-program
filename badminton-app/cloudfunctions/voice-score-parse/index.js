/**
 * voice-score-parse 云函数 - 语音/文字比分识别（07.1）
 * 动作：parse(文字→比分) / asr(语音文件→文字，需腾讯 ASR)
 * payload: { action, text?, fileID?, activityId? }
 */
const cloud = require('wx-server-sdk');
const logger = require('./logger');
const https = require('https');
const crypto = require('crypto');
const { rateLimit } = require('./rateLimit.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function clean(s) { return (s || '').replace(/\s+/g, '').replace(/[,，。.]/g, ''); }

function parseScoreText(text) {
  const t = clean(text);
  const result = [];
  // AI-43: 分隔符必须显式存在、队名两侧可选，支持一串多局比分（已删除 re2 fallback）
  const re = /([^\d:：比]+)?(\d{1,2})[:：比](\d{1,2})([^\d:：比]+)?/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const scoreA = Number(m[2]); const scoreB = Number(m[3]);
    if (scoreA < 0 || scoreA > 30 || scoreB < 0 || scoreB > 30) continue;
    result.push({ teamA: m[1] || '', scoreA, scoreB, teamB: m[4] || '' });
  }
  return result;
}

// AI-31: 按 activityId 匹配真实场次，取回 matchId/matchOrder
// 定位顺序：文本「第N场」→ 文本队名 → playing → 未结束 → 第一场
async function resolveMatch(activityId, text, parsed) {
  const orderM = /第(\d+)场/.exec(text || '');
  const orderHint = orderM ? Number(orderM[1]) : null;
  const fallback = { matchId: '', matchOrder: orderHint || 1, swapScores: false };
  if (!activityId) return fallback;
  let matches = [];
  try {
    const res = await db.collection('matches').where({ activityId }).get();
    matches = (res && res.data) || [];
  } catch (e) {
    logger.error('voice-score-parse', 'resolveMatch', { err: e });
    return fallback;
  }
  if (matches.length === 0) return fallback;

  const norm = function(s) { return (s || '').replace(/[\s/／、,，]/g, ''); };
  const first = parsed[0] || {};

  let picked = null;
  let swapScores = false;

  if (orderHint != null) {
    picked = matches.find(function(m) { return m.roundOrder === orderHint; }) || null;
  }
  if (!picked && (first.teamA || first.teamB)) {
    let teamsById = {};
    try {
      const tr = await db.collection('teams').where({ activityId }).get();
      (tr.data || []).forEach(function(t) { teamsById[t._id] = t; });
    } catch (e) { teamsById = {}; }
    const a = norm(first.teamA); const b = norm(first.teamB);
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const n1 = norm((teamsById[m.team1Id] || {}).name);
      const n2 = norm((teamsById[m.team2Id] || {}).name);
      const hitA = !!a && (n1 === a || n2 === a);
      const hitB = !!b && (n1 === b || n2 === b);
      if (hitA || hitB) {
        picked = m;
        // 文本第一队实际是 team2 时，比分顺序对调
        swapScores = hitA && n2 === a && n1 !== a;
        break;
      }
    }
  }
  if (!picked) {
    picked = matches.find(function(m) { return m.status === 'playing'; })
      || matches.find(function(m) { return m.status !== 'finished'; })
      || matches[0];
  }
  return {
    matchId: picked._id || '',
    matchOrder: picked.roundOrder != null ? picked.roundOrder : (orderHint || 1),
    swapScores: swapScores
  };
}

// AI-31: 结构化返回 { matchId, matchOrder, team1Score, team2Score }（取第一局比分）
async function buildResult(activityId, text, parsed) {
  const first = parsed[0] || { scoreA: 0, scoreB: 0 };
  const match = await resolveMatch(activityId, text, parsed);
  return {
    matchId: match.matchId,
    matchOrder: match.matchOrder,
    team1Score: match.swapScores ? first.scoreB : first.scoreA,
    team2Score: match.swapScores ? first.scoreA : first.scoreB
  };
}

function tencentAsr(fileID) {
  return new Promise(async (resolve, reject) => {
    const sid = process.env.TENCENT_ASR_SECRET_ID, skey = process.env.TENCENT_ASR_SECRET_KEY;
    if (!sid || !skey) return reject(new Error('ASR_NOT_CONFIGURED'));

    try {
      // 下载音频文件
      const dl = await cloud.downloadFile({ fileID: fileID });
      const audioBuffer = dl.fileContent;

      // 调用腾讯云 ASR
      const https = require('https');
      const crypto = require('crypto');

      // 生成签名
      const service = 'asr';
      const host = 'asr.tencentcloudapi.com';
      const action = 'SentenceRecognition';
      const version = '2019-06-14';
      const region = 'ap-guangzhou';
      const timestamp = Math.floor(Date.now() / 1000);
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

      const payload = {
        ProjectId: 0,
        SubServiceType: 2,
        EngSerViceType: '16k_zh',
        SourceType: 1,
        VoiceFormat: 'mp3',
        Data: audioBuffer.toString('base64'),
        DataLen: audioBuffer.length
      };

      const payloadStr = JSON.stringify(payload);

      // 计算签名
      const httpRequestMethod = 'POST';
      const canonicalUri = '/';
      const canonicalQueryString = '';
      const canonicalHeaders = 'content-type:application/json\n' + 'host:' + host + '\n';
      const signedHeaders = 'content-type;host';
      const hashedRequestPayload = crypto.createHash('sha256').update(payloadStr).digest('hex');
      const canonicalRequest = httpRequestMethod + '\n' + canonicalUri + '\n' + canonicalQueryString + '\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedRequestPayload;

      const algorithm = 'TC3-HMAC-SHA256';
      const credentialScope = date + '/' + service + '/' + 'tc3_request';
      const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
      const stringToSign = algorithm + '\n' + timestamp + '\n' + credentialScope + '\n' + hashedCanonicalRequest;

      const secretDate = crypto.createHmac('sha256', 'TC3' + skey).update(date).digest();
      const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
      const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
      const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

      const authorization = algorithm + ' Credential=' + sid + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

      const options = {
        hostname: host,
        method: 'POST',
        path: '/',
        // AI-25: ASR 调用同样加 25s 超时
        timeout: 25000,
        headers: {
          'Content-Type': 'application/json',
          'Host': host,
          'Authorization': authorization,
          'X-TC-Action': action,
          'X-TC-Version': version,
          'X-TC-Timestamp': timestamp.toString(),
          'X-TC-Region': region
        }
      };

      const req = https.request(options, function(res) {
        let data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          // AI-19: 先检查 HTTP 状态码
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error('ASR_HTTP_' + res.statusCode));
          }
          try {
            const result = JSON.parse(data);
            if (result.Response && result.Response.Result) {
              resolve(result.Response.Result);
            } else {
              reject(new Error('ASR_FAILED'));
            }
          } catch (e) {
    logger.error('voice-score-parse', (typeof action !== 'undefined' ? action : '-'), { err: e });
            reject(new Error('ASR_PARSE_ERROR'));
          }
        });
      });

      req.on('error', function(e) { reject(e); });
      // AI-25: 超时主动销毁请求
      req.on('timeout', function() { req.destroy(); reject(new Error('ASR_TIMEOUT')); });
      req.write(payloadStr);
      req.end();
    } catch (e) {
    logger.error('voice-score-parse', (typeof action !== 'undefined' ? action : '-'), { err: e });
      reject(e);
    }
  });
}

exports.main = async (event) => {
  const { action = 'parse', payload = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  // COST-07: 限流 20 次/分钟，防止腾讯 ASR 按次计费被刷
  const rl = rateLimit(openid, { limit: 20, windowMs: 60 * 1000 });
  if (!rl.ok) return { success: false, message: '操作太频繁，请稍后再试' };
  try {
    if (action === 'parse') {
      const { text, activityId } = payload;
      if (!text) return { success: false, message: 'text 不能为空' };
      const parsed = parseScoreText(text);
      if (parsed.length === 0) return { success: false, message: '未识别到比分，请说“A 21 比 15 B”' };
      // AI-31: result 改成结构化对象（按 activityId 匹配真实场次），不再返回 scores 数组
      const result = await buildResult(activityId, text, parsed);
      return { success: true, data: { result }, message: 'ok' };
    }
    if (action === 'asr' || action === 'recognize') {
      const { fileID, activityId } = payload;
      if (!fileID) return { success: false, message: 'fileID 不能为空' };
      let text;
      try {
        text = await tencentAsr(fileID);
      } catch (e) {
    logger.error('voice-score-parse', (typeof action !== 'undefined' ? action : '-'), { err: e });
        return { success: false, message: '语音识别未配置，请直接输入文字比分' };
      }
      const parsed = parseScoreText(text);
      if (parsed.length === 0) return { success: false, message: '未识别到比分，请说“A 21 比 15 B”' };
      // AI-31: result 改成结构化对象（按 activityId 匹配真实场次），不再返回 scores 数组
      const result = await buildResult(activityId, text, parsed);
      return { success: true, data: { text, result }, message: 'ok' };
    }
    return { success: false, message: '未知 action: ' + action };
  } catch (err) {
    logger.error('voice-score-parse', (typeof action !== 'undefined' ? action : '-'), { err: err });
    return { success: false, message: err.message || '解析失败' };
  }
};

// 供 test-regex.js 单测复用（AI-43）
exports.parseScoreText = parseScoreText;
