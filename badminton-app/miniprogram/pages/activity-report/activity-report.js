var callFunction = require('../../utils/request').callFunction;

var statusTextMap = {
  registering: '报名中',
  grouping: '分组中',
  playing: '比赛中',
  finished: '已结束'
};

Page({
  data: {
    activityId: '',
    loading: true,
    status: 'none',
    report: null,
    badges: [],
    regenerating: false
  },

  onLoad: function(options) {
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      this.loadReport();
    }
  },

  loadReport: function() {
    var that = this;
    that.setData({ loading: true });

    callFunction('get-activity-report', 'get', { activityId: that.data.activityId })
      .then(function(res) {
        var data = res.data || res;
        if (data && data.report) {
          that.setData({
            loading: false,
            status: 'finished',
            report: data.report,
            badges: data.badges || []
          });
        } else {
          that.setData({ loading: false, status: 'none' });
        }
      })
      .catch(function() {
        that.setData({ loading: false, status: 'failed' });
      });
  },

  regenerateReport: function() {
    var that = this;
    that.setData({ regenerating: true });
    callFunction('get-activity-report', 'generate', { activityId: that.data.activityId })
      .then(function(res) {
        that.setData({ regenerating: false });
        if (res && res.success) {
          that.setData({ status: 'generating' });
          wx.showToast({ title: '已触发生成', icon: 'success' });
          setTimeout(function() { that.loadReport(); }, 3000);
        } else {
          wx.showToast({ title: '生成失败', icon: 'none' });
        }
      })
      .catch(function() {
        that.setData({ regenerating: false });
        wx.showToast({ title: '生成失败', icon: 'none' });
      });
  },

  shareReport: function() {
    wx.showToast({ title: '分享功能开发中', icon: 'none' });
  },

  copyReport: function() {
    var report = this.data.report;
    if (!report) return;
    var text = report.activityName + '\n' + report.location + ' · ' + report.time + '\n';
    text += '参与人数: ' + report.totalPlayers + '\n';
    text += '完成场次: ' + report.finishedMatches + '/' + report.totalMatches + '\n';
    text += '总得分: ' + report.totalScore;
    if (report.content) text += '\n\n' + report.content;
    wx.setClipboardData({ data: text, success: function() { wx.showToast({ title: '已复制', icon: 'success' }); } });
  },

  goToMySummary: function() {
    wx.navigateTo({ url: '/pages/my-summary/my-summary' });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球活动报告',
      path: '/pages/activity-report/activity-report?activityId=' + (this.data.activityId || '')
    };
  }
});
