var callFunction = require('../../utils/request').callFunction;
var subscribe = require('../../utils/subscribe.js');
var share = require('../../utils/share.js');

var REMINDER_POLL_MS = 60000;

Page({
  data: {
    activityId: '',
    loading: true,
    matches: [],
    isEmpty: true,
    isOrganizer: false,
    activityType: '',
    draggingIndex: -1,
    dragStartY: 0,
    locked: false,
    // 比赛提醒相关
    hasReminder: false,
    reminderMessage: '',
    reminderMatchId: ''
  },

  onLoad: function(options) {
    this._firstShowDone = false;
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      // UX-02：进入赛程页申请订阅，供比赛前提醒
      subscribe.requestSubscribe('schedule');
      this.loadMatches();
    }
  },

  onShareAppMessage: function() {
    var s = share.makeShare({
      title: '羽毛球赛程',
      path: '/pages/schedule/schedule',
      query: 'activityId=' + (this.data.activityId || '')
    });
    return { title: s.title, path: s.path };
  },

  onShareTimeline: function() {
    var s = share.makeShare({
      title: '羽毛球赛程',
      path: '/pages/schedule/schedule',
      query: 'activityId=' + (this.data.activityId || '')
    });
    return { title: s.title, query: s.timeline.query };
  },

  onShow: function() {
    // PERF-17: 首次 onShow 不重复加载（onLoad 已加载）
    if (!this._firstShowDone) {
      this._firstShowDone = true;
      return;
    }
    if (this.data.activityId) this.loadMatches();
  },

  onHide: function() {
    this.stopReminderPolling();
  },

  onUnload: function() {
    this.stopReminderPolling();
  },

  onPullDownRefresh: function() {
    this.loadMatches(function() { wx.stopPullDownRefresh(); });
  },

  loadMatches: function(done) {
    var that = this;
    that.setData({ loading: true });
    callFunction('court-matches', 'list', { activityId: that.data.activityId })
      .then(function(res) {
        var data = res.data || res;
        var matches = data.matches || [];
        var statusMap = { pending: '待赛', playing: '进行中', in_progress: '进行中', finished: '已结束', confirming: '待确认' };
        matches.forEach(function(m) {
          m.statusText = statusMap[m.status] || m.status;
          m.team1Names = (m.team1 && m.team1.members) ? m.team1.members.map(function(p) { return p.nickname || '球友'; }).join('/') : '队伍';
          m.team2Names = (m.team2 && m.team2.members) ? m.team2.members.map(function(p) { return p.nickname || '球友'; }).join('/') : '队伍';
          m.scoreText = (m.team1Score != null && m.team2Score != null) ? m.team1Score + ' : ' + m.team2Score : '未录入';
        });
        that.setData({
          loading: false,
          matches: matches,
          isEmpty: matches.length === 0,
          isOrganizer: data.isOrganizer || false,
          activityType: (data.activity && data.activity.type) || '',
          locked: data.activity && (data.activity.status === 'playing' || data.activity.status === 'finished')
        });
        // 仅在活动未结束时轮询提醒；拿不到 status 时保持轮询
        if (!data.activity || data.activity.status !== 'finished') {
          that.startReminderPolling();
        } else {
          that.stopReminderPolling();
        }
        if (done) done();
      })
      .catch(function(err) {
        console.error('加载赛程失败：', err);
        that.setData({ loading: false });
        if (done) done();
      });
  },

  // ===== T15 拖拽排序 =====
  onDragStart: function(e) {
    if (this.data.locked) {
      wx.showToast({ title: '比赛已开始，无法调整顺序', icon: 'none' });
      return;
    }
    var touch = e.touches[0];
    this.setData({
      draggingIndex: e.currentTarget.dataset.index,
      dragStartY: touch.clientY
    });
  },

  onDragMove: function(e) {
    if (this.data.draggingIndex < 0) return;
    var touch = e.touches[0];
    var delta = touch.clientY - this.data.dragStartY;
    var itemHeight = 100;
    var matches = this.data.matches;
    var idx = this.data.draggingIndex;
    var moveCount = Math.round(delta / itemHeight);

    if (moveCount === 0) return;

    var newIdx = Math.max(0, Math.min(matches.length - 1, idx + moveCount));
    if (newIdx === idx) return;

    var item = matches.splice(idx, 1)[0];
    matches.splice(newIdx, 0, item);

    this.setData({
      matches: matches,
      draggingIndex: newIdx,
      dragStartY: touch.clientY
    });
  },

  onDragEnd: function(e) {
    var matches = this.data.matches;
    var idx = this.data.draggingIndex;
    this.setData({ draggingIndex: -1 });

    if (idx < 0) return;

    // 构造新的顺序，调用云函数更新
    var orderList = matches.map(function(m, i) {
      return { matchId: m._id, order: i + 1 };
    });

    wx.showLoading({ title: '更新顺序...' });
    callFunction('update-match-order', 'save', {
      activityId: this.data.activityId,
      matchOrders: orderList
    }).then(function(res) {
      wx.hideLoading();
      if (res && res.success) {
        wx.showToast({ title: '顺序已更新', icon: 'success' });
      } else {
        wx.showToast({ title: '更新失败', icon: 'none' });
      }
    }).catch(function() {
      wx.hideLoading();
      wx.showToast({ title: '更新失败', icon: 'none' });
    });
  },

  goToScore: function(e) {
    var matchId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/match-score/match-score?matchId=' + matchId + '&activityId=' + this.data.activityId });
  },

  goToDetail: function(e) {
    var matchId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/court-detail/court-detail?matchId=' + matchId + '&activityId=' + this.data.activityId });
  },

  // 保存顺序
  saveOrder: function() {
    var self = this;
    var matches = self.data.matches;
    var orderList = [];
    for (var i = 0; i < matches.length; i++) {
      orderList.push({ matchId: matches[i]._id, order: i + 1 });
    }
    wx.showLoading({ title: '保存中...' });
    callFunction('update-match-order', 'save', {
      activityId: self.data.activityId,
      matchOrders: orderList
    }).then(function(res) {
      wx.hideLoading();
      if (res && res.success) {
        wx.showToast({ title: '顺序已保存', icon: 'success' });
      } else {
        wx.showToast({ title: res.message || '保存失败', icon: 'none' });
      }
    }).catch(function() {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  // ===== 比赛提醒功能 =====
  startReminderPolling: function() {
    var that = this;
    // 按 REMINDER_POLL_MS 间隔检查比赛提醒
    if (!that._reminderTimer) {
      that._reminderTimer = setInterval(function() {
        that.checkMatchReminder();
      }, REMINDER_POLL_MS);
    }
    // 立即检查一次（含 onShow 重新进入时，不必等下一个周期）
    that.checkMatchReminder();
  },

  stopReminderPolling: function() {
    if (this._reminderTimer) {
      clearInterval(this._reminderTimer);
      this._reminderTimer = null;
    }
  },

  checkMatchReminder: function() {
    var that = this;
    if (!that.data.activityId) return;

    callFunction('match-reminders', 'get', { activityId: that.data.activityId })
      .then(function(res) {
        var hasReminder = false;
        var reminderMessage = '';
        var reminderMatchId = '';
        if (res && res.success && res.data && res.data.hasReminder) {
          var reminder = res.data.reminders[0];
          hasReminder = true;
          reminderMessage = reminder.message || '您有一场比赛即将开始';
          reminderMatchId = reminder.matchId || '';
        }
        // 三项全同则跳过 setData
        if (
          that.data.hasReminder === hasReminder &&
          that.data.reminderMessage === reminderMessage &&
          that.data.reminderMatchId === reminderMatchId
        ) {
          return;
        }
        that.setData({
          hasReminder: hasReminder,
          reminderMessage: reminderMessage,
          reminderMatchId: reminderMatchId
        });
      })
      .catch(function(err) {
        console.error('检查比赛提醒失败：', err);
      });
  },

  goToReminderMatch: function() {
    var matchId = this.data.reminderMatchId;
    if (matchId) {
      wx.navigateTo({
        url: '/pages/match-score/match-score?matchId=' + matchId + '&activityId=' + this.data.activityId
      });
    }
  },

  closeReminder: function() {
    this.setData({
      hasReminder: false,
      reminderMessage: '',
      reminderMatchId: ''
    });
  }
});
