// 活动详情页面逻辑
const app = getApp();

Page({
   data: {
     activityId: '',
     activity: null,
     registrations: [],
     matches: [],
     userRegistration: null,
     isOrganizer: false,
     loading: true,
     showLevelPicker: false,
     selectedLevel: 5,
    inputNickname: '',
    inputAvatar: '',
    inputPartnerId: '',
    availablePartners: [],
     levelDesc: ['萌新·娱乐场', '新手·养生球', '新手·进阶', '初学者提高', '熟手·小对抗', '中级爱好者', '中高级玩家', '高级爱好者', '高手·大对抗', '专业水平'],

   stopPropagation: function() {},
     statusText: {
       'registering': '报名中',
       'grouping': '分组中',
       'playing': '比赛中',
       'challenge': '挑战赛',
       'final': '决赛',
       'finished': '已结束'
     }
   },

  onLoad: function(options) {
    if (options.id) {
      this.setData({ activityId: options.id });
      this.loadActivityDetail();
    }
  },

  onShow: function() {
    if (this.data.activityId) {
      this.loadActivityDetail();
    }
  },

  loadActivityDetail: function() {
    this.setData({ loading: true });
    
    const openid = app.globalData.openid;
    
    wx.cloud.callFunction({
      name: 'get-activity-detail',
      data: {
        activityId: this.data.activityId,
        openid: openid
      },
      success: res => {
        this.setData({ loading: false });
        
        if (res.result && res.result.success) {
          const data = res.result.data;
          const activity = data.activity || {};
          
          if (!activity.type || (activity.type !== 'singles' && activity.type !== 'doubles' && activity.type !== 'fixed-doubles')) {
            activity.type = 'doubles';
          }
          
          const ts = activity.time;
          let formattedTime = '待定';
          if (ts && typeof ts === 'number') {
            const d = new Date(ts);
            formattedTime = `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
          }
          activity.formattedTime = formattedTime;
          
          const matches = data.matches || [];
          const hasGroupMatches = matches.some(m => m.round === 'group');
          const hasChallengeMatches = matches.some(m => m.round === 'challenge');
          const hasFinalMatches = matches.some(m => m.round === 'final');
          const allGroupFinished = hasGroupMatches && matches.filter(m => m.round === 'group').every(m => m.status === 'confirmed');
          const allChallengeFinished = hasChallengeMatches && matches.filter(m => m.round === 'challenge').every(m => m.status === 'confirmed');
          
          this.setData({
            activity: activity,
            registrations: data.registrations || [],
            matches: matches,
            userRegistration: data.userRegistration || null,
            isOrganizer: data.isOrganizer || false,
            hasChallengeMatches: hasChallengeMatches,
            hasFinalMatches: hasFinalMatches,
            allGroupFinished: allGroupFinished,
            allChallengeFinished: allChallengeFinished
          });
          
          this.watchActivity();
        } else {
          wx.showToast({
            title: (res.result && res.result.error) || '加载失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        this.setData({ loading: false });
        console.error('加载活动详情失败：', err);
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        });
      }
    });
  },

  watchActivity: function() {
    const db = wx.cloud.database();
    const activityId = this.data.activityId;
    if (!activityId) return;
    
    db.collection('activities').doc(activityId)
      .watch({
        onChange: res => {
          if (res.docChanges && res.docChanges.length > 0) {
            const change = res.docChanges[0];
            if (change.updatedFields) {
              const currentActivity = this.data.activity || {};
              const updatedActivity = Object.assign({}, currentActivity, change.updatedFields);
              this.setData({ activity: updatedActivity });
              
              if (change.updatedFields.status) {
                this.loadActivityDetail();
              }
            }
          }
        },
        onError: err => {
          console.error('监听失败：', err);
        }
      });
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
    const userInfo = app.globalData.userInfo || {};
    const activity = this.data.activity || {};
    const isFixedDoubles = activity.type === 'fixed-doubles';
    
    // 计算可选搭档列表
    const availablePartners = isFixedDoubles ? this.getAvailablePartners() : [];
    
    this.setData({
      showLevelPicker: true,
      selectedLevel: this.data.userRegistration?.level || 5,
      pickerLevel: (this.data.userRegistration?.level || 5) - 1,
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
    const avatarUrl = e.detail.avatarUrl;
    if (avatarUrl) {
      this.uploadJoinAvatar(avatarUrl);
    }
  },

  onResetJoinAvatar: function() {
    this.setData({ inputAvatar: '' });
  },

  onSelectPartner: function(e) {
    const partnerId = e.currentTarget.dataset.partnerid;
    this.setData({ inputPartnerId: partnerId });
  },

  // 获取可选择的搭档列表（已报名但还没配对的玩家，排除自己）
  getAvailablePartners: function() {
    const registrations = this.data.registrations || [];
    const openid = app.globalData.openid;
    return registrations.filter(r => {
      // 排除自己
      if (r.user_id === openid) return false;
      // 排除已有搭档的
      if (r.partner_id) return false;
      // 排除被别人选为搭档的（partner_id === 自己的 openid）
      // 不需要，因为上面的 partner_id 已经处理了
      return true;
    });
  },

  uploadJoinAvatar: function(tempFilePath) {
    const activityId = this.data.activityId;
    const cloudPath = `join_avatars/${activityId}/${Date.now()}.jpg`;
    
    wx.showLoading({ title: '上传中...' });
    
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: (res) => {
        wx.hideLoading();
        console.log('头像上传成功:', res.fileID);
        this.setData({ inputAvatar: res.fileID });
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('头像上传失败，使用临时路径:', err);
        // 如果上传失败，使用临时路径（自己能看到，他人看不到）
        this.setData({ inputAvatar: tempFilePath });
        wx.showToast({ title: '头像可能仅自己可见', icon: 'none', duration: 2000 });
      }
    });
  },

  uploadAvatarForJoin: function() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.saveJoinAvatarToCloud(tempFilePath);
      }
    });
  },

  saveJoinAvatarToCloud: function(filePath) {
    const activityId = this.data.activityId;
    const cloudPath = `join_avatars/${activityId}/${Date.now()}.jpg`;
    
    wx.showLoading({ title: '上传中...' });
    
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: (res) => {
        wx.hideLoading();
        this.setData({ inputAvatar: res.fileID });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  hideLevelPicker: function() {
    this.setData({ showLevelPicker: false });
  },

   onLevelChange: function(e) {
     const pickerIndex = parseInt(e.detail.value[0]);
     const newLevel = pickerIndex + 1;
     console.log('picker选择:', pickerIndex, '实际等级:', newLevel);
     this.setData({
       pickerLevel: pickerIndex,
       selectedLevel: newLevel
     });
   },

   selectLevel: function(e) {
     const level = parseInt(e.currentTarget.dataset.level);
     console.log('直接选择等级:', level);
     this.setData({
       selectedLevel: level,
       pickerLevel: level - 1
     });
   },

  confirmLevel: function() {
    const pickerLevel = this.data.pickerLevel;
    const level = pickerLevel + 1;
    const activityId = this.data.activityId;
    
    console.log('修改等级参数:', { activityId, level, pickerLevel });
    
    wx.cloud.callFunction({
      name: 'update-user-level',
      data: {
        activityId: activityId,
        level: level
      },
      success: res => {
        console.log('修改等级返回:', res);
        if (res.result && res.result.success) {
          this.setData({
            'userRegistration.level': res.result.data.level,
            showLevelPicker: false
          });
          wx.showToast({
            title: '等级已更新',
            icon: 'success'
          });
          // 重新加载活动详情以确保数据一致
          this.loadActivityDetail();
        } else {
          wx.showToast({
            title: res.result?.error || '修改失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        console.error('修改等级失败:', err);
        wx.showToast({
          title: '修改失败',
          icon: 'none'
        });
      }
    });
  },

  joinActivity: function() {
    if (!this.data.userRegistration) {
      this.showLevelPicker();
    }
  },

  doJoin: function() {
    const nickname = this.data.inputNickname.trim();
    const avatar = this.data.inputAvatar;
    const level = this.data.selectedLevel;
    const activity = this.data.activity || {};
    const isFixedDoubles = activity.type === 'fixed-doubles';
    const partnerId = this.data.inputPartnerId || '';
    
    if (!nickname) {
      wx.showToast({
        title: '请输入您的名字',
        icon: 'none'
      });
      return;
    }
    
    if (nickname.length < 2) {
      wx.showToast({
        title: '名字至少2个字符',
        icon: 'none'
      });
      return;
    }
    
    // 固搭活动：如果有可选搭档则必须选择
    if (isFixedDoubles && !partnerId && this.data.availablePartners.length > 0) {
      wx.showToast({ title: '双打固搭请选择搭档', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '报名中...' });
    wx.cloud.callFunction({
      name: 'join-activity',
      data: {
        activityId: this.data.activityId,
        level: level,
        nickname: nickname,
        avatar: avatar,
        partnerId: isFixedDoubles ? partnerId : undefined
      },
      success: res => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          // 同步昵称到全局状态和首页显示
          if (nickname && app.globalData.userInfo) {
            app.globalData.userInfo.nickname = nickname;
          }
          // 同步更新 users 表的昵称
          wx.cloud.callFunction({
            name: 'update-user-info',
            data: { nickname: nickname },
            fail: () => {} // 静默失败，不影响报名结果
          });
          wx.showToast({
            title: '报名成功',
            icon: 'success'
          });
          this.hideLevelPicker();
          this.loadActivityDetail();
        } else {
          wx.showToast({
            title: res.result?.error || '报名失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        wx.hideLoading();
        wx.showToast({
          title: '报名失败',
          icon: 'none'
        });
      }
    });
  },

  startGrouping: function() {
    // 双打/固搭校验：需要偶数人数
    const activity = this.data.activity;
    const registrations = this.data.registrations;
    if (activity && activity.type !== 'singles' && registrations.length % 2 !== 0) {
      const typeLabel = activity.type === 'fixed-doubles' ? '双打固搭' : '双打';
      wx.showModal({
        title: '人数不足',
        content: `${typeLabel}比赛需要偶数人数，当前${registrations.length}人。请增加或减少1人后再开始分组。`,
        showCancel: false
      });
      return;
    }
    
    wx.showModal({
      title: '确认开始分组',
      content: '分组后不能再报名，是否继续？',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '分组中...' });
          wx.cloud.callFunction({
            name: 'start-grouping',
            data: {
              activityId: this.data.activityId
            },
            success: res => {
              wx.hideLoading();
              if (res.result && res.result.success) {
                wx.showToast({
                  title: '分组完成',
                  icon: 'success'
                });
                this.loadActivityDetail();
              } else {
                wx.showToast({
                  title: res.result?.error || '分组失败',
                  icon: 'none',
                  duration: 3000
                });
              }
            },
            fail: err => {
              wx.hideLoading();
              console.error('分组失败:', err);
              wx.showToast({
                title: '分组失败: ' + (err.message || err.errMsg || '未知错误'),
                icon: 'none',
                duration: 3000
              });
            }
          });
        }
      }
    });
  },

  goToMatch: function(e) {
    const matchId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/match-score/match-score?activityId=${this.data.activityId}&matchId=${matchId}`
    });
  },

  goToGrouping: function() {
    wx.navigateTo({
      url: `/pages/grouping/grouping?activityId=${this.data.activityId}`
    });
  },

  startChallenge: function() {
    wx.showModal({
      title: '开始挑战赛',
      content: '确认所有小组赛已结束？挑战赛中胜者+10分',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '创建挑战赛...' });
          wx.cloud.callFunction({
            name: 'start-challenge',
            data: {
              activityId: this.data.activityId
            },
            success: res => {
              wx.hideLoading();
              if (res.result.success) {
                wx.showToast({
                  title: res.result.data.message || '挑战赛已开始',
                  icon: 'success'
                });
                this.loadActivityDetail();
              } else {
                wx.showToast({
                  title: res.result.error || '创建失败',
                  icon: 'none'
                });
              }
            },
            fail: err => {
              wx.hideLoading();
              wx.showToast({ title: '创建失败', icon: 'none' });
            }
          });
        }
      }
    });
  },

  startFinal: function() {
    wx.showModal({
      title: '开始决赛',
      content: '确认所有挑战赛已结束？决赛胜者+15分',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '创建决赛...' });
          wx.cloud.callFunction({
            name: 'start-final',
            data: {
              activityId: this.data.activityId
            },
            success: res => {
              wx.hideLoading();
              if (res.result.success) {
                wx.showToast({
                  title: '决赛已开始',
                  icon: 'success'
                });
                this.loadActivityDetail();
              } else {
                wx.showToast({
                  title: res.result.error || '创建失败',
                  icon: 'none'
                });
              }
            },
            fail: err => {
              wx.hideLoading();
              wx.showToast({ title: '创建失败', icon: 'none' });
            }
          });
        }
      }
    });
  },

  startAllChallenge: function() {
    const matches = this.data.matches.filter(m => m.round === 'challenge' && m.status === 'pending');
    if (matches.length === 0) {
      wx.showToast({ title: '没有待开始的挑战赛', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '开始挑战赛',
      content: `确定开始 ${matches.length} 场挑战赛吗？`,
      success: res => {
        if (res.confirm) {
          this.doStartAllMatches(matches);
        }
      }
    });
  },

  startAllFinal: function() {
    const matches = this.data.matches.filter(m => m.round === 'final' && m.status === 'pending');
    if (matches.length === 0) {
      wx.showToast({ title: '没有待开始的决赛', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '开始决赛',
      content: `确定开始 ${matches.length} 场决赛吗？`,
      success: res => {
        if (res.confirm) {
          this.doStartAllMatches(matches);
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
        }
      } catch (e) {
        failCount++;
      }
    }
    
    wx.hideLoading();
    
    if (failCount === 0) {
      wx.showToast({ title: '比赛已开始', icon: 'success' });
      this.loadActivityDetail();
    } else {
      wx.showToast({ title: `${successCount}场成功，${failCount}场失败`, icon: 'none' });
    }
  },

  goToRanking: function() {
    wx.navigateTo({
      url: `/pages/ranking/ranking?activityId=${this.data.activityId}`
    });
  },

  formatTime: function(timeValue) {
    if (!timeValue && timeValue !== 0) return '待定';
    
    let timestamp = timeValue;
    
    if (typeof timeValue === 'number') {
      timestamp = timeValue;
    } else if (typeof timeValue === 'string') {
      if (timeValue.includes('T')) {
        timestamp = new Date(timeValue).getTime();
      } else if (!isNaN(timeValue)) {
        timestamp = parseInt(timeValue);
      } else {
        return '待定';
      }
    } else if (typeof timeValue === 'object') {
      if (timeValue.$date) {
        timestamp = timeValue.$date;
      } else {
        return '待定';
      }
    }
    
    if (!timestamp || isNaN(timestamp)) return '待定';
    
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '待定';
    
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    return `${month}月${day}日 ${hour}:${String(minute).padStart(2, '0')}`;
  },

  shareActivity: function() {
    wx.showShareMenu({
      withShareTicket: true
    });
  },

  deleteActivity: function() {
    const activityId = this.data.activityId;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除此活动吗？此操作不可恢复。',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          wx.cloud.callFunction({
            name: 'delete-activity',
            data: {
              activityId: activityId
            },
            success: res => {
              wx.hideLoading();
              if (res.result && res.result.success) {
                wx.showToast({
                  title: '删除成功',
                  icon: 'success'
                });
                setTimeout(() => {
                  wx.navigateBack();
                }, 1500);
              } else {
                wx.showToast({
                  title: res.result?.error || '删除失败',
                  icon: 'none'
                });
              }
            },
            fail: err => {
              wx.hideLoading();
              console.error('删除云函数调用失败:', err);
              wx.showToast({
                title: '删除失败: ' + (err.errMsg || '未知错误'),
                icon: 'none',
                duration: 3000
              });
            }
          });
        }
      }
    });
  },

  finishActivity: function() {
    const activityId = this.data.activityId;
    
    wx.showModal({
      title: '结束活动',
      content: '确定要结束此活动吗？结束后可查看排名',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '结束中...' });
          wx.cloud.callFunction({
            name: 'update-activity-status',
            data: {
              activityId: activityId,
              status: 'finished'
            },
            success: res => {
              wx.hideLoading();
              if (res.result && res.result.success) {
                wx.showToast({
                  title: '活动已结束',
                  icon: 'success'
                });
                this.loadActivityDetail();
              } else {
                wx.showToast({
                  title: res.result?.error || '操作失败',
                  icon: 'none'
                });
              }
            },
            fail: err => {
              wx.hideLoading();
              wx.showToast({
                title: '操作失败',
                icon: 'none'
              });
            }
          });
        }
      }
    });
  },

  copyLocation: function(e) {
    const activity = this.data.activity;
    if (activity && activity.latitude && activity.longitude) {
      wx.openLocation({
        latitude: activity.latitude,
        longitude: activity.longitude,
        name: activity.name,
        address: activity.location,
        scale: 18
      });
    } else {
      const location = e.currentTarget.dataset.location;
      if (location) {
        wx.setClipboardData({
          data: location,
          success: () => {
            wx.showToast({
              title: '地点已复制',
              icon: 'success'
            });
          }
        });
      }
    }
  }
});
