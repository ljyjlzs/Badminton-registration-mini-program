var app = getApp();
var callFunction = require('../../utils/request.js').callFunction;
var shareUtil = require('../../utils/share.js');

Page({
  onShareAppMessage: function() {
    var s = shareUtil.makeShare({
      title: (this.data.activity && this.data.activity.name ? this.data.activity.name + ' · 分组' : '羽毛球分组'),
      path: '/pages/grouping/grouping',
      query: 'activityId=' + (this.data.activityId || '')
    });
    return { title: s.title, path: s.path };
  },

  onShareTimeline: function() {
    var s = shareUtil.makeShare({
      title: (this.data.activity && this.data.activity.name ? this.data.activity.name + ' · 分组' : '羽毛球分组'),
      path: '/pages/grouping/grouping',
      query: 'activityId=' + (this.data.activityId || '')
    });
    return { title: s.title, query: s.timeline.query };
  },

  data: {
    activityId: '',
    activity: null,
    teams: [],
    matches: [],
    loading: true,
    isOrganizer: false,
    namingTeamId: null,
    teamName: '',
    completedCount: 0,
    locked: false,
    globalBannerVisible: false,
    globalCurrentText: '',
    globalNextText: '',
    voiceEnabled: false,
    voiceConfigured: false,
    voiceRecording: false,
    voiceRecognizing: false,
    voiceShowPanel: false,
    voiceResult: null,
    voiceSubmitting: false
  },

  stopPropagation: function() {},

  onLoad: function(options) {
    this._firstShowDone = false;
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      this.setData({
        voiceEnabled: !!(app.globalData && app.globalData.voiceEnabled),
        voiceConfigured: !!(app.globalData && app.globalData.voiceConfig && app.globalData.voiceConfig.secretId)
      });
      this.loadGroupingData();
    }
  },

  onShow: function() {
    // PERF-17: 首次 onShow 不重复加载（onLoad 已加载）
    if (!this._firstShowDone) {
      this._firstShowDone = true;
      return;
    }
    if (this.data.activityId) {
      this.loadGroupingData();
    }
  },

  // UX-26: 下拉刷新
  onPullDownRefresh: function() {
    this.loadGroupingData();
    wx.stopPullDownRefresh();
  },

  loadGroupingData: function() {
    // UX-10: 已有数据时静默刷新，避免从子页面返回整页白屏
    if (!this.data.activity) {
      this.setData({ loading: true });
    }
    var self = this;
    callFunction('get-activity-detail', 'detail', { activityId: this.data.activityId }).then(function(res) {
      self.setData({ loading: false });
      if (res.success && res.data) {
        var data = res.data;
        var matches = data.matches || [];
        var completedCount = 0;
        for (var i = 0; i < matches.length; i++) {
          if (matches[i].status === 'finished') completedCount++;
        }
        var activity = data.activity || null;
        // UX-20: 导航标题带活动名
        if (activity && activity.name) {
          wx.setNavigationBarTitle({ title: '分组 - ' + activity.name });
        }
        var locked = activity && (activity.status === 'playing' || activity.status === 'finished');
        
        // 全局横幅
        var matchList = data.matches || [];
        var playingMatch = null;
        var nextMatch = null;
        for (var k = 0; k < matchList.length; k++) {
          if (matchList[k].status === 'playing') { playingMatch = matchList[k]; break; }
        }
        for (var m = 0; m < matchList.length; m++) {
          if (matchList[m].status === 'pending') { nextMatch = matchList[m]; break; }
        }

        self.setData({
          activity: activity,
          teams: data.teams || [],
          matches: matches,
          completedCount: completedCount,
          isOrganizer: activity && activity.organizerId === app.globalData.openid,
          locked: locked,
          globalBannerVisible: !!(playingMatch || nextMatch),
          globalCurrentText: playingMatch ? ('场地' + (playingMatch.court || '') + ' 比赛中') : '',
          globalNextText: nextMatch ? ('第' + (nextMatch.roundOrder || '') + '场 即将开始') : ''
        });
      }
    }).catch(function(err) {
      self.setData({ loading: false });
      console.error('加载分组数据失败：', err);
    });
  },

  startNaming: function(e) {
    // CH10-1: isOrganizer + locked 双重门禁，比赛中/已结束禁止改队名
    if (!this.data.isOrganizer || this.data.locked) {
      wx.showToast({ title: this.data.locked ? '比赛已开始，无法改队名' : '仅组织者可操作', icon: 'none' });
      return;
    }
    var teamId = e.currentTarget.dataset.teamid;
    this.setData({ namingTeamId: teamId, teamName: '' });
  },

  onTeamNameInput: function(e) {
    this.setData({ teamName: e.detail.value });
  },

  confirmTeamName: function() {
    var name = this.data.teamName.trim();
    if (!name) {
      wx.showToast({ title: '请输入队名', icon: 'none' });
      return;
    }
    var teamId = this.data.namingTeamId;
    if (!teamId) return;
    var self = this;
    callFunction('update-activity-status', 'update', {
      activityId: this.data.activityId,
      teamId: teamId,
      teamName: name
    }).then(function(res) {
      if (res.success) {
        wx.showToast({ title: '队名已更新', icon: 'success' });
        self.setData({ namingTeamId: null, teamName: '' });
        self.loadGroupingData();
      } else {
        wx.showToast({ title: res.message || '修改失败', icon: 'none' });
      }
    }).catch(function() {
      wx.showToast({ title: '修改失败', icon: 'none' });
    });
  },

  cancelNaming: function() {
    this.setData({ namingTeamId: null, teamName: '' });
  },

  goToMatchScore: function(e) {
    var matchId = e.currentTarget.dataset.matchid;
    wx.navigateTo({
      url: '/pages/match-score/match-score?activityId=' + this.data.activityId + '&matchId=' + matchId
    });
  },

  startAllMatches: function() {
    if (!this.data.isOrganizer) {
      wx.showToast({ title: '仅组织者可操作', icon: 'none' });
      return;
    }
    var self = this;
    wx.showModal({
      title: '开始比赛',
      content: '确定将活动状态切换为比赛中吗？之后可直接记分。',
      success: function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '开始中...' });
          callFunction('update-activity-status', 'update', {
            activityId: self.data.activityId,
            status: 'playing'
          }).then(function(r) {
            wx.hideLoading();
            if (r.success) {
              wx.showToast({ title: '比赛已开始', icon: 'success' });
              self.loadGroupingData();
            } else {
              wx.showToast({ title: r.message || '操作失败', icon: 'none' });
            }
          }).catch(function() {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 全局横幅点击
  onGlobalBannerTap: function() {
    var matches = this.data.matches || [];
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].status === 'playing') {
        wx.navigateTo({
          url: '/pages/match-score/match-score?activityId=' + this.data.activityId + '&matchId=' + matches[i]._id
        });
        return;
      }
    }
  },

  // 语音填分
  startVoiceInput: function() {
    var self = this;
    if (!self.data.voiceConfigured) {
      wx.showToast({ title: '语音识别未配置', icon: 'none' });
      return;
    }
    self.setData({ voiceRecording: true, voiceRecognizing: false });
    var recorderManager = wx.getRecorderManager();
    self._recorderManager = recorderManager;
    self._recorderManager.onStop(function(res) {
      if (res.tempFilePath) {
        self.setData({ voiceRecognizing: true });
        self.uploadActivityVoice(res.tempFilePath);
      }
    });
    self._recorderManager.onError(function() {
      self.setData({ voiceRecording: false });
      wx.showToast({ title: '录音失败', icon: 'none' });
    });
    self._recorderManager.start({ format: 'mp3', sampleRate: 16000, numberOfChannels: 1 });
  },

  stopVoiceInput: function() {
    if (this._recorderManager) { this._recorderManager.stop(); }
    this.setData({ voiceRecording: false });
  },

  uploadActivityVoice: function(filePath) {
    var self = this;
    wx.cloud.uploadFile({
      cloudPath: 'voice-temp/' + Date.now() + '.mp3',
      filePath: filePath,
      success: function(uploadRes) {
        callFunction('voice-score-parse', 'recognize', {
          fileID: uploadRes.fileID,
          activityId: self.data.activityId
        }).then(function(data) {
          self.setData({ voiceRecognizing: false, voiceShowPanel: true, voiceResult: (data.data || data).result || null });
        }).catch(function() {
          self.setData({ voiceRecognizing: false });
          wx.showToast({ title: '识别失败', icon: 'none' });
        });
      },
      fail: function() {
        self.setData({ voiceRecognizing: false });
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  closeVoicePanel: function() {
    this.setData({ voiceShowPanel: false, voiceResult: null });
  },

  confirmVoiceScore: function() {
    var self = this;
    var result = self.data.voiceResult;
    if (!result || self.data.voiceSubmitting) return;
    self.setData({ voiceSubmitting: true });
    callFunction('submit-score', 'submit', {
      matchId: result.matchId,
      team1Score: result.team1Score,
      team2Score: result.team2Score
    }).then(function() {
      self.setData({ voiceSubmitting: false, voiceShowPanel: false, voiceResult: null });
      wx.showToast({ title: '记分成功', icon: 'success' });
      self.loadGroupingData();
    }).catch(function() {
      self.setData({ voiceSubmitting: false });
      wx.showToast({ title: '提交失败', icon: 'none' });
    });
  },

  goToRanking: function() {
    wx.navigateTo({ url: '/pages/ranking/ranking?activityId=' + this.data.activityId });
  }
});
