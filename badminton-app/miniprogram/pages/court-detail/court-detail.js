// 场地双打详情页逻辑
const app = getApp();
const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    activityId: '',
    activity: null,
    isOrganizer: false,
    loading: true,
    tab: 'matches',
    courts: [],
    rankings: null,
    scoreInputs: {},
    generating: false
  },

  onLoad: function (options) {
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      this.loadActivity();
      this.loadMatches();
    }
  },

  onShow: function () {
    if (this.data.activityId) this.loadMatches();
  },

  loadActivity: function () {
    callFunction('get-activity-detail', 'detail', { activityId: this.data.activityId }).then(res => {
      if (res.success) {
        const act = (res.data.activity) || {};
        this.setData({ activity: act, isOrganizer: res.data.isOrganizer || false });
      }
    }).catch(() => {});
  },

  loadMatches: function () {
    this.setData({ loading: true });
    callFunction('court-matches', 'list', { activityId: this.data.activityId }).then(res => {
      this.setData({ loading: false });
      if (res.success) {
        const matches = res.data.matches || [];
        const byCourt = {};
        matches.forEach(m => {
          const c = m.court || '场地';
          (byCourt[c] = byCourt[c] || []).push(m);
        });
        const courts = Object.keys(byCourt).map(c => ({ court: c, matches: byCourt[c] }));
        this.setData({ courts });
      } else {
        wx.showToast({ title: res.message || '加载失败', icon: 'none' });
      }
    }).catch(() => { this.setData({ loading: false }); });
  },

  generate: function () {
    if (!this.data.isOrganizer) { wx.showToast({ title: '仅组织者可操作', icon: 'none' }); return; }
    wx.showModal({
      title: '生成赛程',
      content: '按当前场地分配生成轮转双打赛程？',
      success: res => {
        if (res.confirm) {
          this.setData({ generating: true });
          callFunction('court-start', 'generate', { activityId: this.data.activityId }).then(res => {
            this.setData({ generating: false });
            if (res.success) { wx.showToast({ title: '已生成', icon: 'success' }); this.loadMatches(); }
            else wx.showToast({ title: res.message || '失败', icon: 'none', duration: 3000 });
          }).catch(() => { this.setData({ generating: false }); wx.showToast({ title: '失败', icon: 'none' }); });
        }
      }
    });
  },

  switchTab: function (e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
    // 切到排名 tab 时无条件刷新，避免展示过期排名
    if (tab === 'ranking') this.loadRankings();
  },

  loadRankings: function () {
    callFunction('court-rank', 'rank', { activityId: this.data.activityId }).then(res => {
      if (res.success) this.setData({ rankings: res.data });
    }).catch(() => {});
  },

  onScoreInput: function (e) {
    const matchid = e.currentTarget.dataset.matchid;
    const side = e.currentTarget.dataset.side;
    const val = parseInt(e.detail.value) || 0;
    this.setData({ ['scoreInputs.' + matchid + '_' + side]: val });
  },

  submitScore: function (e) {
    const matchId = e.currentTarget.dataset.matchid;
    const action = e.currentTarget.dataset.action || 'submit';
    const inp = this.data.scoreInputs;
    const t1 = inp[matchId + '_t1'] || 0;
    const t2 = inp[matchId + '_t2'] || 0;
    if (t1 === t2) { wx.showToast({ title: '比分不能相同', icon: 'none' }); return; }
    wx.showLoading({ title: action === 'modify' ? '修改中' : '提交中' });
    callFunction('court-submit-score', action, { matchId: matchId, team1Score: t1, team2Score: t2 }).then(res => {
      wx.hideLoading();
      if (res.success) {
        wx.showToast({ title: action === 'modify' ? '已修改' : '已提交', icon: 'success' });
        this.loadMatches();
        if (this.data.tab === 'ranking') this.loadRankings();
      } else {
        wx.showToast({ title: res.message || '失败', icon: 'none' });
      }
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '失败', icon: 'none' }); });
  },

  goBack: function () { wx.navigateBack(); }
});
