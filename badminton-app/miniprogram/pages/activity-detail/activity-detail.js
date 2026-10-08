// 活动详情页面逻辑
var app = getApp();
var callFunction = require('../../utils/request.js').callFunction;
var timeUtil = require('../../utils/time.js');
var constants = require('../../utils/constants.js');

Page({
   data: {
     activityId: '',
     activity: null,
     activityWatcher: null,
     registrations: [],
     matches: [],
     userRegistration: null,
     isOrganizer: false,
     pendingCancelCount: 0,
     loading: true,
     loadError: false,
     showLevelPicker: false,
     showCancelModal: false,
     cancelModalItem: null,
     selectedLevel: constants.DEFAULT_LEVEL,
     inputNickname: '',
     inputAvatar: '',
     inputPartnerId: '',
     availablePartners: [],
     showCapacityModal: false,
     tempMaxPlayers: 20,
     showAgentModal: false,
     agentName: '',
     agentPhone: '',
     agentLevel: constants.DEFAULT_LEVEL,
     waitlist: [],
     agentRegistrations: [],
     globalBannerVisible: false,
     globalCurrentText: '',
     globalNextText: '',
     album: null,
     voiceEnabled: false,
     voiceConfigured: false,
     voiceRecording: false,
     voiceRecognizing: false,
     voiceShowPanel: false,
     voiceConfig: null,
     voiceResult: null,
     voiceSubmitting: false,
     showAiCopyModal: false,
     aiCopyLoading: false,
     aiCopyTab: 'announcement',
     aiCopyAnnouncement: '',
     aiCopyShare: '',
     aiCopyInvite: '',
     aiCopyText: '',
     agentPartnerId: '',
     showAgentLevelPicker: false,
     agentLevelEditId: '',
     agentLevelEditValue: constants.DEFAULT_LEVEL,
     levelDesc: constants.LEVEL_DESC,
     stopPropagation: function() {},
     submittingGroup: false,
     statusText: {
       'registering': '报名中',
       'grouping': '分组中',
       'playing': '比赛中',
       'finished': '已结束'
     }
   },

  onLoad: function(options) {
    this._firstShowDone = false;
    if (options.id) {
      this.setData({ activityId: options.id });
      this.setData({
        voiceEnabled: !!(app.globalData && app.globalData.voiceEnabled),
        voiceConfig: app.globalData && app.globalData.voiceConfig ? app.globalData.voiceConfig : null,
        voiceConfigured: !!(app.globalData && app.globalData.voiceConfig && app.globalData.voiceConfig.secretId)
      });
      this.loadActivityDetail();
    }
  },

  onShow: function() {
    // PERF-17: 首次 onShow 不重复加载（onLoad 已加载，load 回调会刷新标题）
    if (!this._firstShowDone) {
      this._firstShowDone = true;
      return;
    }
    if (this.data.activityId) {
      // UX-10: 二次进入静默刷新，避免 loading 闪烁
      this.loadActivityDetail(true);
      this._updateNavTitle();
    }
  },

  _updateNavTitle: function() {
    var name = this.data.activity && this.data.activity.name;
    wx.setNavigationBarTitle({ title: name || '活动详情' });
  },

  onUnload: function() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    this.data.activityWatcher = null;
  },

  onHide: function() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    this.data.activityWatcher = null;
  },

  // UX-26: 下拉刷新（静默刷新，避免全屏 loading 闪烁）
  onPullDownRefresh: function() {
    this.loadActivityDetail(true);
    wx.stopPullDownRefresh();
  },

  loadActivityDetail: function(silent) {
    var self = this;
    if (!silent) {
      self.setData({ loading: true, loadError: false });
    } else {
      self.setData({ loadError: false });
    }

    callFunction('get-activity-detail', 'detail', { activityId: self.data.activityId }).then(function(res) {
      if (!silent) {
        self.setData({ loading: false });
      }

      if (res.success) {
        var data = res.data;
        var activity = data.activity || {};

        if (!activity.type) activity.type = 'doubles';
        var typeLabels = { singles: '单打', doubles: '双打轮转', 'fixed-doubles': '双打固搭', 'court-doubles': '按场地双打' };
        activity.typeLabel = typeLabels[activity.type] || '双打轮转';

        activity.formattedTime = self.formatTime(activity.time);

        var openid = app.globalData && app.globalData.openid;
        var userInfo = (app.globalData && app.globalData.userInfo) || {};
        var myIds = [];
        if (openid) myIds.push(String(openid));
        if (userInfo.openid) myIds.push(String(userInfo.openid));
        if (userInfo.userId) myIds.push(String(userInfo.userId));
        if (userInfo._openid) myIds.push(String(userInfo._openid));

        var teams = data.teams || [];
        var userReg = data.userRegistration || null;

        function teamHasMe(teamId) {
          if (!teamId) return false;
          if (userReg && userReg.teamId && String(userReg.teamId) === String(teamId)) return true;
          for (var t = 0; t < teams.length; t++) {
            if (String(teams[t].id) !== String(teamId)) continue;
            var members = teams[t].members || [];
            for (var mi = 0; mi < members.length; mi++) {
              var mid = members[mi];
              if (mid && typeof mid === 'object') {
                mid = mid.userId || mid.openid || mid._openid || mid.id;
              }
              if (mid != null && myIds.indexOf(String(mid)) >= 0) return true;
            }
          }
          return false;
        }

        var matches = (data.matches || []).filter(function(m) { return m.round !== 'challenge' && m.round !== 'final'; });
        for (var k = 0; k < matches.length; k++) {
          var m = matches[k];
          m.team1DisplayName = m.team1_name || '队伍1';
          m.team2DisplayName = m.team2_name || '队伍2';
          m.team1MemberNames = m.team1_members || '';
          m.team2MemberNames = m.team2_members || '';
          m.team1AvatarText = (m.team1_members || '队').charAt(0);
          m.team2AvatarText = (m.team2_members || '队').charAt(0);
          // UX-11: 标记我的比赛
          m.isMyMatch = teamHasMe(m.team1Id) || teamHasMe(m.team2Id) || teamHasMe(m.team1_id) || teamHasMe(m.team2_id);
        }
        var hasGroupMatches = false;
        for (var i = 0; i < matches.length; i++) { if (matches[i].round === 'group') { hasGroupMatches = true; break; } }
        var allGroupFinished = hasGroupMatches;
        if (allGroupFinished) {
          for (var j = 0; j < matches.length; j++) {
            if (matches[j].round === 'group' && matches[j].status !== 'finished') { allGroupFinished = false; break; }
          }
        }

        self.setData({
          activity: activity,
          registrations: data.registrations || [],
          matches: matches,
          teams: teams,
          userRegistration: data.userRegistration || null,
          isOrganizer: data.isOrganizer || false,
          pendingCancelCount: data.pendingCancelCount || 0,
          allGroupFinished: allGroupFinished,
          waitlist: data.waitlist || [],
          tempMaxPlayers: activity.maxPlayers || 20,
          agentRegistrations: data.agentRegistrations || [],
          album: data.album || null,
          globalBannerVisible: !!(data.globalBanner && data.globalBanner.currentText),
          globalCurrentText: data.globalBanner ? (data.globalBanner.currentText || '') : '',
          globalNextText: data.globalBanner ? (data.globalBanner.nextText || '') : ''
        });
        self._updateNavTitle();

        self.loadWeather();
        var watcher = self._watcher;
        if (!watcher) {
          self.watchActivity();
        }
      } else {
        wx.showToast({ title: res.message || '加载失败', icon: 'none' });
      }
    }).catch(function(err) {
      if (!silent) {
        self.setData({ loading: false, loadError: true });
      } else {
        self.setData({ loadError: true });
      }
      console.error('加载活动详情失败：', err);
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    });
  },

  // BUG-46: 加载失败后重新加载
  retryLoad: function() {
    this.loadActivityDetail();
  },

  watchActivity: function() {
    // BUG-18: 自我增殖守卫 — 创建新监听前先关闭并清空 data.activityWatcher
    if (this.data.activityWatcher) {
      try { this.data.activityWatcher.close(); } catch (e) {}
      this.data.activityWatcher = null;
    }
    var self = this;
    if (self._watcher) {
      self._watcher.close();
      self._watcher = null;
    }
    var db = wx.cloud.database();
    var activityId = self.data.activityId;
    if (!activityId) return;

    var watcher = db.collection('activities').doc(activityId)
      .watch({
        onChange: function(res) {
          if (res.docChanges && res.docChanges.length > 0) {
            var change = res.docChanges[0];
            if (change.updatedFields) {
              var currentActivity = self.data.activity || {};
              var updatedActivity = Object.assign({}, currentActivity, change.updatedFields);
              self.setData({ activity: updatedActivity });

              if (change.updatedFields.status) {
                self.loadActivityDetail();
              }
            }
          }
        },
        onError: function(err) {
          console.error('监听失败：', err);
        }
      });
    self._watcher = watcher;
    self.data.activityWatcher = watcher;
  },

  showLevelPicker: function() {
    // 活动报名期间才能修改等级
    if (this.data.activity && this.data.activity.status !== 'registering') {
      wx.showToast({
        title: '活动已开始，无法修改等级',
        icon: 'none'
      });
      return;
    }
    var userInfo = app.globalData.userInfo || {};
    var activity = this.data.activity || {};
    var isFixedDoubles = activity.type === 'fixed-doubles';
    
    var availablePartners = isFixedDoubles ? this.getAvailablePartners() : [];
    
    this.setData({
      showLevelPicker: true,
      selectedLevel: this.data.userRegistration ? this.data.userRegistration.level : constants.DEFAULT_LEVEL,
      pickerLevel: (this.data.userRegistration ? this.data.userRegistration.level : constants.DEFAULT_LEVEL) - 1,
      inputNickname: userInfo.nickname || '',
      inputAvatar: userInfo.avatar || '',
      inputPartnerId: '',
      availablePartners: availablePartners
    });
  },

  onNicknameInput: function(e) {
    this.setData({
      inputNickname: e.detail.value
    });
  },

  onChooseJoinAvatar: function(e) {
    var avatarUrl = e.detail.avatarUrl;
    if (avatarUrl) {
      this.uploadJoinAvatar(avatarUrl);
    }
  },

  onResetJoinAvatar: function() {
    this.setData({ inputAvatar: '' });
  },

  onSelectPartner: function(e) {
    var partnerId = e.currentTarget.dataset.partnerid;
    this.setData({ inputPartnerId: partnerId });
  },

  // 不选搭档
  onSelectNoPartner: function() {
    this.setData({ inputPartnerId: '' });
  },

  // 代报选择搭档
  onSelectAgentPartner: function(e) {
    var partnerId = e.currentTarget.dataset.partnerid;
    this.setData({ agentPartnerId: partnerId });
  },

  // 获取可选择的搭档列表（已报名但还没配对的玩家，排除自己）
  getAvailablePartners: function() {
    var registrations = this.data.registrations || [];
    var openid = app.globalData.openid;
    return registrations.filter(function(r) {
      if (r.userId === openid) return false;
      if (r.partnerId) return false;
      return true;
    });
  },

  uploadJoinAvatar: function(tempFilePath) {
    var self = this;
    var activityId = self.data.activityId;
    var cloudPath = 'join_avatars/' + activityId + '/' + Date.now() + '.jpg';
    
    wx.showLoading({ title: '上传中...' });
    
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: function(res) {
        wx.hideLoading();
        console.log('头像上传成功:', res.fileID);
        self.setData({ inputAvatar: res.fileID });
      },
      fail: function(err) {
        wx.hideLoading();
        console.error('头像上传失败，使用临时路径:', err);
        self.setData({ inputAvatar: tempFilePath });
        wx.showToast({ title: '头像可能仅自己可见', icon: 'none', duration: 2000 });
      }
    });
  },

  uploadAvatarForJoin: function() {
    var self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function(res) {
        var tempFilePath = res.tempFiles[0].tempFilePath;
        self.saveJoinAvatarToCloud(tempFilePath);
      }
    });
  },

  saveJoinAvatarToCloud: function(filePath) {
    var self = this;
    var activityId = self.data.activityId;
    var cloudPath = 'join_avatars/' + activityId + '/' + Date.now() + '.jpg';
    
    wx.showLoading({ title: '上传中...' });
    
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: function(res) {
        wx.hideLoading();
        self.setData({ inputAvatar: res.fileID });
      }.bind(this),
      fail: function() {
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  hideLevelPicker: function() {
    this.setData({ showLevelPicker: false });
  },

   onLevelChange: function(e) {
     var pickerIndex = parseInt(e.detail.value[0]);
     var newLevel = pickerIndex + 1;
     console.log('picker选择:', pickerIndex, '实际等级:', newLevel);
     this.setData({
       pickerLevel: pickerIndex,
       selectedLevel: newLevel
     });
   },

   selectLevel: function(e) {
     var level = parseInt(e.currentTarget.dataset.level);
     console.log('直接选择等级:', level);
     this.setData({
       selectedLevel: level,
       pickerLevel: level - 1
     });
   },

  confirmLevel: function() {
    var self = this;
    var pickerLevel = self.data.pickerLevel;
    var level = pickerLevel + 1;
    var activityId = self.data.activityId;
    
    callFunction('update-registration-level', 'update', { activityId: activityId, level: level }).then(function(res) {
      if (res.success) {
        self.setData({
          'userRegistration.level': res.data.level,
          showLevelPicker: false
        });
        wx.showToast({ title: '等级已更新', icon: 'success' });
        self.loadActivityDetail();
      } else {
        wx.showToast({ title: res.message || '修改失败', icon: 'none' });
      }
    }).catch(function(err) {
      console.error('修改等级失败:', err);
      wx.showToast({ title: '修改失败', icon: 'none' });
    });
  },

  joinActivity: function() {
    if (!this.data.userRegistration) {
      this.showLevelPicker();
    }
  },

  doJoin: function() {
    var self = this;
    var nickname = self.data.inputNickname.trim();
    var avatar = self.data.inputAvatar;
    var level = self.data.selectedLevel;
    var activity = self.data.activity || {};
    var isFixedDoubles = activity.type === 'fixed-doubles';
    var partnerId = self.data.inputPartnerId || '';

    if (!nickname) {
      wx.showToast({ title: '请输入您的名字', icon: 'none' });
      return;
    }

    if (nickname.length < 2) {
      wx.showToast({ title: '名字至少2个字符', icon: 'none' });
      return;
    }

    // 搭档可选：不强制选搭档（与代报弹窗"可选"语义对齐）

    // UX-02：报名前申请订阅消息一次性授权（拒绝也继续报名）
    var subscribe = require('../../utils/subscribe.js');
    subscribe.requestSubscribe('join', function() {
      wx.showLoading({ title: '报名中...' });
      callFunction('join-activity', 'join', {
        activityId: self.data.activityId,
        level: level,
        nickname: nickname,
        avatar: avatar,
        partnerId: isFixedDoubles ? partnerId : undefined
      }).then(function(res) {
        wx.hideLoading();
        if (res.success) {
          if (nickname && app.globalData.userInfo) {
            app.globalData.userInfo.nickname = nickname;
          }
          callFunction('update-user-info', 'update', { nickname: nickname }).catch(function() {
            wx.showToast({ title: '昵称保存失败', icon: 'none' });
          });
          // BUG-69: 读后端 2 小时时间冲突检测结果并提示
          var joinData = res.data || {};
          if (joinData.hasConflict) {
            var conflictNames = (joinData.conflicts || []).map(function(c) { return c.name; }).filter(Boolean).join('、');
            wx.showModal({
              title: '报名成功（时间冲突）',
              content: '已报名成功。但与' + (conflictNames || '其他活动') + '时间接近（2小时内），请注意合理安排。',
              showCancel: false
            });
          } else {
            wx.showToast({ title: res.message || '报名成功', icon: 'success' });
          }
          self.hideLevelPicker();
          self.loadActivityDetail();
        } else {
        wx.showToast({ title: res.message || '报名失败', icon: 'none' });
      }
    }).catch(function(err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '报名失败', icon: 'none' });
    });
    });
  },

  startGrouping: function() {
    var self = this;
    if (self.data.submittingGroup) return;
    var activity = self.data.activity;
    var registrations = self.data.registrations;
    if (activity && activity.type === 'court-doubles') {
      wx.showModal({
        title: '生成场地赛程',
        content: '按当前场地分配生成轮转双打赛程？',
        success: function(res) {
          if (res.confirm) {
            self.setData({ submittingGroup: true });
            wx.showLoading({ title: '生成中...' });
            callFunction('court-start', 'generate', { activityId: self.data.activityId }).then(function(res) {
              wx.hideLoading();
              self.setData({ submittingGroup: false });
              if (res.success) {
                wx.showToast({ title: '已生成', icon: 'success' });
                self.loadActivityDetail();
              } else {
                wx.showToast({ title: res.message || '生成失败', icon: 'none', duration: 3000 });
              }
            }).catch(function(err) {
              wx.hideLoading();
              self.setData({ submittingGroup: false });
              console.error('生成失败:', err);
              wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none', duration: 3000 });
            });
          }
        }
      });
      return;
    }
    if (activity && activity.type !== 'singles' && registrations.length % 2 !== 0) {
      var typeLabel = activity.type === 'fixed-doubles' ? '双打固搭' : '双打';
      wx.showModal({
        title: '人数不足',
        content: typeLabel + '比赛需要偶数人数，当前' + registrations.length + '人。请增加或减少1人后再开始分组。',
        showCancel: false
      });
      return;
    }
    
    wx.showModal({
      title: '确认开始分组',
      content: '分组后不能再报名，是否继续？',
      success: function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '分组中...' });
          callFunction('start-grouping', 'apply', { activityId: self.data.activityId }).then(function(res) {
            wx.hideLoading();
            if (res.success) {
              wx.showToast({ title: '分组完成', icon: 'success' });
              self.loadActivityDetail();
            } else {
              wx.showToast({ title: res.message || '分组失败', icon: 'none', duration: 3000 });
            }
          }).catch(function(err) {
            wx.hideLoading();
            console.error('分组失败:', err);
            wx.showToast({ title: (err && err.message) || '分组失败', icon: 'none', duration: 3000 });
          });
        }
      }
    });
  },

  goToMatch: function(e) {
    var matchId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/match-score/match-score?activityId=' + this.data.activityId + '&matchId=' + matchId
    });
  },

  goToGrouping: function() {
    wx.navigateTo({
      url: '/pages/grouping/grouping?activityId=' + this.data.activityId + ''
    });
  },

  goToRanking: function() {
    wx.navigateTo({
      url: '/pages/ranking/ranking?activityId=' + this.data.activityId + ''
    });
  },

  loadWeather: function() {
    var self = this;
    var activity = self.data.activity;
    if (!activity || !activity.location) return;
    // COST-12: 30 分钟内存/Storage 缓存
    var cacheKey = 'weather_' + (self.data.activityId || '');
    try {
      var cache = wx.getStorageSync(cacheKey);
      if (cache && cache.data && (Date.now() - cache.ts < 30 * 60 * 1000)) {
        self.setData({ weather: cache.data });
        return;
      }
    } catch (e) {}
    callFunction('weather', 'get', { city: activity.location }).then(function(res) {
      if (res && res.success !== false) {
        var weatherData = (res.data && res.data.data) || res.data || {};
        if (weatherData && weatherData.weather && typeof weatherData.weather === 'object') {
          weatherData = weatherData.weather;
        }
        var weatherObj = {
          dayweather: weatherData.dayweather || weatherData.weather || '',
          nightweather: weatherData.nightweather || '',
          daytemp: weatherData.daytemp != null ? weatherData.daytemp : (weatherData.temperature != null ? weatherData.temperature : '--'),
          nighttemp: weatherData.nighttemp != null ? weatherData.nighttemp : '',
          daywind: weatherData.daywind || weatherData.windDirection || '',
          daypower: weatherData.daypower || weatherData.windPower || ''
        };
        self.setData({ weather: weatherObj });
        try {
          wx.setStorageSync(cacheKey, { ts: Date.now(), data: weatherObj });
        } catch (e) {}
      }
    }).catch(function() {});
  },

  goToPhotoAlbum: function() {
    wx.navigateTo({ url: '/pages/photo-album/photo-album?activityId=' + this.data.activityId + '' });
  },

  goToReport: function() {
    wx.navigateTo({ url: '/pages/report/report?activityId=' + this.data.activityId + '' });
  },

  goToActivityReport: function() {
    wx.navigateTo({ url: '/pages/activity-report/activity-report?activityId=' + this.data.activityId + '' });
  },

  goToRecommendTime: function() {
    wx.navigateTo({ url: '/pages/recommend-time/recommend-time?activityId=' + this.data.activityId + '' });
  },

  goToInvite: function() {
    wx.navigateTo({ url: '/pages/invite-candidates/invite-candidates?activityId=' + this.data.activityId + '' });
  },

  goToInvitePage: function() {
    wx.navigateTo({ url: '/pages/invite/invite?activityId=' + this.data.activityId + '' });
  },

  goToCourtDetail: function() {
    wx.navigateTo({
      url: '/pages/court-detail/court-detail?activityId=' + this.data.activityId + ''
    });
  },

  // ===== T5 容量调整 =====
  showCapacityModal: function() {
    this.setData({
      showCapacityModal: true,
      tempMaxPlayers: this.data.activity.maxPlayers || 20
    });
  },
  hideCapacityModal: function() {
    this.setData({ showCapacityModal: false });
  },
  onMaxPlayersInput: function(e) {
    // BUG-42: 上限 100，防止输入过大人数上限
    this.setData({ tempMaxPlayers: Math.min(100, parseInt(e.detail.value) || 20) });
  },
  submitCapacityChange: function() {
    var self = this;
    var val = Math.min(100, self.data.tempMaxPlayers);
    var current = self.data.registrations.length || 0;
    if (val < current) {
      wx.showToast({ title: '不能小于当前报名人数', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '调整中...' });
    callFunction('update-activity-status', 'update', {
      activityId: self.data.activityId,
      maxPlayers: val
    }).then(function(res) {
      wx.hideLoading();
      if (res.success) {
        wx.showToast({ title: '已调整', icon: 'success' });
        self.setData({ showCapacityModal: false });
        self.loadActivityDetail();
      } else {
        wx.showToast({ title: res.message || '调整失败', icon: 'none' });
      }
    }).catch(function() {
      wx.hideLoading();
      wx.showToast({ title: '调整失败', icon: 'none' });
    });
  },

  // ===== T8 代报名 =====
  showAgentModal: function() {
    // 打开代报弹窗时填充可选搭档列表（此前为空，代报选不到人）
    var availablePartners = (this.data.activity && this.data.activity.type === 'fixed-doubles') ? this.getAvailablePartners() : [];
    this.setData({ showAgentModal: true, agentName: '', agentPhone: '', agentLevel: constants.DEFAULT_LEVEL, agentPartnerId: '', availablePartners: availablePartners });
  },
  hideAgentModal: function() {
    this.setData({ showAgentModal: false });
  },
  onAgentNameInput: function(e) { this.setData({ agentName: e.detail.value }); },
  onAgentPhoneInput: function(e) { this.setData({ agentPhone: e.detail.value }); },
  selectAgentLevel: function(e) {
    this.setData({ agentLevel: parseInt(e.currentTarget.dataset.level) });
  },
  submitAgentRegistration: function() {
    var self = this;
    var nickname = self.data.agentName.trim();
    if (!nickname) { wx.showToast({ title: '请输入姓名', icon: 'none' }); return; }
    // UX-02：代报前同样申请订阅授权（拒绝也继续）
    var subscribe = require('../../utils/subscribe.js');
    subscribe.requestSubscribe('join', function() {
      wx.showLoading({ title: '报名中...' });
      callFunction('join-activity', 'join', {
        activityId: self.data.activityId,
        level: self.data.agentLevel,
        nickname: nickname,
        agent: true,
        agentName: nickname,
        agentPhone: self.data.agentPhone,
        partnerId: self.data.agentPartnerId || undefined
      }).then(function(res) {
        wx.hideLoading();
        if (res.success) {
          // BUG-49: 回显云函数 res.message（已区分候补/正式文案）；isWaiting 仅决定缺省文案与图标
          var isWaiting = !!(res.data && res.data.isWaiting);
          var msg = res.message || (isWaiting ? '已加入候补名单' : '代报名成功');
          wx.showToast({ title: msg, icon: isWaiting ? 'none' : 'success' });
          self.setData({ showAgentModal: false });
          self.loadActivityDetail();
        } else {
          wx.showToast({ title: res.message || '报名失败', icon: 'none' });
        }
      }).catch(function(err) {
        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || '报名失败', icon: 'none' });
      });
    });
  },

  // 帮人报名入口（别名）
  openAgentModal: function() {
    this.showAgentModal();
  },

  // 取消候补
  cancelWaitlist: function() {
    var self = this;
    wx.showModal({
      title: '取消候补',
      content: '确定取消候补吗？取消后需要重新报名。',
      success: function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '取消中...' });
          callFunction('cancel-registration', 'cancel', { activityId: self.data.activityId }).then(function(res) {
            wx.hideLoading();
            if (res.success) {
              wx.showToast({ title: '已取消候补', icon: 'success' });
              self.loadActivityDetail();
            } else {
              wx.showToast({ title: res.message || '取消失败', icon: 'none' });
            }
          }).catch(function() {
            wx.hideLoading();
            wx.showToast({ title: '取消失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 解绑搭档
  unbindPartner: function() {
    var self = this;
    wx.showModal({
      title: '解绑搭档',
      content: '确定解绑搭档吗？解绑后双方都需要重新选择搭档。',
      success: function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '解绑中...' });
          callFunction('unbind-partner', 'unbind', {
            registrationId: self.data.userRegistration.id
          }).then(function(res) {
            wx.hideLoading();
            if (res.success) {
              wx.showToast({ title: '已解绑', icon: 'success' });
              self.loadActivityDetail();
            } else {
              wx.showToast({ title: res.message || '解绑失败', icon: 'none' });
            }
          }).catch(function() {
            wx.hideLoading();
            wx.showToast({ title: '解绑失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 代报人修改等级
  showAgentLevelPicker: function(e) {
    var regId = e.currentTarget.dataset.id;
    var list = this.data.agentRegistrations || [];
    var currentLevel = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === regId && list[i].level != null) {
        currentLevel = list[i].level;
        break;
      }
    }
    if (currentLevel == null && this.data.userRegistration && this.data.userRegistration.level) {
      currentLevel = this.data.userRegistration.level;
    }
    this.setData({ showAgentLevelPicker: true, agentLevelEditId: regId, agentLevelEditValue: currentLevel });
  },

  hideAgentLevelPicker: function() {
    this.setData({ showAgentLevelPicker: false });
  },

  selectAgentEditLevel: function(e) {
    this.setData({ agentLevelEditValue: parseInt(e.currentTarget.dataset.level) });
  },

  confirmAgentLevelEdit: function() {
    var self = this;
    var regId = self.data.agentLevelEditId;
    var level = self.data.agentLevelEditValue;
    if (!regId) return;
    wx.showLoading({ title: '修改中...' });
    callFunction('update-registration-level', 'update', {
      activityId: self.data.activityId,
      registrationId: regId,
      level: level
    }).then(function(res) {
      wx.hideLoading();
      if (res && res.success) {
        wx.showToast({ title: '已修改', icon: 'success' });
        self.setData({ showAgentLevelPicker: false });
        self.loadActivityDetail();
      } else {
        wx.showToast({ title: res.message || '修改失败', icon: 'none' });
      }
    }).catch(function() {
      wx.hideLoading();
      wx.showToast({ title: '修改失败', icon: 'none' });
    });
  },

  // 取消代报
  cancelAgentRegistration: function(e) {
    var self = this;
    var regId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '取消代报',
      content: '确定取消该代报吗？',
      success: function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '取消中...' });
          callFunction('cancel-registration', 'cancel', {
            activityId: self.data.activityId,
            registrationId: regId
          }).then(function(res) {
            wx.hideLoading();
            if (res.success) {
              wx.showToast({ title: '已取消', icon: 'success' });
              self.loadActivityDetail();
            } else {
              wx.showToast({ title: res.message || '取消失败', icon: 'none' });
            }
          }).catch(function() {
            wx.hideLoading();
            wx.showToast({ title: '取消失败', icon: 'none' });
          });
        }
      }
    });
  },

  // AI 文案弹窗
  openAiCopy: function() {
    var self = this;
    self.setData({ showAiCopyModal: true, aiCopyLoading: true, aiCopyTab: 'announcement' });
    callFunction('generate-copy', 'generate', { activityId: self.data.activityId }).then(function(res) {
      if (res && res.success !== false) {
        var data = res.data || res;
        var copy = data.copy || data;
        self.setData({
          aiCopyLoading: false,
          aiCopyAnnouncement: copy.announcement || '',
          aiCopyShare: copy.share || '',
          aiCopyInvite: copy.invite || '',
          aiCopyText: copy.announcement || ''
        });
      } else {
        self.setData({ aiCopyLoading: false });
        wx.showToast({ title: '生成失败', icon: 'none' });
      }
    }).catch(function() {
      self.setData({ aiCopyLoading: false });
      wx.showToast({ title: '生成失败', icon: 'none' });
    });
  },

  switchCopyTab: function(e) {
    var tab = e.currentTarget.dataset.tab;
    var text = '';
    if (tab === 'announcement') text = this.data.aiCopyAnnouncement;
    else if (tab === 'share') text = this.data.aiCopyShare;
    else if (tab === 'invite') text = this.data.aiCopyInvite;
    this.setData({ aiCopyTab: tab, aiCopyText: text });
  },

  copyCopyText: function() {
    var text = this.data.aiCopyText;
    if (text) {
      wx.setClipboardData({ data: text, success: function() { wx.showToast({ title: '已复制', icon: 'success' }); } });
    }
  },

  regenerateCopy: function() {
    this.openAiCopy();
  },

  closeAiCopy: function() {
    this.setData({ showAiCopyModal: false });
  },

  // 天气刷新
  refreshWeather: function() {
    this.loadWeather();
  },

  // ===== T9 AI 导航 =====
  goToGroupingPreview: function() {
    wx.navigateTo({ url: '/pages/grouping-preview/grouping-preview?activityId=' + this.data.activityId + '' });
  },
  goToFillSuggestion: function() {
    wx.navigateTo({ url: '/pages/fill-suggestion/fill-suggestion?activityId=' + this.data.activityId + '' });
  },
  goToCourtAssign: function() {
    wx.navigateTo({ url: '/pages/court-assign/court-assign?activityId=' + this.data.activityId + '' });
  },
  goToAiNotePreview: function() {
    wx.navigateTo({ url: '/pages/ai-note-preview/ai-note-preview?activityId=' + this.data.activityId + '' });
  },

  // ===== T10 赛程入口 =====
  goToSchedule: function() {
    wx.navigateTo({ url: '/pages/schedule/schedule?activityId=' + this.data.activityId + '' });
  },

  // ===== T48 语音填分 =====
  startVoiceInput: function() {
    var that = this;
    if (!that.data.voiceConfigured) {
      wx.showToast({ title: '语音识别未配置', icon: 'none' });
      return;
    }
    that.setData({ voiceRecording: true, voiceRecognizing: false });
    var recorderManager = wx.getRecorderManager();
    that._recorderManager = recorderManager;
    that._recorderManager.onStop(function(res) {
      if (res.tempFilePath) {
        that.setData({ voiceRecognizing: true });
        that.recognizeVoice(res.tempFilePath);
      }
    });
    that._recorderManager.onError(function() {
      that.setData({ voiceRecording: false });
      wx.showToast({ title: '录音失败', icon: 'none' });
    });
    that._recorderManager.start({ format: 'mp3', sampleRate: 16000, numberOfChannels: 1 });
  },

  stopVoiceInput: function() {
    if (this._recorderManager) { this._recorderManager.stop(); }
    this.setData({ voiceRecording: false });
  },

  recognizeVoice: function(filePath) {
    var that = this;
    wx.cloud.uploadFile({
      cloudPath: 'voice-temp/' + Date.now() + '.mp3',
      filePath: filePath,
      success: function(uploadRes) {
        callFunction('voice-score-parse', 'recognize', {
          fileID: uploadRes.fileID,
          activityId: that.data.activityId
        }).then(function(data) {
          // AI-31: callFunction 返回信封 {success,data,message}，result 在 data.data 里
          var payload = data.data || {};
          var raw = payload.result || payload.scores || null;
          // 归一化为面板/提交需要的结构 {matchId, matchOrder, team1Score, team2Score}
          var voiceResult = null;
          if (raw && raw.length) {
            var first = raw[0];
            voiceResult = {
              matchId: first.matchId || '',
              matchOrder: first.matchOrder || 1,
              team1Score: first.team1Score != null ? first.team1Score : first.scoreA,
              team2Score: first.team2Score != null ? first.team2Score : first.scoreB
            };
          } else if (raw && raw.matchId) {
            voiceResult = raw;
          }
          that.setData({ voiceRecognizing: false, voiceShowPanel: true, voiceResult: voiceResult });
        }).catch(function() {
          that.setData({ voiceRecognizing: false });
          wx.showToast({ title: '识别失败，请手动输入', icon: 'none' });
        });
      },
      fail: function() {
        that.setData({ voiceRecognizing: false });
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  cancelVoiceResult: function() {
    this.setData({ voiceShowPanel: false, voiceResult: null });
  },

  confirmVoiceResult: function() {
    var that = this;
    var result = that.data.voiceResult;
    if (!result || that.data.voiceSubmitting) return;
    that.setData({ voiceSubmitting: true });
    callFunction('submit-score', 'submit', {
      matchId: result.matchId,
      team1Score: result.team1Score,
      team2Score: result.team2Score
    }).then(function(res) {
      // AI-31: 校验 success，避免失败也提示记分成功
      if (!res || res.success === false) {
        throw new Error((res && res.message) || '提交失败');
      }
      that.setData({ voiceSubmitting: false, voiceShowPanel: false, voiceResult: null });
      wx.showToast({ title: '记分成功', icon: 'success' });
      that.loadActivityDetail();
    }).catch(function() {
      that.setData({ voiceSubmitting: false });
      wx.showToast({ title: '提交失败', icon: 'none' });
    });
  },

  onGlobalBannerTap: function() {},

  // UX-22: 解析活动时间戳（ENG-04：抽到 utils/time.js，此处保留方法名兼容调用方）
  parseActivityTimestamp: function(timeValue) {
    return timeUtil.parseTime(timeValue);
  },

  // UX-22: 加入系统日历
  addCalendar: function() {
    var activity = this.data.activity || {};
    var ts = this.parseActivityTimestamp(activity.time);
    if (!ts) {
      wx.showToast({ title: '活动时间未确定', icon: 'none' });
      return;
    }
    var startSec = Math.floor(ts / 1000);
    var endSec = startSec + 2 * 3600;
    wx.addPhoneCalendar({
      title: activity.name || '羽毛球活动',
      startTime: startSec,
      endTime: endSec,
      location: activity.location || '',
      alarm: true,
      alarmOffset: 3600,
      success: function() {
        wx.showToast({ title: '已加入日历', icon: 'success' });
      },
      fail: function() {
        wx.showToast({ title: '请在系统日历中手动添加', icon: 'none' });
      }
    });
  },

  formatTime: function(timeValue) {
    return timeUtil.formatTime(timeValue, '待定');
  },

  onShareAppMessage: function() {
    var a = this.data.activity || {};
    var left = Math.max((a.maxPlayers || 0) - (a.currentPlayers || 0), 0);
    var t = (a.name || '羽毛球活动') + '｜' + (a.formattedTime || a.time || '') + ' 还剩' + left + '个名额';
    return { title: t.slice(0, 32), path: '/pages/activity-detail/activity-detail?id=' + this.data.activityId };
  },

  onShareTimeline: function() {
    var a = this.data.activity || {};
    var left = Math.max((a.maxPlayers || 0) - (a.currentPlayers || 0), 0);
    var t = (a.name || '羽毛球活动') + '｜' + (a.formattedTime || a.time || '') + ' 还剩' + left + '个名额';
    return {
      title: t.slice(0, 32),
      query: 'id=' + (this.data.activityId || '')
    };
  },

  deleteActivity: function() {
    var self = this;
    var activityId = self.data.activityId;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除此活动吗？此操作不可恢复。',
      success: function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          callFunction('delete-activity', 'delete', { activityId: activityId }).then(function(res) {
            wx.hideLoading();
            if (res.success) {
              wx.showToast({ title: '删除成功', icon: 'success' });
              setTimeout(function() { wx.navigateBack(); }, 1500);
            } else {
              wx.showToast({ title: res.message || '删除失败', icon: 'none' });
            }
          }).catch(function(err) {
            wx.hideLoading();
            console.error('删除云函数调用失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none', duration: 3000 });
          });
        }
      }
    });
  },

  finishActivity: function() {
    var self = this;
    var activityId = self.data.activityId;
    
    wx.showModal({
      title: '结束活动',
      content: '确定要结束此活动吗？结束后可查看排名',
      success: function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '结束中...' });
          callFunction('update-activity-status', 'update', { activityId: activityId, status: 'finished' }).then(function(res) {
            wx.hideLoading();
            if (res.success) {
              wx.showToast({ title: '活动已结束', icon: 'success' });
              self.loadActivityDetail();
            } else {
              wx.showToast({ title: res.message || '操作失败', icon: 'none' });
            }
          }).catch(function() {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
        }
      }
    });
  },

  cancelRegistration: function() {
    var self = this;
    
    wx.showModal({
      title: '确认取消报名',
      content: '取消报名需要组织者确认后才会生效，确定要申请取消吗？',
      success: function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '提交中...' });
          callFunction('cancel-registration', 'cancel', { activityId: self.data.activityId }).then(function(res) {
            wx.hideLoading();
            if (res.success) {
              wx.showToast({ title: '已提交取消申请', icon: 'success' });
              self.loadActivityDetail();
            } else {
              wx.showToast({ title: res.message || '操作失败', icon: 'none' });
            }
          }).catch(function() {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
        }
      }
    });
  },

  onRegItemTap: function(e) {
    var item = e.currentTarget.dataset.item;
    if (!item || item.cancelStatus !== 'pending' || !this.data.isOrganizer) return;

    this.setData({
      showCancelModal: true,
      cancelModalItem: item
    });
  },

  hideCancelModal: function() {
    this.setData({ showCancelModal: false, cancelModalItem: null });
  },

  handleCancelFromModal: function(e) {
    var self = this;
    var action = e.currentTarget.dataset.action;
    var item = self.data.cancelModalItem;
    if (!item) return;

    self.setData({ showCancelModal: false, cancelModalItem: null });

    wx.showLoading({ title: '处理中...' });
    callFunction('handle-cancel-request', 'approve', { registrationId: item.id, decision: action }).then(function(res) {
      wx.hideLoading();
      if (res.success) {
        wx.showToast({ title: res.message || '处理成功', icon: 'success' });
        self.loadActivityDetail();
      } else {
        wx.showToast({ title: res.message || '操作失败', icon: 'none' });
      }
    }).catch(function() {
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  copyLocation: function(e) {
    var activity = this.data.activity;
    if (activity && activity.latitude && activity.longitude) {
      wx.openLocation({
        latitude: activity.latitude,
        longitude: activity.longitude,
        name: activity.name,
        address: activity.location,
        scale: 18
      });
    } else {
      var location = e.currentTarget.dataset.location;
      if (location) {
        wx.setClipboardData({
          data: location,
          success: function() {
            wx.showToast({
              title: '地点已复制',
              icon: 'success'
            });
          }
        });
      }
    }
  },

  // UX-16: 图片加载失败兜底 — 回退到占位（上传按钮/首字母）
  onImgError: function(e) {
    console.warn('图片加载失败', e && e.detail);
    var ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (ds.imgKey === 'inputAvatar' && this.data.inputAvatar) {
      this.setData({ inputAvatar: '' });
    }
  }
});
