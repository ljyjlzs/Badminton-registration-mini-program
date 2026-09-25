/**
 * 统一云函数调用封装（00 §4 / 09 §9.1）
 * 云函数入参约定：{ action: string, payload: object }
 * 云函数返回约定：{ success: boolean, data: any, message: string }
 * 业务失败（success === false）会 reject，Error.message 为业务文案，并挂 err.result 供调用方读取完整信封。
 * 网络类失败（超时/断网/连接失败）自动重试，并维护 globalData.networkOk（BUG-46）。
 */

var MAX_NETWORK_RETRY = 2;
var RETRY_DELAY_MS = 500;

// 判断是否为网络类基础设施错误（业务失败走 result.success === false，不经过这里）
function isNetworkError(err) {
  if (!err) return false;
  var msg = String((err.errMsg || err.message || err));
  // 函数缺失/配置类错误不重试
  if (/not found|不存在|not exist/i.test(msg)) return false;
  // 超时、断网、连接失败等网络错误；或云调用失败的通用形态
  return /timeout|network|socket|unreachable|ECONN|ETIMEDOUT|ENOTFOUND|断网|连接|超时|request:fail|callFunction:fail/i.test(msg);
}

function delay(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function markNetwork(ok) {
  try {
    var app = getApp();
    if (app && app.globalData) app.globalData.networkOk = ok;
  } catch (e) { /* App 未就绪时忽略 */ }
}

// 带网络重试的云函数调用：失败且判定为网络错误时自动重试
function callCloud(name, action, data, attempt) {
  attempt = attempt || 0;
  return wx.cloud
    .callFunction({ name: name, data: { action: action, payload: data } })
    .then(function(res) {
      markNetwork(true);
      return res;
    })
    .catch(function(err) {
      var netErr = isNetworkError(err);
      if (netErr) markNetwork(false);
      if (netErr && attempt < MAX_NETWORK_RETRY) {
        return delay(RETRY_DELAY_MS).then(function() {
          return callCloud(name, action, data, attempt + 1);
        });
      }
      if (netErr && err && typeof err === 'object') err.network = true;
      return Promise.reject(err);
    });
}

function callFunction(name, action, data) {
  data = data || {};
  var t0 = Date.now();
  return callCloud(name, action, data, 0).then(function(res) {
    // ENG-01: 慢调用告警
    var ms = Date.now() - t0;
    if (ms > 5000) console.warn('[slow]', name, action, ms + 'ms');
    var result = (res && res.result) || {};
    if (typeof result.success === 'boolean' && result.success === false) {
      var err = new Error(result.message || '操作失败');
      err.result = result;
      err.business = true;
      return Promise.reject(err);
    }
    return result;
  });
}

function request(name, action, data) {
  data = data || {};
  var t0 = Date.now();
  return callCloud(name, action, data, 0).then(function(res) {
    // ENG-01: 慢调用告警
    var ms = Date.now() - t0;
    if (ms > 5000) console.warn('[slow]', name, action, ms + 'ms');
    return res;
  });
}

module.exports = { callFunction, request };
