/**
 * 云函数调用封装
 */

const app = getApp();

function call(name, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: name,
      data: data,
      success: res => {
        resolve(res.result);
      },
      fail: err => {
        console.error(`云函数 ${name} 调用失败：`, err);
        reject(err);
      }
    });
  });
}

/**
 * 登录
 */
function login(userInfo) {
  return call('login', { userInfo });
}

/**
 * 创建活动
 */
function createActivity(name, location, time) {
  return call('create-activity', { name, location, time });
}

/**
 * 报名参加活动
 */
function joinActivity(activityId, level) {
  return call('join-activity', { activityId, level });
}

/**
 * 开始分组
 */
function startGrouping(activityId) {
  return call('start-grouping', { activityId });
}

/**
 * 获取活动详情
 */
function getActivityDetail(activityId) {
  return call('get-activity-detail', { activityId });
}

/**
 * 获取比赛详情
 */
function getMatchDetail(activityId, matchId) {
  return call('get-match-detail', { activityId, matchId });
}

/**
 * 提交比分
 */
function submitScore(activityId, matchId, team1Score, team2Score) {
  return call('submit-score', { activityId, matchId, team1Score, team2Score });
}

/**
 * 确认比分
 */
function confirmScore(activityId, matchId, confirmed) {
  return call('confirm-score', { activityId, matchId, confirmed });
}

/**
 * 获取排名
 */
function getRankings(activityId) {
  return call('get-rankings', { activityId });
}

/**
 * 设置队名
 */
function setTeamName(teamId, name) {
  return call('set-team-name', { teamId, name });
}

module.exports = {
  call,
  login,
  createActivity,
  joinActivity,
  startGrouping,
  getActivityDetail,
  getMatchDetail,
  submitScore,
  confirmScore,
  getRankings,
  setTeamName
};
