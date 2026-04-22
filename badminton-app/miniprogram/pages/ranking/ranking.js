// 排名页面逻辑
const app = getApp();

Page({
  data: {
    activityId: '',
    activity: null,
    individualRankings: [],
    teamRankings: [],
    currentTab: 'individual',
    loading: true,
    rankingWatcher: null
  },

  tabs: ['individual', 'team'],

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
    if (this.data.rankingWatcher) {
      this.data.rankingWatcher.close();
    }
  },

  loadRankings: function() {
    this.setData({ loading: true });
    
    wx.cloud.callFunction({
      name: 'get-rankings',
      data: {
        activityId: this.data.activityId,
        type: 'all'
      },
      success: res => {
        this.setData({ loading: false });
        
        if (res.result && res.result.success && res.result.data) {
          const data = res.result.data;
          this.setData({
            activity: data.activity || null,
            individualRankings: data.individualRankings || [],
            teamRankings: data.teamRankings || []
          });
          
          if (!this.data.rankingWatcher) {
            this.watchRankings();
          }
        } else {
          wx.showToast({
            title: res.result?.error || '加载失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        this.setData({ loading: false });
        console.error('加载排名失败：', err);
      }
    });
  },

  watchRankings: function() {
    const db = wx.cloud.database();
    
    const watcher = db.collection('scores')
      .where({
        activity_id: this.data.activityId
      })
      .watch({
        onChange: res => {
          if (res.docChanges.length > 0) {
            this.loadRankings();
          }
        },
        onError: err => {
          console.error('监听排名失败：', err);
        }
      });
    
    this.setData({ rankingWatcher: watcher });
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
  }
});
