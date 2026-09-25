var app = getApp();
var callFunction = require('../../utils/request.js').callFunction;

Page({
  data: {
    loading: true,
    statCards: [],
    level: 5,
    rank: '-',
    period: 'season',
    aiStyle: '',
    badges: [],
    badgeIconMap: { mvp: '🏆', best_partner: '🤝', streak_king: '🔥', hard_worker: '💪', biggest_win: '🎯' },
    activityCount: 0,
    rankingTrend: [],
    trendCanvasWidth: 300,
    trendCanvasHeight: 200
  },

  onLoad: function() {
    this.loadSummary();
  },

  onReady: function() {
    // 获取屏幕宽度，设置趋势图宽度（wx.getWindowInfo 同步返回，替代废弃的 getSystemInfo）
    var win = wx.getWindowInfo ? wx.getWindowInfo() : null;
    var windowWidth = (win && win.windowWidth) || 375;
    this.setData({
      trendCanvasWidth: windowWidth - 48
    });
  },

  onPullDownRefresh: function() {
    this.loadSummary(function() { wx.stopPullDownRefresh(); });
  },

  onShareAppMessage: function() {
    return {
      title: this.data.period === 'season' ? '我的羽毛球赛季总结' : '我的羽毛球年度总结',
      path: '/pages/my-summary/my-summary' + (this.data.period ? '?period=' + this.data.period : '')
    };
  },

  onShareTimeline: function() {
    return {
      title: this.data.period === 'season' ? '我的羽毛球赛季总结' : '我的羽毛球年度总结',
      query: this.data.period ? 'period=' + this.data.period : ''
    };
  },

  switchPeriod: function(e) {
    this.setData({ period: e.currentTarget.dataset.period });
    this.loadSummary();
  },

  copyContent: function() {
    var texts = [];
    this.data.statCards.forEach(function(c) { texts.push(c.label + '：' + c.value); });
    wx.setClipboardData({ data: texts.join('\n'), success: function() {
      wx.showToast({ title: '已复制', icon: 'success' });
    }});
  },

  loadSummary: function(done) {
    var that = this;
    that.setData({ loading: true });

    callFunction('get-user-stats', 'get', {
      period: that.data.period
    }).then(function(res) {
      if (res && res.success) {
        var d = res.data || {};
        var statCards = [
          { key: 'matchCount', label: '总场次', value: d.matchCount || 0 },
          { key: 'winRate', label: '胜率', value: (d.winRate || '0') + '%' },
          { key: 'totalScore', label: '积分变化', value: d.totalScore || 0 },
          { key: 'rating', label: '当前积分', value: d.rating || 1000 }
        ];
        that.setData({
          loading: false,
          statCards: statCards,
          level: d.level || 5,
          rank: d.rank || '-',
          aiStyle: d.aiStyle || '',
          badges: (d.badges || []).map(function(b) {
            // BUG-59: 对齐 profile.wxml 字段（badgeCode/title），兼容旧 key/icon/name
            var code = b.badgeCode || b.key || b.id || '';
            return {
              _id: b._id || code,
              badgeCode: code,
              icon: b.icon || '',
              title: b.title || b.name || code,
              name: b.name || b.title || code,
              description: b.description || ''
            };
          }),
          activityCount: d.activityCount || 0,
          rankingTrend: d.rankingTrend || []
        });
        // 绘制排名趋势图
        if (d.rankingTrend && d.rankingTrend.length > 0) {
          that.drawTrendChart(d.rankingTrend);
        }
      } else {
        that.setData({ loading: false });
      }
      if (done) done();
    }).catch(function(err) {
      console.error('加载战绩失败：', err);
      that.setData({ loading: false });
      if (done) done();
    });
  },

  drawTrendChart: function(trendData) {
    var that = this;
    var ctx = wx.createCanvasContext('trendChart', that);
    var width = that.data.trendCanvasWidth;
    var height = that.data.trendCanvasHeight;
    var padding = 40;
    var chartWidth = width - padding * 2;
    var chartHeight = height - padding * 2;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    if (!trendData || trendData.length === 0) {
      ctx.draw();
      return;
    }

    // 准备数据
    var scores = trendData.map(function(item) { return item.scoreChange || 0; });
    var labels = trendData.map(function(item) {
      var date = new Date(item.date);
      return (date.getMonth() + 1) + '/' + date.getDate();
    });

    // 计算累计积分
    var cumulativeScores = [];
    var cumulative = 0;
    for (var i = 0; i < scores.length; i++) {
      cumulative += scores[i];
      cumulativeScores.push(cumulative);
    }

    // 找出最大值和最小值
    var maxScore = Math.max.apply(null, cumulativeScores);
    var minScore = Math.min.apply(null, cumulativeScores);
    var scoreRange = maxScore - minScore;
    if (scoreRange === 0) scoreRange = 1;

    // 绘制背景
    ctx.setFillStyle('#f8f9fa');
    ctx.fillRect(0, 0, width, height);

    // 绘制网格线
    ctx.setStrokeStyle('#e9ecef');
    ctx.setLineWidth(1);
    for (var i = 0; i <= 4; i++) {
      var y = padding + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // 绘制折线
    ctx.setStrokeStyle('#0ea56b');
    ctx.setLineWidth(3);
    ctx.beginPath();

    var points = [];
    for (var i = 0; i < cumulativeScores.length; i++) {
      var x = padding + (chartWidth / Math.max(cumulativeScores.length - 1, 1)) * i;
      var y = padding + chartHeight - ((cumulativeScores[i] - minScore) / scoreRange) * chartHeight;
      points.push({ x: x, y: y });

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // 绘制数据点
    ctx.setFillStyle('#0ea56b');
    for (var i = 0; i < points.length; i++) {
      ctx.beginPath();
      ctx.arc(points[i].x, points[i].y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }

    // 绘制标签
    ctx.setFillStyle('#666');
    ctx.setFontSize(10);
    ctx.setTextAlign('center');
    for (var i = 0; i < labels.length; i++) {
      var x = padding + (chartWidth / Math.max(labels.length - 1, 1)) * i;
      ctx.fillText(labels[i], x, height - 10);
    }

    // 绘制Y轴标签
    ctx.setTextAlign('right');
    for (var i = 0; i <= 4; i++) {
      var y = padding + (chartHeight / 4) * i;
      var value = Math.round(maxScore - (scoreRange / 4) * i);
      ctx.fillText(value.toString(), padding - 5, y + 4);
    }

    ctx.draw();
  }
});
