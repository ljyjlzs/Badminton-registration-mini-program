var callFunction = require('../../utils/request').callFunction;
var subscribe = require('../../utils/subscribe.js');
var share = require('../../utils/share.js');

// UX-02：已移除 REMINDER_POLL_MS 常量与 setInterval 轮询，
// 改为事件驱动一次性检查（onLoad/onShow/wx.onAppShow 触发 checkMatchReminder）。

Page({
  data: {
    activityId: '',
    loading: true,
    loadError: false,
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
    // UX-02：回到前台时做一次性提醒检查（替代原 setInterval 轮询）
    this._appShowHandler = this.checkMatchReminder.bind(this);
    wx.onAppShow(this._appShowHandler);
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
    if (this.data.activityId) {
      // UX-02：回到页面时重新加载并一次性检查提醒（不再依赖 setInterval）
      this.loadMatches();
      this.checkMatchReminder();
    }
  },

  onHide: function() {
    // UX-02：轮询已移除，onHide 无需清理定时器
  },

  onUnload: function() {
    // UX-02：注销前台事件监听（替代原 stopReminderPolling）
    if (this._appShowHandler) {
      wx.offAppShow(this._appShowHandler);
      this._appShowHandler = null;
    }
  },

  onPullDownRefresh: function() {
    this.loadMatches(function() { wx.stopPullDownRefresh(); });
  },

  loadMatches: function(done) {
    var that = this;
    that.setData({ loading: true, loadError: false });
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
        // 仅在活动未结束时检查提醒（UX-02：改为一次性事件驱动检查，无轮询）
        if (!data.activity || data.activity.status !== 'finished') {
          that.checkMatchReminder();
        }
        if (done) done();
      })
      .catch(function(err) {
        console.error('加载赛程失败：', err);
        // BUG-46: 加载失败展示可重试错误态
        that.setData({ loading: false, loadError: true });
        if (done) done();
      });
  },

  // BUG-46: 加载失败后重新加载
  retryLoad: function() {
    this.loadMatches();
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
  // UX-02：已移除 setInterval 轮询（原 startReminderPolling/stopReminderPolling），
  // 提醒检查改为一次性事件驱动：onLoad / onShow / wx.onAppShow 各触发一次 checkMatchReminder。
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
