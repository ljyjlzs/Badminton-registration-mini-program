var app = getApp();
var callFunction = require('../../utils/request').callFunction;

Page({
  data: {
    activityId: '',
    loading: true,
    loadError: false,
    candidates: [],
    selectedIds: [],
    selectedMap: {},
    selectedCount: 0,
    generating: false,
    invites: [],
    inviteSource: '',
    aiEnabled: true
  },

  onLoad: function(options) {
    this.setData({
      activityId: options.activityId || '',
      aiEnabled: !!(app && app.globalData && app.globalData.aiEnabled)
    });
    this.loadCandidates();
  },

  loadCandidates: function() {
    var that = this;
    that.setData({ loading: true, loadError: false });
    callFunction('invite-candidates', 'list', { activityId: that.data.activityId, limit: 10 })
      .then(function(res) {
        var data = res.data || res;
        var candidates = (data.candidates || []).map(function(item) {
          return Object.assign({}, item, {
            avatarText: (item.nickname || '?').slice(0, 1),
            // AI-50: rating 缺失时用 level 估算兜底，否则 '-'
            ratingText: item.rating != null ? item.rating : (item.level != null ? Math.round(1000 + (item.level - 5) * 80) : '-'),
            lastJoinTimeText: item.lastJoinTime || '',
            // AI-50: 后端 reasons 数组 → 前端 reason 展示字段
            reason: (item.reasons && item.reasons[0]) || item.reason || ''
          });
        });
        that.setData({ loading: false, candidates: candidates });
      })
      .catch(function(err) {
        console.error('加载候选失败：', err);
        // BUG-46: 加载失败展示可重试错误态
        that.setData({ loading: false, loadError: true });
      });
  },

  // BUG-46: 加载失败后重新加载
  retryLoad: function() {
    this.loadCandidates();
  },

  toggleCandidate: function(e) {
    var userId = e.currentTarget.dataset.id;
    var selectedMap = Object.assign({}, this.data.selectedMap);
    var selectedIds = this.data.selectedIds.slice();
    var selected = !!selectedMap[userId];

    if (selected) {
      delete selectedMap[userId];
      selectedIds = selectedIds.filter(function(id) { return id !== userId; });
    } else {
      if (selectedIds.length >= 10) {
        wx.showToast({ title: '最多选择10人', icon: 'none' });
        return;
      }
      selectedMap[userId] = true;
      selectedIds.push(userId);
    }

    this.setData({
      selectedIds: selectedIds,
      selectedMap: selectedMap,
      selectedCount: selectedIds.length,
      invites: [],
      inviteSource: ''
    });
  },

  generateInvites: function() {
    var that = this;
    if (that.data.generating) return;
    that.setData({ generating: true, invites: [], inviteSource: '' });
    wx.showLoading({ title: '生成中...' });

    callFunction('invite', 'generateInvites', {
      activityId: that.data.activityId,
      candidateIds: that.data.selectedIds
    }).then(function(res) {
      wx.hideLoading();
      var data = res.data || res;
      var invites = ((data && data.invites) || []).map(function(item) {
        return Object.assign({}, item, { avatarText: (item.nickname || '?').slice(0, 1) });
      });
      that.setData({ generating: false, invites: invites, inviteSource: data.source || 'ai' });
    }).catch(function(err) {
      wx.hideLoading();
      console.error('生成邀请语失败：', err);
      that.setData({ generating: false });
    });
  },

  copyInvite: function(e) {
    var content = e.currentTarget.dataset.content;
    if (!content) return;
    wx.setClipboardData({ data: content, success: function() { wx.showToast({ title: '已复制', icon: 'success' }); } });
  },

  shareLink: function() {
    wx.showShareMenu({ withShareTicket: true });
  },

  onShareAppMessage: function() {
    return {
      title: '智能邀约',
      path: '/pages/invite/invite'
    };
  },

  onShareTimeline: function() {
    return {
      title: '智能邀约'
    };
  }
});
