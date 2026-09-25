var callFunction = require('../../utils/request').callFunction;

Page({
  data: {
    activityId: '',
    loading: true,
    activityName: '',
    activeCount: 0,
    maxPlayers: 0,
    waitlistCount: 0,
    pairGapText: '',
    startGapText: '',
    waitlist: [],
    recommendations: [],
    aiNote: '',
    showAiNote: false
  },

  onLoad: function(options) {
    this.setData({ activityId: options.activityId || '' });
    if (this.data.activityId) this.loadData();
  },

  loadData: function() {
    var that = this;
    that.setData({ loading: true });

    callFunction('get-fill-suggestions', 'suggest', { activityId: that.data.activityId })
      .then(function(data) {
        // AI-36: 校验 success，失败走 catch
        if (!data || data.success === false) {
          throw new Error((data && data.message) || '加载失败');
        }
        var d = data.data || {};
        var pairGap = d.pairGap || 0;
        var startGap = d.startGap || 0;
        that.setData({
          loading: false,
          activityName: d.activityName || '羽毛球活动',
          activeCount: d.validCount || 0,
          maxPlayers: d.maxPlayers || 0,
          waitlistCount: d.waitlist || 0,
          pairGapText: pairGap > 0 ? '还差 ' + pairGap + ' 人可全员成双' : '已可全员成双',
          startGapText: startGap > 0 ? '还差 ' + startGap + ' 人可开始分组' : '已满足开赛人数',
          recommendations: (d.recommendations || []).map(function(r) {
            return typeof r === 'string' ? { text: r } : { text: r.text || r.name || JSON.stringify(r) };
          })
        });
      })
      .catch(function(err) {
        console.error('加载补位建议失败：', err);
        that.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  copyRecommendation: function(e) {
    var text = e.currentTarget.dataset.text;
    if (!text) return;
    wx.setClipboardData({ data: text, success: function() { wx.showToast({ title: '已复制', icon: 'success' }); } });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球补位推荐',
      path: '/pages/index/index'
    };
  }
});
