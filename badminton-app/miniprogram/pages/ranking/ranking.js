// 排名页面逻辑
const app = getApp();
const { request } = require('../../utils/request.js');
const shareUtil = require('../../utils/share.js');

Page({
  data: {
    activityId: '',
    activity: null,
    individualRankings: [],
    teamRankings: [],
    currentTab: 'individual',
    loading: true
  },

  tabs: ['individual', 'team'],

  onShareAppMessage: function() {
    var s = shareUtil.makeShare({
      title: (this.data.activity && this.data.activity.name ? this.data.activity.name + ' · 排名' : '羽毛球排名'),
      path: '/pages/ranking/ranking',
      query: 'activityId=' + (this.data.activityId || '')
    });
    return { title: s.title, path: s.path };
  },

  onShareTimeline: function() {
    var s = shareUtil.makeShare({
      title: (this.data.activity && this.data.activity.name ? this.data.activity.name + ' · 排名' : '羽毛球排名'),
      path: '/pages/ranking/ranking',
      query: 'activityId=' + (this.data.activityId || '')
    });
    return { title: s.title, query: s.timeline.query };
  },

  onLoad: function(options) {
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      this.loadRankings();
    }
  },

  onShow: function() {
    if (this.data.activityId && !this.data.loading) {
      this.loadRankings();
    }
  },

  onUnload: function() {
    if (this._rankingWatcher) {
      this._rankingWatcher.close();
      this._rankingWatcher = null;
    }
  },

  onHide: function() {
    if (this._rankingWatcher) {
      this._rankingWatcher.close();
      this._rankingWatcher = null;
    }
  },

  // UX-26: 下拉刷新
  onPullDownRefresh: function() {
    this.loadRankings();
    wx.stopPullDownRefresh();
  },

  loadRankings: function(silent) {
    if (!silent) {
      this.setData({ loading: true });
    }

    request('get-rankings', 'rank', { activityId: this.data.activityId }).then(res => {
      if (!silent) {
        this.setData({ loading: false });
      }
      if (res.result && res.result.success && res.result.data) {
        const data = res.result.data;
        // UX-20: 导航标题带活动名
        if (data.activity && data.activity.name) {
          wx.setNavigationBarTitle({ title: '排名 - ' + data.activity.name });
        }
        const individualRankings = (data.individualRankings || []).map(p => ({
          ...p,
          rankClass: p.rank === 1 ? 'gold' : p.rank === 2 ? 'silver' : p.rank === 3 ? 'bronze' : '',
          scoreClass: p.totalScore > 0 ? 'positive' : p.totalScore < 0 ? 'negative' : ''
        }));
        const teamRankings = (data.teamRankings || []).map(t => ({
          ...t,
          rankClass: t.rank === 1 ? 'gold' : t.rank === 2 ? 'silver' : t.rank === 3 ? 'bronze' : '',
          scoreClass: t.totalScore > 0 ? 'positive' : t.totalScore < 0 ? 'negative' : ''
        }));
        // 长度与首尾 totalScore 完全一致则跳过 setData
        const isSame = (prev, next) => {
          if (prev.length !== next.length) return false;
          if (prev.length === 0) return true;
          return prev[0].totalScore === next[0].totalScore &&
            prev[prev.length - 1].totalScore === next[next.length - 1].totalScore;
        };
        if (isSame(this.data.individualRankings, individualRankings) &&
            isSame(this.data.teamRankings, teamRankings)) {
          if (!this._rankingWatcher) {
            this.watchRankings();
          }
          return;
        }
        this.setData({
          activity: data.activity || null,
          individualRankings,
          teamRankings
        });
        if (!this._rankingWatcher) {
          this.watchRankings();
        }
      } else if (!silent) {
        wx.showToast({ title: res.result?.message || '加载失败', icon: 'none' });
      }
    }).catch(err => {
      if (!silent) {
        this.setData({ loading: false });
      }
      console.error('加载排名失败：', err);
    });
  },

  watchRankings: function() {
    // BUG-64: 先关闭旧 watcher 再创建新的
    if (this._rankingWatcher) {
      this._rankingWatcher.close();
      this._rankingWatcher = null;
    }
    const db = wx.cloud.database();

    this._rankingWatcher = db.collection('scores')
      .where({
        activityId: this.data.activityId
      })
      .watch({
        onChange: res => {
          if (res.docChanges.length > 0) {
            this.loadRankings(true);
          }
        },
        onError: err => {
          console.error('监听排名失败：', err);
        }
      });
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
  },

  getRankClass: function(rank) {
    if (rank === 1) return 'gold';
    if (rank === 2) return 'silver';
    if (rank === 3) return 'bronze';
    return '';
  },

  getScoreClass: function(score) {
    if (score > 0) return 'positive';
    if (score < 0) return 'negative';
    return '';
  },

  // UX-16: 图片加载失败简单处理
  onImgError: function(e) {
    console.warn('图片加载失败', e && e.detail);
  }
});
