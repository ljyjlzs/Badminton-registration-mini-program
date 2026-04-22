/**
 * startGrouping 云函数 - 开始分组
 * 
 * 功能：
 * 1. 验证组织者权限
 * 2. 验证报名人数
 * 3. 执行分组算法（单打/双打）
 * 4. 创建队伍记录
 * 5. 创建比赛记录
 * 6. 更新活动状态
 * 
 * 入参：{ activityId }
 * 出参：{ success, data: { matches, teams } }
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function fixedDoublesGrouping(players) {
  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 100;
  
  if (!players || players.length < MIN_PLAYERS) {
    throw new Error(`报名人数不足${MIN_PLAYERS}人`);
  }
  
  if (players.length > MAX_PLAYERS) {
    throw new Error(`报名人数超过${MAX_PLAYERS}人`);
  }
  
  if (players.length % 2 !== 0) {
    throw new Error('双打固搭比赛需要偶数人数');
  }
  
  // 固搭：按已有搭档关系组成队伍
  const teams = [];
  const usedIds = new Set();
  
  for (const player of players) {
    if (usedIds.has(player.userId)) continue;
    
    // 找到搭档
    const partner = players.find(p => p.userId === player.partnerId);
    if (!partner) {
      throw new Error(`玩家 ${player.nickname} 没有搭档，无法进行固搭分组`);
    }
    
    const members = [player, partner];
    usedIds.add(player.userId);
    usedIds.add(partner.userId);
    
    teams.push({
      members: members,
      totalLevel: members.reduce((sum, m) => sum + m.level, 0),
      avgLevel: members.reduce((sum, m) => sum + m.level, 0) / members.length
    });
  }
  
  // 生成循环赛：所有队伍两两对决
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

function doublesGrouping(players) {
  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 100;
  
  if (!players || players.length < MIN_PLAYERS) {
    throw new Error(`报名人数不足${MIN_PLAYERS}人`);
  }
  
  if (players.length > MAX_PLAYERS) {
    throw new Error(`报名人数超过${MAX_PLAYERS}人`);
  }
  
  // 轮换搭档模式：每个人都要和所有其他人搭配一次
  // 生成所有 C(n,2) 种双人搭配
  const sortedPlayers = [...players].sort((a, b) => b.level - a.level);
  const n = sortedPlayers.length;
  
  // 生成所有搭配
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push({
        members: [sortedPlayers[i], sortedPlayers[j]],
        totalLevel: sortedPlayers[i].level + sortedPlayers[j].level,
        avgLevel: (sortedPlayers[i].level + sortedPlayers[j].level) / 2
      });
    }
  }
  
  // 将搭配分配到比赛中：每场2组搭配对战（4人打，2人轮休）
  // 用贪心策略：尽量让未出现的搭配优先上场，同时平衡实力
  const usedPairKeys = new Set();
  const matches = [];
  const venues = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  
  const pairKey = (pair) => pair.members.map(m => m.userId).sort().join(',');
  
  while (matches.length * 2 < pairs.length) {
    // 找到还未安排的搭配
    const unusedPairs = pairs.filter(p => !usedPairKeys.has(pairKey(p)));
    if (unusedPairs.length < 2) break;
    
    // 贪心选配：遍历未用搭配，选出一对不共享球员且实力差距最小的两组搭配
    let bestPair1 = null;
    let bestPair2 = null;
    let bestDiff = Infinity;
    
    for (let i = 0; i < unusedPairs.length; i++) {
      const p1 = unusedPairs[i];
      const p1Ids = new Set(p1.members.map(m => m.userId));
      
      for (let j = i + 1; j < unusedPairs.length; j++) {
        const p2 = unusedPairs[j];
        const p2Ids = new Set(p2.members.map(m => m.userId));
        
        // 两组搭配不能有相同球员
        let overlap = false;
        for (const id of p1Ids) {
          if (p2Ids.has(id)) { overlap = true; break; }
        }
        if (overlap) continue;
        
        const diff = Math.abs(p1.totalLevel - p2.totalLevel);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestPair1 = p1;
          bestPair2 = p2;
        }
      }
      
      // 找到实力差距为0的完美匹配就不再找了
      if (bestDiff === 0) break;
    }
    
    if (!bestPair1 || !bestPair2) {
      // 如果没找到不重叠的搭配对，取前两个不重叠的
      for (let i = 0; i < unusedPairs.length; i++) {
        const p1 = unusedPairs[i];
        const p1Ids = new Set(p1.members.map(m => m.userId));
        
        if (!bestPair1) { bestPair1 = p1; continue; }
        
        const b1Ids = new Set(bestPair1.members.map(m => m.userId));
        let overlap = false;
        for (const id of p1Ids) {
          if (b1Ids.has(id)) { overlap = true; break; }
        }
        if (!overlap) { bestPair2 = p1; break; }
      }
    }
    
    if (!bestPair1 || !bestPair2) break;
    
    usedPairKeys.add(pairKey(bestPair1));
    usedPairKeys.add(pairKey(bestPair2));
    
    matches.push({
      venue: venues[matches.length % venues.length] || `场地${matches.length + 1}`,
      team1: bestPair1,
      team2: bestPair2,
      levelDiff: Math.abs(bestPair1.totalLevel - bestPair2.totalLevel)
    });
  }
  
  // 处理落单搭档：当 C(n,2) 为奇数时，贪心会剩1种搭档未安排
  // 补一场：从已使用的搭配中找一个不共享球员且实力最接近的，让它多打一次
  const leftoverPairs = pairs.filter(p => !usedPairKeys.has(pairKey(p)));
  if (leftoverPairs.length === 1) {
    const leftover = leftoverPairs[0];
    const leftoverIds = new Set(leftover.members.map(m => m.userId));
    
    const usedPairs = pairs.filter(p => usedPairKeys.has(pairKey(p)));
    let bestOpponent = null;
    let bestDiff = Infinity;
    
    for (const used of usedPairs) {
      const usedIds = new Set(used.members.map(m => m.userId));
      let overlap = false;
      for (const id of leftoverIds) {
        if (usedIds.has(id)) { overlap = true; break; }
      }
      if (!overlap) {
        const diff = Math.abs(leftover.totalLevel - used.totalLevel);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestOpponent = used;
        }
      }
    }
    
    if (bestOpponent) {
      matches.push({
        venue: venues[matches.length % venues.length] || `场地${matches.length + 1}`,
        team1: leftover,
        team2: bestOpponent,
        levelDiff: Math.abs(leftover.totalLevel - bestOpponent.totalLevel)
      });
    }
  }
  
  return matches;
}

function singlesGrouping(players) {
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 100;
  
  if (!players || players.length < MIN_PLAYERS) {
    throw new Error(`报名人数不足${MIN_PLAYERS}人`);
  }
  
  if (players.length > MAX_PLAYERS) {
    throw new Error(`报名人数超过${MAX_PLAYERS}人`);
  }
  
  const sortedPlayers = [...players].sort((a, b) => b.level - a.level);
  const teams = [];
  
  for (const player of sortedPlayers) {
    teams.push({
      members: [player],
      totalLevel: player.level,
      avgLevel: player.level
    });
  }
  
  const matches = [];
  const venues = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      matches.push({
        venue: venues[matches.length] || `场地${matches.length + 1}`,
        team1: teams[i],
        team2: teams[j],
        levelDiff: Math.abs(teams[i].totalLevel - teams[j].totalLevel)
      });
    }
  }
  
  return matches;
}

function getCaptain(team) {
  if (!team.members || team.members.length === 0) {
    return null;
  }
  return team.members.reduce((captain, member) => {
    return member.level > captain.level ? member : captain;
  }, team.members[0]);
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  const { activityId } = event;
  
  if (!activityId) {
    return {
      success: false,
      error: '活动ID不能为空'
    };
  }
  
  try {
    console.log('startGrouping开始, activityId:', activityId, 'openid:', openid);
    
    const activityResult = await db.collection('activities').doc(activityId).get();
    console.log('活动查询结果:', activityResult);
    
    if (!activityResult.data) {
      return {
        success: false,
        error: '活动不存在'
      };
    }
    
    const activity = activityResult.data;
    
    if (activity.organizer_id !== openid) {
      return {
        success: false,
        error: '只有组织者才能开始分组'
      };
    }
    
    if (activity.status !== 'registering') {
      return {
        success: false,
        error: '活动状态不允许分组'
      };
    }
    
    const registrationsResult = await db.collection('registrations').where({
      activity_id: activityId
    }).get();
    
    const registrations = registrationsResult.data || [];
    const activityType = activity.type || 'doubles';
    const isSingles = activityType === 'singles';
    
    const MIN_PLAYERS = isSingles ? 3 : 4;
    const MAX_PLAYERS = 100;
    
    if (registrations.length < MIN_PLAYERS) {
      return {
        success: false,
        error: `报名人数不足，最少需要${MIN_PLAYERS}人`
      };
    }
    
    if (registrations.length > MAX_PLAYERS) {
      return {
        success: false,
        error: `报名人数超出限制，最多${MAX_PLAYERS}人`
      };
    }
    
    const userIds = registrations.map(r => r.user_id);
    const usersResult = await db.collection('users').where({
      _openid: db.command.in(userIds)
    }).get();
    
    const usersMap = {};
    (usersResult.data || []).forEach(user => {
      usersMap[user._openid] = user;
    });
    
    const players = registrations.map(reg => {
      const user = usersMap[reg.user_id];
      return {
        userId: reg.user_id,
        registrationId: reg._id,
        nickname: reg.nickname || user?.nickname || '未知',
        level: reg.level || 5,
        avatar: user?.avatar || '',
        partnerId: reg.partner_id || null
      };
    });
    
    console.log('玩家列表:', players);
    console.log('活动类型:', activityType);
    
    let matches;
    if (isSingles) {
      matches = singlesGrouping(players);
    } else if (activityType === 'fixed-doubles') {
      matches = fixedDoublesGrouping(players);
    } else {
      matches = doublesGrouping(players);
    }
    console.log('分组结果:', matches);
    
    // 校验分组结果：如果没有生成任何比赛，不应更新活动状态
    if (!matches || matches.length === 0) {
      return {
        success: false,
        error: '分组失败：无法生成比赛，请检查人数是否符合要求'
      };
    }
    
    const uniqueTeamsMap = new Map();
    for (const match of matches) {
      const team1Key = match.team1.members.map(m => m.userId).sort().join(',');
      const team2Key = match.team2.members.map(m => m.userId).sort().join(',');
      
      if (!uniqueTeamsMap.has(team1Key)) {
        const team1Captain = getCaptain(match.team1);
        const team1Name = isSingles 
          ? match.team1.members[0].nickname 
          : match.team1.members.map(m => m.nickname).join('&');
        uniqueTeamsMap.set(team1Key, {
          activity_id: activityId,
          name: team1Name,
          captain_id: team1Captain ? team1Captain.userId : match.team1.members[0].userId,
          members: match.team1.members.map(m => m.userId),
          total_level: match.team1.totalLevel,
          challenge_score: 0,
          group_score: 0,
          created_at: db.serverDate()
        });
      }
      
      if (!uniqueTeamsMap.has(team2Key)) {
        const team2Captain = getCaptain(match.team2);
        const team2Name = isSingles 
          ? match.team2.members[0].nickname 
          : match.team2.members.map(m => m.nickname).join('&');
        uniqueTeamsMap.set(team2Key, {
          activity_id: activityId,
          name: team2Name,
          captain_id: team2Captain ? team2Captain.userId : match.team2.members[0].userId,
          members: match.team2.members.map(m => m.userId),
          total_level: match.team2.totalLevel,
          challenge_score: 0,
          group_score: 0,
          created_at: db.serverDate()
        });
      }
    }
    
    const uniqueTeamsArray = Array.from(uniqueTeamsMap.values());
    const teams = [];
    const teamIdMap = {};
    
    for (const team of uniqueTeamsArray) {
      const teamResult = await db.collection('teams').add({ data: team });
      teamIdMap[team.members.sort().join(',')] = teamResult._id;
      teams.push({ ...team, _id: teamResult._id });
    }
    
    const teamsMap = {};
    for (const team of teams) {
      const key = team.members.sort().join(',');
      teamsMap[key] = team;
    }
    
    const matchRecords = [];
    const allTeam1Players = [];
    const allTeam2Players = [];
    
    for (const match of matches) {
      const team1Key = match.team1.members.map(m => m.userId).sort().join(',');
      const team2Key = match.team2.members.map(m => m.userId).sort().join(',');
      
      const team1 = teamsMap[team1Key];
      const team2 = teamsMap[team2Key];
      
      allTeam1Players.push(...team1.members);
      allTeam2Players.push(...team2.members);
      
      const matchRecord = {
        activity_id: activityId,
        round: 'group',
        venue: match.venue,
        team1_id: team1._id,
        team2_id: team2._id,
        team1_score: null,
        team2_score: null,
        status: 'pending',
        score_submitter: null,
        team1_confirmed: false,
        team2_confirmed: false,
        completed_at: null,
        created_at: db.serverDate()
      };
      
      const matchResult = await db.collection('matches').add({ data: matchRecord });
      matchRecords.push({ ...matchRecord, _id: matchResult._id });
    }
    
    // 轮换双打模式下，一个人属于多个队伍，无法设置单一 team_id
    // 只对单打和固搭双打更新 registrations.team_id
    if (isSingles || activityType === 'fixed-doubles') {
      for (const team of teams) {
        for (const memberId of team.members) {
          await db.collection('registrations').where({
            activity_id: activityId,
            user_id: memberId
          }).update({
            data: { team_id: team._id }
          });
        }
      }
    }
    
    await db.collection('activities').doc(activityId).update({
      data: {
        status: 'grouping',
        team1_players: allTeam1Players,
        team2_players: allTeam2Players
      }
    });
    
    return {
      success: true,
      data: {
        matches: matchRecords,
        teams: teams
      }
    };
  } catch (err) {
    console.error('分组失败：', err);
    return {
      success: false,
      error: err.message || '分组失败'
    };
  }
};
