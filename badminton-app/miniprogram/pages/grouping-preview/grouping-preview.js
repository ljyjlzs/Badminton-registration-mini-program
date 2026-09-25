var callFunction = require('../../utils/request').callFunction;

Page({
  data: {
    activityId: '',
    activityName: '分组预览',
    typeLabel: '',
    teams: [],
    matchesCount: 0,
    repeatNotice: '',
    rules: [],
    explanation: [],
    loading: true,
    confirming: false
  },

  onLoad: function(options) {
    var activityId = options.activityId || '';
    var activityName = options.activityName ? decodeURIComponent(options.activityName) : '分组预览';
    this.setData({ activityId: activityId, activityName: activityName });
    if (activityId) this.loadPreview();
  },

  loadPreview: function() {
    var that = this;
    that.setData({ loading: true });

    // 先取活动详情拿 type，此前 activityType 从未赋值导致永远回退 doubles
    callFunction('get-activity-detail', 'detail', { activityId: that.data.activityId })
      .then(function(detailRes) {
        var activityType = (detailRes && detailRes.data && detailRes.data.activity && detailRes.data.activity.type) || 'doubles';
        that.setData({ activityType: activityType });

        return callFunction('court-list', 'get', { activityId: that.data.activityId });
      })
      .then(function(data) {
        var courts = (data.data || data).courts || [];
        var totalPlayers = 0;
        var rules = [];

        courts.forEach(function(c) {
          rules.push(c.label + ': ' + c.members.length + ' 人');
          totalPlayers += c.members.length;
        });

        var typeLabels = { singles: '单打', doubles: '双打轮转', 'fixed-doubles': '双打固搭', 'court-doubles': '按场地双打' };
        var activityType = that.data.activityType || 'doubles';
        var typeLabel = typeLabels[activityType] || '双打轮转';
        var matchesCount = 0;
        courts.forEach(function(c) {
          if (c.members.length >= 4) {
            var n = c.members.length;
            matchesCount += Math.floor(n / 2) * (n - 1);
          }
        });

        that.setData({
          loading: false,
          typeLabel: typeLabel,
          matchesCount: matchesCount,
          rules: rules,
          teams: courts.map(function(c, i) {
            return {
              index: i + 1,
              memberNamesText: c.members.map(function(m) { return m.nickname || '球友'; }).join(' / '),
              totalLevel: c.members.reduce(function(a, m) { return a + (m.level || 5); }, 0)
            };
          })
        });
      })
      .catch(function(err) {
        console.error('加载分组预览失败：', err);
        that.setData({ loading: false });
        wx.showToast({ title: '预览失败', icon: 'none' });
        setTimeout(function() { wx.navigateBack(); }, 1500);
      });
  },

  goBack: function() {
    wx.navigateBack();
  },

  confirmGrouping: function() {
    var that = this;
    if (that.data.confirming) return;
    wx.showModal({
      title: '确认分组',
      content: '确认后分组立即生效，报名将关闭。是否确认？',
      success: function(res) {
        if (!res.confirm) return;
        that.setData({ confirming: true });
        wx.showLoading({ title: '分组中...' });
        callFunction('court-start', 'generate', { activityId: that.data.activityId })
          .then(function(res) {
            wx.hideLoading();
            if (res && res.success === false) {
              wx.showToast({ title: res.message || '分组失败', icon: 'none' });
              that.setData({ confirming: false });
              return;
            }
            wx.showToast({ title: '分组完成', icon: 'success' });
            setTimeout(function() {
              wx.redirectTo({ url: '/pages/grouping/grouping?activityId=' + that.data.activityId });
            }, 1200);
          })
          .catch(function(err) {
            wx.hideLoading();
            that.setData({ confirming: false });
            console.error('确认分组失败：', err);
          });
      }
    });
  },

  regenerateGrouping: function() {
    var that = this;
    wx.showLoading({ title: '重新生成...' });
    callFunction('start-grouping', 'apply', { activityId: that.data.activityId, preview: true })
      .then(function(res) {
        wx.hideLoading();
        if (res && res.success !== false) {
          var data = (res.data && res.data.preview) || res.data || res;
          that.setData({
            teams: Array.isArray(data.teams) ? data.teams : that.data.teams,
            rules: data.reasons || data.rules || that.data.rules,
            matchesCount: data.matches || data.matchesCount || 0
          });
          wx.showToast({ title: '已重新生成（仅预览）', icon: 'success' });
        } else {
          wx.showToast({ title: res.message || '生成失败', icon: 'none' });
        }
      })
      .catch(function() {
        wx.hideLoading();
        wx.showToast({ title: '生成失败', icon: 'none' });
      });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球活动分组预览',
      path: '/pages/grouping-preview/grouping-preview?activityId=' + this.data.activityId
    };
  }
});
