var app = getApp();
var callFunction = require('../../utils/request.js').callFunction;
var shareUtil = require('../../utils/share.js');

Page({
  onShareAppMessage: function() {
    var s = shareUtil.makeShare({
      title: '比赛记分',
      path: '/pages/match-score/match-score',
      query: 'activityId=' + (this.data.activityId || '') + '&matchId=' + (this.data.matchId || '')
    });
    return { title: s.title, path: s.path };
  },

  onShareTimeline: function() {
    var s = shareUtil.makeShare({
      title: '比赛记分',
      path: '/pages/match-score/match-score',
      query: 'activityId=' + (this.data.activityId || '') + '&matchId=' + (this.data.matchId || '')
    });
    return { title: s.title, query: s.timeline.query };
  },

  data: {
    activityId: '',
    matchId: '',
    match: null,
    team1: null,
    team2: null,
    team1Score: 0,
    team2Score: 0,
    isOrganizer: false,
    isScorer: false,
    userTeam: null,
    loading: true,
    loadError: false,
    confirming: false,
    modifying: false,
    scoreRange: ['0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30']
  },

  onLoad: function(options) {
    this._firstShowDone = false;
    // UX-19: 记分页保持屏幕常亮
    wx.setKeepScreenOn({ keepScreenOn: true });
    if (options.activityId && options.matchId) {
      this.setData({ activityId: options.activityId, matchId: options.matchId });
      this.loadMatchDetail();
    } else {
      // 缺少参数时结束加载态，展示空状态（可重新加载或返回）
      this.setData({ loading: false });
    }
  },

  onUnload: function() {
    // UX-19: 离开记分页恢复自动锁屏
    wx.setKeepScreenOn({ keepScreenOn: false });
  },

  onShow: function() {
    // PERF-17: 首次 onShow 不重复加载（onLoad 已加载）
    if (!this._firstShowDone) {
      this._firstShowDone = true;
      return;
    }
    if (this.data.matchId) {
      this.loadMatchDetail();
    }
  },

  // UX-26: 下拉刷新
  onPullDownRefresh: function() {
    this.loadMatchDetail();
    wx.stopPullDownRefresh();
  },

  reloadData: function() {
    this.loadMatchDetail();
  },

  // BUG-46: 统一重试入口
  retryLoad: function() {
    this.reloadData();
  },

  loadMatchDetail: function() {
    // UX-10: 已有数据时静默刷新，避免从子页面返回整页白屏
    var silent = !!this.data.match;
    this.setData(silent ? { loadError: false } : { loading: true, loadError: false });
    callFunction('get-match-detail', 'detail', { activityId: this.data.activityId, matchId: this.data.matchId }).then(function(res) {
      this.setData({ loading: false });
      if (res.success) {
        var d = res.data;
        var team1 = { id: d.team1.id, name: d.team1.name || '队伍A', members: d.team1.members || [] };
        var team2 = { id: d.team2.id, name: d.team2.name || '队伍B', members: d.team2.members || [] };
        this.setData({
          match: d.match,
          team1: team1,
          team2: team2,
          team1Score: d.match.team1Score || 0,
          team2Score: d.match.team2Score || 0,
          isOrganizer: d.isOrganizer,
          isScorer: d.isScorer,
          userTeam: d.userTeam
        });
      } else {
        wx.showToast({ title: res.message || '加载失败', icon: 'none' });
      }
    }.bind(this)).catch(function(err) {
      console.error('加载比赛详情失败：', err);
      // 业务提示（如"比赛不存在"）保留原文案空态；其余异常标记 loadError 展示重试空态
      var notFound = ((err && err.message) || '').indexOf('不存在') >= 0;
      if (notFound) {
        this.setData({ loading: false });
      } else {
        this.setData({ loading: false, loadError: true });
      }
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    }.bind(this));
  },

  onTeam1ScoreChange: function(e) {
    var scoreRange = this.data.scoreRange;
    this.setData({ team1Score: parseInt(scoreRange[e.detail.value]) });
  },

  onTeam2ScoreChange: function(e) {
    var scoreRange = this.data.scoreRange;
    this.setData({ team2Score: parseInt(scoreRange[e.detail.value]) });
  },

  onTeam1ScoreInput: function(e) {
    var val = parseInt(e.detail.value) || 0;
    if (val > 30) val = 30;
    if (val < 0) val = 0;
    this.setData({ team1Score: val });
  },

  onTeam2ScoreInput: function(e) {
    var val = parseInt(e.detail.value) || 0;
    if (val > 30) val = 30;
    if (val < 0) val = 0;
    this.setData({ team2Score: val });
  },

  submitScore: function() {
    if (!this.data.isOrganizer && !this.data.isScorer) {
      wx.showToast({ title: '您没有记分权限', icon: 'none' });
      return;
    }
    var team1Score = this.data.team1Score;
    var team2Score = this.data.team2Score;
    if (team1Score === team2Score) {
      wx.showToast({ title: '比分不能相同', icon: 'none' });
      return;
    }
    var self = this;
    wx.showModal({
      title: '确认比分',
      content: (this.data.team1.name || '队伍1') + ': ' + team1Score + ' vs ' + (this.data.team2.name || '队伍2') + ': ' + team2Score,
      success: function(res) { if (res.confirm) self.doSubmitScore(); }
    });
  },

  doSubmitScore: function() {
    this.setData({ confirming: true });
    var self = this;
    callFunction('submit-score', 'submit', {
      matchId: this.data.matchId,
      team1Score: this.data.team1Score,
      team2Score: this.data.team2Score
    }).then(function(res) {
      self.setData({ confirming: false });
      if (res.success) {
        wx.vibrateShort({ type: 'light' });
        wx.showToast({ title: '比分已提交', icon: 'success' });
        self.loadMatchDetail();
      } else {
        wx.vibrateShort({ type: 'heavy' });
        wx.showToast({ title: res.message || '提交失败', icon: 'none' });
      }
    }).catch(function(err) {
      self.setData({ confirming: false });
      console.error('提交比分失败：', err);
      wx.vibrateShort({ type: 'heavy' });
      wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' });
    });
  },

  modifyScore: function() {
    var self = this;
    wx.showModal({
      title: '修改比分',
      content: '确定要修改已提交的比分吗？',
      confirmText: '确定修改',
      cancelText: '取消',
      success: function(res) {
        if (res.confirm) {
          self.setData({ modifying: true });
          callFunction('submit-score', 'modify', {
            matchId: self.data.matchId,
            team1Score: self.data.team1Score,
            team2Score: self.data.team2Score
          }).then(function(r) {
            self.setData({ modifying: false });
            if (r.success) {
              wx.vibrateShort({ type: 'light' });
              wx.showToast({ title: '比分已修改', icon: 'success' });
              self.loadMatchDetail();
            } else {
              wx.vibrateShort({ type: 'heavy' });
              wx.showToast({ title: r.message || '修改失败', icon: 'none' });
            }
          }).catch(function(err) {
            self.setData({ modifying: false });
            wx.vibrateShort({ type: 'heavy' });
            wx.showToast({ title: (err && err.message) || '修改失败', icon: 'none' });
          });
        }
      }
    });
  },

  goBack: function() {
    wx.navigateBack();
  },

  resetScores: function() {
    this.setData({ team1Score: 0, team2Score: 0 });
  },

  quickScore: function(e) {
    var s1 = parseInt(e.currentTarget.dataset.s1);
    var s2 = parseInt(e.currentTarget.dataset.s2);
    this.setData({ team1Score: s1, team2Score: s2 });
  },

  // 同步现场比分
  updateLiveScore: function() {
    var self = this;
    // UX-02：开启比分直播前申请订阅（拒绝也继续同步）
    var subscribe = require('../../utils/subscribe.js');
    subscribe.requestSubscribe('live', function() {
      callFunction('match-live-score', 'update', {
        activityId: self.data.activityId,
        matchId: self.data.matchId,
        teamAScore: self.data.team1Score,
        teamBScore: self.data.team2Score
      }).then(function(res) {
        if (res && res.success) {
          wx.showToast({ title: '现场比分已同步', icon: 'success' });
        } else {
          wx.showToast({ title: res.message || '同步失败', icon: 'none' });
        }
      }).catch(function() {
        wx.showToast({ title: '同步失败', icon: 'none' });
      });
    });
  },

  // 清除现场比分
  clearLiveScore: function() {
    var self = this;
    callFunction('match-live-score', 'clear', {
      activityId: self.data.activityId,
      matchId: self.data.matchId
    }).then(function(res) {
      if (res && res.success) {
        wx.showToast({ title: '已清除', icon: 'success' });
      } else {
        wx.showToast({ title: res.message || '清除失败', icon: 'none' });
      }
    }).catch(function() {
      wx.showToast({ title: '清除失败', icon: 'none' });
    });
  }
});
