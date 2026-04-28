// 记分页面逻辑
const app = getApp();

Page({
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
    confirming: false,
    scoreRange: ['0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30']
  },

  onLoad: function(options) {
    if (options.activityId && options.matchId) {
      this.setData({
        activityId: options.activityId,
        matchId: options.matchId
      });
      this.loadMatchDetail();
    }
  },

  onShow: function() {
    if (this.data.matchId) {
      this.loadMatchDetail();
    }
  },

  loadMatchDetail: function() {
    this.setData({ loading: true });
    
    const openid = app.globalData.openid;
    
    wx.cloud.callFunction({
      name: 'get-match-detail',
      data: {
        activityId: this.data.activityId,
        matchId: this.data.matchId,
        openid: openid
      },
      success: res => {
        this.setData({ loading: false });
        
        if (res.result.success) {
          const data = res.result.data;
          this.setData({
            match: data.match,
            team1: data.team1,
            team2: data.team2,
            team1Score: data.match.team1_score || 0,
            team2Score: data.match.team2_score || 0,
            isOrganizer: data.isOrganizer,
            isScorer: data.isScorer,
            userTeam: data.userTeam
          });
        } else {
          wx.showToast({
            title: res.result.error || '加载失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        this.setData({ loading: false });
        console.error('加载比赛详情失败：', err);
      }
    });
  },

  onTeam1ScoreChange: function(e) {
    const scoreRange = this.data.scoreRange;
    this.setData({
      team1Score: parseInt(scoreRange[e.detail.value])
    });
  },

  onTeam2ScoreChange: function(e) {
    const scoreRange = this.data.scoreRange;
    this.setData({
      team2Score: parseInt(scoreRange[e.detail.value])
    });
  },

  onTeam1ScoreInput: function(e) {
    let val = parseInt(e.detail.value) || 0;
    if (val > 30) val = 30;
    if (val < 0) val = 0;
    this.setData({ team1Score: val });
  },

  onTeam2ScoreInput: function(e) {
    let val = parseInt(e.detail.value) || 0;
    if (val > 30) val = 30;
    if (val < 0) val = 0;
    this.setData({ team2Score: val });
  },

  submitScore: function() {
    if (!this.data.isOrganizer && !this.data.isScorer) {
      wx.showToast({
        title: '您没有记分权限',
        icon: 'none'
      });
      return;
    }
    
    const { team1Score, team2Score } = this.data;
    
    if (team1Score === team2Score) {
      wx.showToast({
        title: '比分不能相同',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认比分',
      content: `${this.data.team1.name || '队伍1'}: ${team1Score} vs ${this.data.team2.name || '队伍2'}: ${team2Score}`,
      success: res => {
        if (res.confirm) {
          this.doSubmitScore();
        }
      }
    });
  },

  doSubmitScore: function() {
    this.setData({ confirming: true });
    
    wx.cloud.callFunction({
      name: 'submit-score',
      data: {
        activityId: this.data.activityId,
        matchId: this.data.matchId,
        team1Score: this.data.team1Score,
        team2Score: this.data.team2Score
      },
      success: res => {
        this.setData({ confirming: false });
        
        if (res.result.success) {
          wx.showToast({
            title: '比分已提交',
            icon: 'success'
          });
          this.loadMatchDetail();
        } else {
          wx.showToast({
            title: res.result.error || '提交失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        this.setData({ confirming: false });
        console.error('提交比分失败：', err);
        wx.showToast({
          title: '提交失败',
          icon: 'none'
        });
      }
    });
  },

  modifyScore: function() {
    wx.showModal({
      title: '修改比分',
      content: '确定要修改已提交的比分吗？修改后需重新输入并提交。',
      confirmText: '确定修改',
      cancelText: '取消',
      success: res => {
        if (res.confirm) {
          // 重置比分输入，重新加载让用户输入新比分
          this.setData({ 
            team1Score: 0, 
            team2Score: 0 
          });
          // 重新加载比赛详情，submit-score 云函数会处理已确认比赛的修改
          this.loadMatchDetail();
        }
      }
    });
  },

  goBack: function() {
    wx.navigateBack();
  }
});
