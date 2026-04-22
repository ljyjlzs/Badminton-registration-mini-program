/**
 * scoreCalculation.js - 积分计算工具
 * 
 * 小组赛积分规则：
 * - 胜者积分 = 自己的分数 - 对手的分数
 * - 败者积分 = 自己的分数 - 对手的分数（负数）
 * 
 * 挑战赛积分规则：
 * - 胜者每人 +10 分
 * - 败者每人 -10 分
 */

/**
 * 计算小组赛积分
 * @param {number} team1Score - 队伍1的分数
 * @param {number} team2Score - 队伍2的分数
 * @returns {Object} { team1ScoreChange, team2ScoreChange }
 */
function calculateGroupScore(team1Score, team2Score) {
  const scoreDiff = Math.abs(team1Score - team2Score);
  
  if (team1Score > team2Score) {
    // 队伍1获胜
    return {
      team1ScoreChange: scoreDiff,
      team2ScoreChange: -scoreDiff
    };
  } else if (team2Score > team1Score) {
    // 队伍2获胜
    return {
      team1ScoreChange: -scoreDiff,
      team2ScoreChange: scoreDiff
    };
  } else {
    // 平局（羽毛球一般不会出现，需要重新比赛，这里暂定双方都是0）
    return {
      team1ScoreChange: 0,
      team2ScoreChange: 0
    };
  }
}

/**
 * 计算挑战赛积分
 * @param {boolean} challengerWins - 挑战者是否获胜
 * @returns {Object} { winnerScoreChange, loserScoreChange }
 */
function calculateChallengeScore(challengerWins) {
  if (challengerWins) {
    return {
      winnerScoreChange: 10,   // 挑战者胜，晋级队每人-10，挑战队每人+10
      loserScoreChange: -10,
      isChallengerWinner: true
    };
  } else {
    return {
      winnerScoreChange: 10,   // 晋级队胜，晋级队每人+10，挑战队每人-10
      loserScoreChange: -10,
      isChallengerWinner: false
    };
  }
}

/**
 * 计算队伍总积分
 * @param {Array} scores - 队伍成员的积分记录
 * @returns {number} 总积分
 */
function calculateTeamTotalScore(scores) {
  return scores.reduce((total, score) => total + score.score_change, 0);
}

module.exports = {
  calculateGroupScore,
  calculateChallengeScore,
  calculateTeamTotalScore
};
