// 挑战赛页面
const app = getApp();

Page({
  data: {
    activityId: '',
    qualifiedTeams: [],
    eliminatedPlayers: [],
    challengeMatch: null,
    loading: true,
    isOrganizer: false
  },

  onLoad: function(options) {
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      this.loadChallengeData();
    }
  },

  loadChallengeData: function() {
    this.setData({ loading: true });
    
    wx.cloud.callFunction({
      name: 'get-challenge-data',
      data: {
        activityId: this.data.activityId
      },
      success: res => {
        this.setData({ loading: false });
        
        if (res.result && res.result.success && res.result.data) {
          const data = res.result.data;
          this.setData({
            qualifiedTeams: data.qualifiedTeams || [],
            eliminatedPlayers: data.eliminatedPlayers || [],
            challengeMatch: data.challengeMatch || null,
            isOrganizer: data.isOrganizer || false
          });
        }
      },
      fail: err => {
        this.setData({ loading: false });
        console.error('加载挑战赛数据失败：', err);
      }
    });
  },

  formChallengeTeam: function(e) {
    const playerId = e.currentTarget.dataset.playerid;
    const selectedPlayer = this.data.eliminatedPlayers.find(p => p.userId === playerId);
    
    if (!this.selectedPartner) {
      this.selectedPartner = selectedPlayer;
      this.setData({ selectedPartner: this.selectedPartner });
      wx.showToast({
        title: '请选择搭档',
        icon: 'none'
      });
    } else {
      // 创建挑战队
      this.createChallengeTeam(this.selectedPartner.userId, playerId);
    }
  },

  createChallengeTeam: function(player1Id, player2Id) {
    wx.cloud.callFunction({
      name: 'create-challenge-team',
      data: {
        activityId: this.data.activityId,
        player1Id,
        player2Id
      },
      success: res => {
        if (res.result.success) {
          wx.showToast({
            title: '挑战队已创建',
            icon: 'success'
          });
          this.loadChallengeData();
        }
      }
    });
  },

  startChallenge: function() {
    if (!this.data.challengeMatch) {
      wx.showToast({
        title: '请先组建挑战队',
        icon: 'none'
      });
      return;
    }
    
    wx.navigateTo({
      url: `/pages/match-score/match-score?activityId=${this.data.activityId}&matchId=${this.data.challengeMatch._id}`
    });
  }
});
