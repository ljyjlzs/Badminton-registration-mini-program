var callFunction = require('../../utils/request').callFunction;

Page({
  data: {
    activityId: '',
    isOrganizer: false,
    courtCount: null,
    courts: [],
    unassigned: [],
    loading: true,
    loadError: false,
    configPlayersPerCourt: 4,
    editM: 4,
    showMMask: false,
    showMoveModal: false,
    moveUser: null,
    moveTargetCourtId: null,
    submitting: false
  },

  onLoad: function(options) {
    this._firstShowDone = false;
    var activityId = options.activityId || options.id || '';
    if (activityId) {
      this.setData({ activityId: activityId });
      this.loadLayout();
    }
  },

  onShow: function() {
    // PERF-17: 首次 onShow 不重复加载（onLoad 已加载）
    if (!this._firstShowDone) {
      this._firstShowDone = true;
      return;
    }
    if (this.data.activityId) this.loadLayout();
  },

  onPullDownRefresh: function() {
    this.loadLayout(function() { wx.stopPullDownRefresh(); });
  },

  loadLayout: function(done) {
    var that = this;
    // UX-10: 已有数据时静默刷新，避免从子页面返回整页白屏
    var silent = (that.data.courts && that.data.courts.length > 0) ||
      (that.data.unassigned && that.data.unassigned.length > 0);
    if (!silent) {
      that.setData({ loading: true, loadError: false });
    } else {
      that.setData({ loadError: false });
    }
    callFunction('court-list', 'get', { activityId: that.data.activityId })
      .then(function(data) {
        var d = data.data || data;
        var courts = (d.courts || []).map(function(c) {
          return Object.assign({}, c, {
            members: (c.members || []).map(function(m) {
              return Object.assign({}, m, { courtId: c.courtId });
            })
          });
        });
        that.setData({
          loading: false,
          courts: courts,
          unassigned: d.unassigned || [],
          isOrganizer: !!d.isOrganizer
        });
        if (done) done();
      })
      .catch(function(err) {
        console.error('加载场地失败：', err);
        // BUG-46: 加载失败展示可重试错误态
        that.setData({ loading: false, loadError: true });
        if (done) done();
      });
  },

  // BUG-46: 加载失败后重新加载
  retryLoad: function() {
    this.loadLayout();
  },

  onConfigPlayersPerCourtInput: function(e) {
    var v = parseInt(e.detail.value, 10);
    this.setData({ configPlayersPerCourt: isNaN(v) ? 4 : v });
  },

  stopPropagation: function() {},

  saveConfig: function() {
    var that = this;
    var ppc = that.data.configPlayersPerCourt;
    if (!ppc || ppc < 4) {
      wx.showToast({ title: '每场人数至少 4 人', icon: 'none' });
      return;
    }
    callFunction('court-config', 'config', { activityId: that.data.activityId, playersPerCourt: ppc })
      .then(function() {
        wx.showToast({ title: '场地已配置', icon: 'success' });
        that.loadLayout();
      })
      .catch(function(err) { console.error('配置场地失败：', err); });
  },

  addCourt: function() {
    var that = this;
    callFunction('court-add', 'add', { activityId: that.data.activityId })
      .then(function() {
        wx.showToast({ title: '已添加场地', icon: 'success' });
        that.loadLayout();
      })
      .catch(function(err) { console.error('添加场地失败：', err); });
  },

  deleteCourt: function(e) {
    var courtNo = e.currentTarget.dataset.courtno;
    var that = this;
    wx.showModal({
      title: '删除场地',
      content: '删除后该场地人员将回到「未分配」，确定删除？',
      success: function(res) {
        if (!res.confirm) return;
        callFunction('court-delete', 'delete', { activityId: that.data.activityId, courtNo: courtNo })
          .then(function() {
            wx.showToast({ title: '已删除', icon: 'success' });
            that.loadLayout();
          })
          .catch(function(err) { console.error('删除场地失败：', err); });
      }
    });
  },

  openChangeM: function() {
    this.setData({ showMMask: true });
  },

  closeChangeM: function() {
    this.setData({ showMMask: false });
  },

  onEditMInput: function(e) {
    var v = parseInt(e.detail.value, 10);
    this.setData({ editM: isNaN(v) ? 4 : v });
  },

  confirmChangeM: function() {
    var that = this;
    var m = that.data.editM;
    if (!m || m < 4) {
      wx.showToast({ title: '每场人数至少 4 人', icon: 'none' });
      return;
    }
    callFunction('court-config', 'config', { activityId: that.data.activityId, playersPerCourt: m })
      .then(function() {
        wx.showToast({ title: '每场人数已更新', icon: 'success' });
        that.setData({ showMMask: false });
        that.loadLayout();
      })
      .catch(function(err) { console.error('修改每场人数失败：', err); });
  },

  autoAssign: function() {
    var that = this;
    callFunction('court-assign', 'autoAssign', { activityId: that.data.activityId })
      .then(function() {
        wx.showToast({ title: '已自动分配', icon: 'success' });
        that.loadLayout();
      })
      .catch(function(err) { console.error('自动分配失败：', err); });
  },

  openMove: function(e) {
    var ds = e.currentTarget.dataset;
    this.setData({
      showMoveModal: true,
      moveUser: { userId: ds.userid, courtId: ds.courtid, nickname: ds.nickname },
      moveTargetCourtId: null
    });
  },

  openAssign: function(e) {
    var ds = e.currentTarget.dataset;
    this.setData({
      showMoveModal: true,
      moveUser: { userId: ds.userid, courtId: null, nickname: ds.nickname },
      moveTargetCourtId: null
    });
  },

  closeMove: function() {
    this.setData({ showMoveModal: false, moveUser: null });
  },

  selectMoveTarget: function(e) {
    var courtId = e.currentTarget.dataset.courtid;
    this.setData({ moveTargetCourtId: courtId });
  },

  confirmMove: function() {
    var that = this;
    var user = that.data.moveUser;
    var toCourtId = that.data.moveTargetCourtId;
    if (!user || !toCourtId) {
      wx.showToast({ title: '请选择目标场地', icon: 'none' });
      return;
    }
    callFunction('court-assign', 'move', { activityId: that.data.activityId, targetUserId: user.userId, toCourtId: toCourtId })
      .then(function() {
        wx.showToast({ title: '已移动', icon: 'success' });
        that.setData({ showMoveModal: false, moveUser: null });
        that.loadLayout();
      })
      .catch(function(err) { console.error('移动失败：', err); });
  },

  checkReady: function() {
    var that = this;
    callFunction('court-ready', 'checkReady', { activityId: that.data.activityId })
      .then(function(data) {
        var d = data.data || data;
        if (d.ready) {
          wx.showToast({ title: '已就绪，可开始分组', icon: 'success' });
        } else {
          wx.showModal({
            title: '未就绪',
            content: (d.messages || []).join('\n') || '场地分配还不满足开始条件',
            showCancel: false
          });
        }
      })
      .catch(function(err) { console.error('就绪检查失败：', err); });
  },

  startGrouping: function() {
    var that = this;
    if (that.data.submitting) return;
    wx.showModal({
      title: '确认开始分组',
      content: '分组后不能再调整场地，是否开始？',
      success: function(res) {
        if (!res.confirm) return;
        that.setData({ submitting: true });
        wx.showLoading({ title: '分组中...' });
        callFunction('court-start', 'generate', { activityId: that.data.activityId })
          .then(function() {
            wx.hideLoading();
            that.setData({ submitting: false });
            wx.showToast({ title: '分组完成', icon: 'success' });
            setTimeout(function() {
              wx.redirectTo({ url: '/pages/grouping/grouping?activityId=' + that.data.activityId });
            }, 1200);
          })
          .catch(function(err) {
            wx.hideLoading();
            that.setData({ submitting: false });
            console.error('分组失败：', err);
          });
      }
    });
  },

  onShareAppMessage: function() {
    return {
      title: '羽毛球场地分配',
      path: '/pages/court-assign/court-assign?activityId=' + this.data.activityId
    };
  },

  onShareTimeline: function() {
    return {
      title: '羽毛球场地分配',
      query: 'activityId=' + this.data.activityId
    };
  }
});
