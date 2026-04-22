/**
 * groupingAlgorithm.js - 均衡分组算法
 * 
 * 算法说明：
 * 1. 将所有报名用户按等级降序排列
 * 2. 每次取最高等级+最低等级组成一队
 * 3. 重复直到所有人分配完毕
 * 4. 将队伍按总等级降序排列
 * 5. 头尾配对、中段配对
 * 
 * @param {Array} players - [{ userId, level, nickname, avatar }]
 * @returns {Array} teams - [{ members: [], totalLevel, avgLevel }]
 */

function balanceGrouping(players) {
  if (!players || players.length < 4) {
    throw new Error('报名人数不足4人');
  }
  
  if (players.length > 12) {
    throw new Error('报名人数超过12人');
  }
  
  if (players.length % 2 !== 0) {
    throw new Error('双打比赛需要偶数人数');
  }
  
  const sortedPlayers = [...players].sort((a, b) => b.level - a.level);
  
  const numTeams = sortedPlayers.length / 2;
  const teamBuckets = Array.from({ length: numTeams }, () => []);
  
  for (let i = 0; i < sortedPlayers.length; i++) {
    const round = Math.floor(i / numTeams);
    const posInRound = i % numTeams;
    const teamIndex = round % 2 === 0 ? posInRound : numTeams - 1 - posInRound;
    teamBuckets[teamIndex].push(sortedPlayers[i]);
  }
  
  const teams = teamBuckets.map(members => ({
    members: members,
    totalLevel: members.reduce((sum, m) => sum + m.level, 0),
    avgLevel: members.reduce((sum, m) => sum + m.level, 0) / members.length
  }));
  
  const matches = [];
  const venues = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      matches.push({
        venue: venues[matches.length % venues.length] || `场地${matches.length + 1}`,
        team1: teams[i],
        team2: teams[j],
        levelDiff: Math.abs(teams[i].totalLevel - teams[j].totalLevel)
      });
    }
  }
  
  return matches;
}

/**
 * 计算队伍中等级最高的人作为队长
 * @param {Object} team - 队伍对象
 * @returns {Object} captain - 队长信息
 */
function getCaptain(team) {
  if (!team.members || team.members.length === 0) {
    return null;
  }
  
  return team.members.reduce((captain, member) => {
    return member.level > captain.level ? member : captain;
  }, team.members[0]);
}

module.exports = {
  balanceGrouping,
  getCaptain
};
