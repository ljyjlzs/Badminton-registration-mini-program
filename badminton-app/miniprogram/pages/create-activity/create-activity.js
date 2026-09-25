// 创建活动页面逻辑
var app = getApp();
var callFunction = require('../../utils/request.js').callFunction;
var nextSlotTime = require('../../utils/slotTime.js').nextSlotTime;

Page({
  data: {
    name: '',
    location: '',
    latitude: null,
    longitude: null,
    date: '',
    time: '',
    activityType: 'doubles',
    minPlayers: 4,
    maxPlayers: 100,
    playersPerCourt: 4,
    region: [],
    regionText: '',
    loading: false,
    showAiDialog: false,
    aiInput: '',
    aiEnabled: true,
    aiSuggestion: { show: false, title: '', desc: '', loading: false, suggestions: [], draft: null },
    recommend: { show: false, loading: false, list: [], aiNote: '', reliable: true, fallbackTip: '' }
  },

  onLoad: function () {
    this.initDateTime();
  },

  initDateTime: function () {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    var day = now.getDate() + 1;

    this.setData({
      date: year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'),
      time: '18:00'
    });
  },

  onNameInput: function (e) {
    this.setData({ name: e.detail.value });
  },

  onLocationInput: function (e) {
    this.setData({ location: e.detail.value });
  },

  onDateChange: function (e) {
    this.setData({ date: e.detail.value });
  },

  onTimeChange: function (e) {
    this.setData({ time: e.detail.value });
  },

  onTypeChange: function (e) {
    var type = e.currentTarget.dataset.type;
    var isDoubles = type !== 'singles';
    this.setData({
      activityType: type,
      minPlayers: isDoubles ? 4 : 3,
      maxPlayers: type === 'court-doubles' ? 100 : 100
    });
  },

  onPlayersPerCourtInput: function (e) {
    this.setData({ playersPerCourt: Number(e.detail.value) || 4 });
  },

  onRegionChange: function(e) {
    var region = e.detail.value;
    this.setData({
      region: region,
      regionText: region[0] + ' / ' + region[1] + ' / ' + region[2]
    });
  },

  onMaxPlayersInput: function(e) {
    this.setData({ maxPlayers: parseInt(e.detail.value) || 20 });
  },

  getLocation: function () {
    var self = this;
    wx.chooseLocation({
      success: function(res) {
        var location = '';
        if (res.address && res.name) {
          if (res.name.indexOf(res.address) !== -1 || res.address.indexOf(res.name) !== -1) {
            location = res.name || res.address;
          } else {
            location = res.address + res.name;
          }
        } else {
          location = res.name || res.address || '';
        }
        if (location) {
          self.setData({
            location: location,
            latitude: res.latitude,
            longitude: res.longitude
          });
        }
      },
      fail: function(err) {
        console.error('选择地点失败', err);
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '选择地点失败', icon: 'none' });
      }
    });
  },

  stopPropagation: function() {},

  showAiInput: function() {
    this.setData({ showAiDialog: true, aiInput: '' });
  },

  hideAiDialog: function() {
    this.setData({ showAiDialog: false });
  },

  onAiInput: function(e) {
    this.setData({ aiInput: e.detail.value });
  },

  onAiGenerate: function() {
    var input = this.data.aiInput.trim();
    if (!input) {
      wx.showToast({ title: '请输入活动需求描述', icon: 'none' });
      return;
    }
    this.setData({ showAiDialog: false });
    wx.navigateTo({
      url: '/pages/ai-activity-create/ai-activity-create?input=' + encodeURIComponent(input) + ''
    });
  },

  parseActivity: function() {
    var self = this;
    var input = self.data.aiInput.trim();
    if (!input) return;
    self.setData({ 'aiSuggestion.show': true, 'aiSuggestion.loading': true });
    // AI-13: parse-activity 读 message 字段
    callFunction('parse-activity', 'parse', { message: input }).then(function(res) {
      var data = (res.data && res.data.draft) || res.data || res;
      self.setData({
        'aiSuggestion.loading': false,
        'aiSuggestion.title': 'AI 解析结果',
        'aiSuggestion.desc': '以下是 AI 理解的活动信息，确认后预填表单',
        'aiSuggestion.suggestions': data.suggestions || [],
        'aiSuggestion.draft': data
      });
    }.bind(this)).catch(function() {
      this.setData({ 'aiSuggestion.show': false });
      wx.showToast({ title: 'AI 解析失败', icon: 'none' });
    }.bind(this));
  },

  applyAiDraft: function() {
    var draft = this.data.aiSuggestion.draft || {};
    if (draft.draft) draft = draft.draft;
    if (!draft) return;
    // parse-activity 的 time 为 "yyyy-MM-dd HH:mm:ss"，拆成 date/time 两个表单字段
    var date = draft.date || this.data.date;
    var time = draft.time || this.data.time;
    if (draft.time && String(draft.time).indexOf(' ') !== -1) {
      var parts = String(draft.time).split(' ');
      date = parts[0];
      time = parts[1] ? parts[1].slice(0, 5) : time;
    }
    this.setData({
      name: draft.name || this.data.name,
      location: draft.location || this.data.location,
      date: date,
      time: time,
      activityType: draft.type || this.data.activityType,
      'aiSuggestion.show': false
    });
  },

  discardAiDraft: function() {
    this.setData({ 'aiSuggestion.show': false });
  },

  fetchRecommend: function() {
    // AI-51: 60 秒冷却，防止频繁调用 recommend-time
    var now = Date.now();
    if (this._lastRecommendAt && (now - this._lastRecommendAt) < 60000) {
      wx.showToast({ title: '请稍后再试', icon: 'none' });
      return;
    }
    this._lastRecommendAt = now;
    this.setData({ 'recommend.show': true, 'recommend.loading': true });
    // AI-14: recommend-time 入参为 type（不是 activityType）
    callFunction('recommend-time', 'suggest', {
      type: this.data.activityType,
      location: this.data.location
    }).then(function(res) {
      var data = res.data || res;
      // AI-14: 出参为 recommendations（不是 list），并对齐 wxml 字段名
      var recs = data.recommendations || data.list || [];
      var topSuggested = data.suggestedTime || '';
      // AI-14: 每张卡片都填充各自的 suggestedTime（不再只有第 1 张回填 topSuggested）。
      // 优先取 AI 响应里的 item.suggestedTime，否则按该卡自己的 weekday+slot 推算下一次日期，最后用 topSuggested 兜底。
      var list = recs.map(function(item, idx) {
        var suggestedTime = item.suggestedTime || nextSlotTime(item.weekday, item.slot) || topSuggested || '';
        return {
          weekdayLabel: item.weekdayLabel || item.weekdayText || '',
          slot: item.slot || '',
          suggestedTime: suggestedTime,
          avgAttendanceRate: item.avgAttendanceRate != null ? item.avgAttendanceRate : (item.avgRate != null ? item.avgRate : null),
          sampleCount: item.sampleCount != null ? item.sampleCount : (item.n || 0),
          reason: item.reason || ''
        };
      });
      this.setData({
        'recommend.loading': false,
        'recommend.list': list,
        'recommend.aiNote': data.aiNote || '',
        'recommend.reliable': !!data.reliable,
        'recommend.fallbackTip': data.fallbackTip || ''
      });
    }.bind(this)).catch(function() {
      this.setData({ 'recommend.show': false });
    }.bind(this));
  },

  closeRecommend: function() {
    this.setData({ 'recommend.show': false });
  },

  applyRecommend: function(e) {
    var item = this.data.recommend.list[e.currentTarget.dataset.index];
    if (item && item.suggestedTime) {
      var parts = item.suggestedTime.split(' ');
      if (parts.length >= 2) {
        this.setData({ date: parts[0], time: parts[1] });
      }
    }
  },

  submit: function () {
    var self = this;
    var name = self.data.name;
    var location = self.data.location;
    var date = self.data.date;
    var time = self.data.time;

    if (!name || name.trim() === '') {
      wx.showToast({ title: '请输入活动名', icon: 'none' });
      return;
    }
    if (name.length > 50) {
      wx.showToast({ title: '活动名称不能超过50字', icon: 'none' });
      return;
    }
    if (!location || location.trim() === '') {
      wx.showToast({ title: '请输入活动地点', icon: 'none' });
      return;
    }
    if (!date) {
      wx.showToast({ title: '请选择活动日期', icon: 'none' });
      return;
    }
    if (!time) {
      wx.showToast({ title: '请选择活动时间', icon: 'none' });
      return;
    }

    var dateTimeStr = date + ' ' + time + ':00';
    var activityTime = new Date(dateTimeStr).getTime();
    if (activityTime <= Date.now()) {
      wx.showToast({ title: '活动时间需为未来时间', icon: 'none' });
      return;
    }

    self.setData({ loading: true });

    var payload = {
      name: name.trim(),
      location: location.trim(),
      latitude: self.data.latitude,
      longitude: self.data.longitude,
      province: self.data.region[0] || '',
      city: self.data.region[1] || '',
      district: self.data.region[2] || '',
      time: dateTimeStr,
      type: self.data.activityType,
      maxPlayers: self.data.activityType === 'court-doubles' ? (self.data.playersPerCourt || 4) : self.data.maxPlayers
    };
    if (self.data.activityType === 'court-doubles') {
      payload.playersPerCourt = self.data.playersPerCourt || 4;
    }

    callFunction('create-activity', 'create', payload).then(function(res) {
      self.setData({ loading: false });
      if (res && res.success) {
        wx.showToast({ title: '创建成功', icon: 'success' });
        var activityId = (res.data && res.data.activityId) || '';
        setTimeout(function() {
          wx.redirectTo({
            url: '/pages/activity-detail/activity-detail?id=' + activityId
          });
        }, 1500);
      } else {
        wx.showToast({ title: res.message || '创建失败', icon: 'none' });
      }
    }).catch(function(err) {
      self.setData({ loading: false });
      console.error('创建活动失败', err);
      wx.showToast({ title: err.message || '创建失败', icon: 'none' });
    });
  },

  onShareAppMessage: function() {
    return {
      title: '来打羽毛球吧！',
      path: '/pages/index/index'
    };
  }
});
