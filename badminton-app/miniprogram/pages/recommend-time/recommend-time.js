const { callFunction } = require('../../utils/request.js');
const { nextSlotTime } = require('../../utils/slotTime.js');

// AI-51: 模块级缓存，避免每次进入页面都重复调用后端推荐
var recommendCache = { data: null, ts: 0 };
var RECOMMEND_CACHE_TTL = 5 * 60 * 1000;

Page({
  data: {
    loading: true,
    recommendations: [],
    suggestedTime: '',
    aiNote: '',
    reliable: false,
    fallbackTip: ''
  },

  onLoad() {
    // AI-51: 同一页面实例只加载一次；跨实例命中模块级缓存
    if (this._loaded) return;
    this._loaded = true;
    this.loadData();
  },

  async loadData(force) {
    try {
      if (!force && recommendCache.data && (Date.now() - recommendCache.ts) < RECOMMEND_CACHE_TTL) {
        this.applyResult(recommendCache.data);
        return;
      }
      this.setData({ loading: true });
      const data = await callFunction('recommend-time', 'recommend', {});
      const d = (data && data.data) || data || {};
      recommendCache = { data: d, ts: Date.now() };
      this.applyResult(d);
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.setData({ loading: false });
    }
  },

  applyResult(d) {
    this.setData({
      recommendations: (d.recommendations || []).map(function(r, i) {
        // AI-14: 每张卡片都填充各自的 suggestedTime（不再只有第 1 张用全局 d.suggestedTime）。
        // 优先取响应里的 r.suggestedTime，否则按该卡自己的 weekday+slot 推算下一次日期。
        var suggestedTime = r.suggestedTime || nextSlotTime(r.weekday, r.slot) || (i === 0 ? (d.suggestedTime || '') : '') || '';
        return Object.assign({}, r, {
          rateText: Math.round((r.avgRate || 0) * 100),
          suggestedTime: suggestedTime,
          // AI-52: 每张卡片使用各自时间，不再共用全局 suggestedTime
          timeText: suggestedTime || ((r.weekdayText || '') + ' ' + (r.slot || '')).trim()
        });
      }),
      suggestedTime: d.suggestedTime || '',
      aiNote: d.aiNote || '',
      reliable: d.reliable || false,
      fallbackTip: d.fallbackTip || '',
      loading: false
    });
  },

  selectTime(e) {
    const time = e.currentTarget.dataset.time;
    if (time) {
      wx.setClipboardData({ data: time, success: () => wx.showToast({ title: '已复制时间', icon: 'success' }) });
    }
  }
});
