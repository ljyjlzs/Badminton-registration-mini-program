Page({
  data: {
    activityId: '',
    activity: null,
    teams: [],
    matches: [],
    loading: true,
    isOrganizer: false,
    namingTeamId: null,
    teamName: '',
    completedCount: 0
  },

  stopPropagation: function() {},

  onLoad: function(options) {
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      this.loadGroupingData();
    }
  },

  loadGroupingData: function() {
    this.setData({ loading: true });
    const app = getApp();
    
    wx.cloud.callFunction({
      name: 'get-activity-detail',
      data: {
        activityId: this.data.activityId
      },
      success: res => {
        this.setData({ loading: false });
        
        if (res.result && res.result.success && res.result.data) {
          const data = res.result.data;
          const app = getApp();
          const matches = data.matches || [];
          const completedCount = matches.filter(m => m.status === 'confirmed').length;
          this.setData({
            activity: data.activity || null,
            teams: data.teams || [],
            matches: matches,
            completedCount: completedCount,
            isOrganizer: data.activity && data.activity.organizer_id === app.globalData.openid
          });
        }
      },
      fail: err => {
        this.setData({ loading: false });
        console.error('加载分组数据失败：', err);
      }
    });
  },

  startNaming: function(e) {
    const teamId = e.currentTarget.dataset.teamid;
    this.setData({
      namingTeamId: teamId,
      teamName: ''
    });
  },

  onTeamNameInput: function(e) {
    this.setData({
      teamName: e.detail.value
    });
  },

  confirmTeamName: function() {
    if (!this.data.teamName.trim()) {
      wx.showToast({
        title: '请输入队名',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    
    wx.cloud.callFunction({
      name: 'set-team-name',
      data: {
        activityId: this.data.activityId,
        teamId: this.data.namingTeamId,
        name: this.data.teamName.trim()
      },
      success: res => {
        wx.hideLoading();
        if (res.result.success) {
          wx.showToast({
            title: '命名成功',
            icon: 'success'
          });
          this.setData({ namingTeamId: null });
          this.loadGroupingData();
        } else {
          wx.showToast({
            title: res.result.error || '命名失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        wx.hideLoading();
        wx.showToast({
          title: '命名失败',
          icon: 'none'
        });
      }
    });
  },

  cancelNaming: function() {
    this.setData({
      namingTeamId: null,
      teamName: ''
    });
  },

  goToMatchScore: function(e) {
    const matchId = e.currentTarget.dataset.matchid;
    wx.navigateTo({
      url: `/pages/match-score/match-score?activityId=${this.data.activityId}&matchId=${matchId}`
    });
  },

  startAllMatches: function() {
    const matches = this.data.matches;
    const pendingMatches = matches.filter(m => m.status === 'pending');
    
    if (pendingMatches.length === 0) {
      wx.showToast({ title: '没有待开始的比赛', icon: 'none' });
      return;
    }
    
    wx.showModal({
      title: '开始比赛',
      content: `确定开始 ${pendingMatches.length} 场比赛吗？`,
      success: res => {
        if (res.confirm) {
          this.doStartAllMatches(pendingMatches);
        }
      }
    });
  },

  doStartAllMatches: async function(matches) {
    wx.showLoading({ title: '开始中...' });
    
    let successCount = 0;
    let failCount = 0;
    
    for (const match of matches) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'start-match',
          data: {
            activityId: this.data.activityId,
            matchId: match._id
          }
        });
        
        if (res.result && res.result.success) {
          successCount++;
        } else {
          failCount++;
          console.error('开始比赛失败:', res.result?.error);
        }
      } catch (e) {
        failCount++;
        console.error('开始比赛失败:', e);
      }
    }
    
    wx.hideLoading();
    
    if (failCount === 0) {
      // 更新活动状态为比赛中
      wx.cloud.callFunction({
        name: 'update-activity-status',
        data: {
          activityId: this.data.activityId,
          status: 'playing'
        },
        success: res => {
          console.log('更新状态结果:', res.result);
          wx.showToast({ title: '比赛已开始', icon: 'success' });
          this.loadGroupingData();
        },
        fail: err => {
          console.log('更新状态失败:', err);
          wx.showToast({ title: '比赛已开始', icon: 'success' });
          this.loadGroupingData();
        }
      });
    } else {
      wx.showToast({ title: `${successCount}场成功，${failCount}场失败`, icon: 'none' });
    }
  },

  goToRanking: function() {
    wx.navigateTo({
      url: `/pages/ranking/ranking?activityId=${this.data.activityId}`
    });
  },

  onShow: function() {
    if (this.data.activityId) {
      this.loadGroupingData();
    }
  }
});
