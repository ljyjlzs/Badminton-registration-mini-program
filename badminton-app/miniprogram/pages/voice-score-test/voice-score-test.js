const { callFunction } = require('../../utils/request.js');

Page({
  data: {
    recording: false,
    duration: 0,
    audioFile: '',
   textInput: '',
    result: null,
    submitting: false,
    loadError: false
  },

  onLoad(options) {
    this.activityId = options.activityId || '';
    this.matchId = options.matchId || '';
    this.team1Label = options.team1Label || '队伍1';
    this.team2Label = options.team2Label || '队伍2';
    this.recorderManager = wx.getRecorderManager();
    this.timer = null;

    this.recorderManager.onStop((res) => {
      clearInterval(this.timer);
      this.setData({ recording: false, audioFile: res.tempFilePath });
    });

    this.recorderManager.onError((err) => {
      clearInterval(this.timer);
      this.setData({ recording: false });
      wx.showToast({ title: '录音失败', icon: 'none' });
    });
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
  },

  toggleRecord() {
    if (this.data.recording) {
      this.recorderManager.stop();
    } else {
      this.setData({ recording: true, duration: 0, result: null, audioFile: '' });
      this.timer = setInterval(() => {
        this.setData({ duration: this.data.duration + 1 });
      }, 1000);
      this.recorderManager.start({ format: 'mp3', sampleRate: 16000, numberOfChannels: 1 });
    }
  },

  onTextInput(e) { this.setData({ textInput: e.detail.value }); },

  // AI-53: 录音后走 ASR 云函数识别（上传 fileID → voice-score-parse asr）
  async parseAudio() {
    const tempFilePath = this.data.audioFile;
    if (!tempFilePath) return wx.showToast({ title: '请先录音', icon: 'none' });
    try {
      this.setData({ submitting: true, loadError: false });
      wx.showLoading({ title: '识别中...' });
      const cloudPath = 'voice_scores/' + Date.now() + '.mp3';
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath });
      const data = await callFunction('voice-score-parse', 'asr', { fileID: up.fileID });
      const d = (data && data.data) || data || {};
      // AI-31: result 为结构化对象 {matchId, matchOrder, team1Score, team2Score}；兼容旧 scores 数组
      const r = d.result;
      let t1, t2;
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        t1 = r.team1Score; t2 = r.team2Score;
      } else {
        const scores = d.scores || r || [];
        if (scores.length > 0) { t1 = scores[0].scoreA; t2 = scores[0].scoreB; }
      }
      if (t1 != null && t2 != null) {
        this.setData({
          result: {
            team1Score: t1, team2Score: t2,
            matchId: (r && r.matchId) || '',
            matchOrder: (r && r.matchOrder) || 1,
            confidence: 1.0,
            confidenceText: 100,
            needReview: false
          }
        });
      } else {
        wx.showToast({ title: '未识别到比分，请直接输入文字', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: e.message || '语音识别失败', icon: 'none' });
      // BUG-46: 识别失败展示可重试错误态
      this.setData({ loadError: true });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  async parseText() {
    const text = this.data.textInput.trim();
    if (!text) return wx.showToast({ title: '请输入比分文字', icon: 'none' });
    try {
      this.setData({ loadError: false });
      const data = await callFunction('voice-score-parse', 'parse', { text });
      const d = (data && data.data) || data || {};
      // AI-31: result 为结构化对象；兼容旧 scores 数组
      const r = d.result;
      let t1, t2;
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        t1 = r.team1Score; t2 = r.team2Score;
      } else {
        const scores = d.scores || r || [];
        if (scores.length > 0) { t1 = scores[0].scoreA; t2 = scores[0].scoreB; }
      }
      if (t1 != null && t2 != null) {
        this.setData({ result: { team1Score: t1, team2Score: t2, matchId: (r && r.matchId) || '', matchOrder: (r && r.matchOrder) || 1, confidence: 1.0, confidenceText: 100, needReview: false } });
      } else {
        wx.showToast({ title: '未识别到比分', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      // BUG-46: 识别失败展示可重试错误态
      this.setData({ loadError: true });
    }
  },

  // BUG-46: 按当前输入形态重试识别（有录音走 ASR，否则走文本解析）
  retryLoad() {
    if (this.data.audioFile) {
      this.parseAudio();
    } else if (this.data.textInput.trim()) {
      this.parseText();
    }
  },

  resetInput() {
    this.setData({ textInput: '', result: null });
  },

  async submitScore() {
    if (!this.data.result) return;
    const { team1Score, team2Score } = this.data.result;
    this.setData({ submitting: true });
    try {
      await callFunction('submit-score', 'submit', {
        activityId: this.activityId, matchId: this.matchId,
        team1Score, team2Score
      });
      wx.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onShareAppMessage() {
    return {
      title: '语音计分',
      path: '/pages/voice-score-test/voice-score-test?activityId=' + (this.activityId || '') + '&matchId=' + (this.matchId || '')
    };
  },

  onShareTimeline() {
    return {
      title: '语音计分',
      query: 'activityId=' + (this.activityId || '') + '&matchId=' + (this.matchId || '')
    };
  }
});
