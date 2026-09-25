/**
 * 订阅消息一次性授权（UX-02）
 * 微信要求发送前用户已授权；模板 ID 优先取云端配置（与云函数 env 同源），
 * 本地缓存兜底，缺省时静默跳过不阻断业务。
 *
 * 模板 ID 解析顺序（后者覆盖前者为空的字段）：
 *   1. 构建期 process.env（若打包工具注入了）
 *   2. wx.getStorageSync('subscribeTmplIds')（上次从云端同步的缓存）
 *   3. app.globalData.subscribeTmplIds（syncTmplIds 刚写入的最新值）
 *
 * 用法：requestSubscribe('join', function(){ ...真正报名... })
 */
var callFunction = require('./request').callFunction;

var STORAGE_KEY = 'subscribeTmplIds';

// 场景 → 需要申请的模板字段（一次只申请当前场景用到的，避免用户困惑）
var SCENE_FIELDS = {
  join: ['matchReminder'],
  schedule: ['matchReminder'],
  live: ['liveScore']
};
var ALL_FIELDS = ['matchReminder', 'liveScore'];

// 同步去重：并发调用时共享一次云端拉取
var syncing = false;
var syncWaiters = [];

function readEnvIds() {
  // 原生小程序无 process 对象，安全降级；构建期注入时才生效
  var out = {};
  try {
    if (typeof process !== 'undefined' && process && process.env) {
      if (process.env.MATCH_REMINDER_TEMPLATE_ID) {
        out.matchReminder = process.env.MATCH_REMINDER_TEMPLATE_ID;
      }
      if (process.env.LIVE_SCORE_TEMPLATE_ID) {
        out.liveScore = process.env.LIVE_SCORE_TEMPLATE_ID;
      }
    }
  } catch (e) {}
  return out;
}

function readStoredIds() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || {};
  } catch (e) {
    return {};
  }
}

function readGlobalIds() {
  var app = getApp();
  return (app && app.globalData && app.globalData.subscribeTmplIds) || {};
}

function getTmplMap() {
  // 优先级：globalData（最新）> 本地缓存 > 构建期 env
  var merged = {};
  [readEnvIds(), readStoredIds(), readGlobalIds()].forEach(function(src) {
    if (src.matchReminder) merged.matchReminder = src.matchReminder;
    if (src.liveScore) merged.liveScore = src.liveScore;
  });
  return merged;
}

function pickIds(map, fields) {
  var ids = [];
  fields.forEach(function(f) {
    var v = map[f];
    if (v && ids.indexOf(v) === -1) ids.push(v);
  });
  return ids;
}

/**
 * 取当前可申请的模板 ID 列表。
 * @param {string} [scene] 'join' | 'schedule' | 'live'；缺省返回全部
 */
function getTmplIds(scene) {
  var map = getTmplMap();
  var fields = scene && SCENE_FIELDS[scene] ? SCENE_FIELDS[scene] : ALL_FIELDS;
  return pickIds(map, fields);
}

function storeIds(ids) {
  try {
    var prev = readStoredIds();
    var merged = {
      matchReminder: (ids && ids.matchReminder) || prev.matchReminder || '',
      liveScore: (ids && ids.liveScore) || prev.liveScore || ''
    };
    wx.setStorageSync(STORAGE_KEY, merged);
    var app = getApp();
    if (app && app.globalData) app.globalData.subscribeTmplIds = merged;
  } catch (e) {}
}

/**
 * 从云端配置同步模板 ID（与云函数 env 同源），写入缓存供 requestSubscribe 使用。
 * done(err, map) 可选；两个云函数并行拉取，单边失败不影响另一边。
 */
function syncTmplIds(done) {
  if (syncing) {
    if (done) syncWaiters.push(done);
    return;
  }
  syncing = true;
  if (done) syncWaiters.push(done);

  var result = {};
  var pending = 2;
  function step() {
    pending--;
    if (pending > 0) return;
    storeIds(result);
    syncing = false;
    var waiters = syncWaiters;
    syncWaiters = [];
    waiters.forEach(function(fn) {
      try { fn(null, result); } catch (e) {}
    });
  }

  callFunction('match-reminders', 'config', {})
    .then(function(res) {
      var data = (res && res.data) || {};
      if (data.matchReminder) result.matchReminder = data.matchReminder;
    })
    .catch(function() {})
    .then(step);

  callFunction('match-live-score', 'config', {})
    .then(function(res) {
      var data = (res && res.data) || {};
      if (data.liveScore) result.liveScore = data.liveScore;
    })
    .catch(function() {})
    .then(step);
}

function doRequest(ids, done) {
  wx.requestSubscribeMessage({
    tmplIds: ids,
    success: function() { if (done) done(); },
    fail: function() { if (done) done(); } // 用户拒绝也继续业务
  });
}

/**
 * 申请订阅消息授权。
 * @param {string} scene 'join' | 'schedule' | 'live'
 * @param {Function} [done] 无论拒绝/失败都会调用，业务流程不中断
 */
function requestSubscribe(scene, done) {
  var key = typeof scene === 'string' ? scene : '';
  var ids = getTmplIds(key);
  if (ids.length && typeof wx.requestSubscribeMessage === 'function') {
    doRequest(ids, done);
    return;
  }
  // 缓存为空时先从云端同步一次再申请
  syncTmplIds(function() {
    var retryIds = getTmplIds(key);
    if (!retryIds.length || typeof wx.requestSubscribeMessage !== 'function') {
      if (done) done();
      return;
    }
    doRequest(retryIds, done);
  });
}

module.exports = {
  requestSubscribe: requestSubscribe,
  getTmplIds: getTmplIds,
  syncTmplIds: syncTmplIds
};
