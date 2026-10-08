var callFunction = require('../../utils/request').callFunction;

var REMINDER_POLL_MS = 60000;

Component({
  properties: {
    activityId: { type: String, value: '' },
    mode: { type: String, value: 'detail' }
  },

  data: {
    currentMatch: null,
    nextMatch: null,
    visible: false,
    loadError: false
  },

  lifetimes: {
    attached: function() {
      if (this.properties.activityId) {
        this.loadReminder();
        this.startPolling();
      }
    },
    detached: function() {
      this.stopPolling();
    }
  },

  // 页面显示/隐藏时同步启停轮询，避免后台空转
  pageLifetimes: {
    show: function() {
      if (this.properties.activityId) {
        this.loadReminder();
        this.startPolling();
      }
    },
    hide: function() {
      this.stopPolling();
    }
  },

  methods: {
    startPolling: function() {
      var that = this;
      if (that._timer) return;
      that._timer = setInterval(function() {
        that.loadReminder();
      }, REMINDER_POLL_MS);
    },

    stopPolling: function() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    },

    loadReminder: function() {
      var that = this;
      callFunction('match-reminders', 'get', { activityId: that.properties.activityId })
        .then(function(res) {
          var payload = (res && res.data) || {};
          var reminders = payload.reminders || [];
          var currentMatch = reminders[0] || null;
          var nextMatch = reminders[1] || null;
          that.setData({
            currentMatch: currentMatch,
            nextMatch: nextMatch,
            visible: !!(payload.hasReminder || reminders.length),
            loadError: false
          });
        }).catch(function() {
          // BUG-46: 加载失败隐藏提醒浮层，避免展示过期提醒；初始 visible 亦为 false
          that.setData({ loadError: true, visible: false });
        });
    }
  }
});
