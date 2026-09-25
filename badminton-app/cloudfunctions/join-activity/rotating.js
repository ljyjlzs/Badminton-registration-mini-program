/**
 * 轮转双打分组算法（权威实现，对齐 GroupingPlanServiceImpl.buildRotatingDoublesPlan）
 * 基准：court-matches 修复版 keyOf（对象 pair / 成员数组双分支，过滤 dummy）
 * 部署前 node cloudfunctions/sync-shared.js 同步到各函数目录
 */
function buildRotatingDoublesPlan(regs, playersMap) {
  if (regs.length < 4) throw new Error('轮转双打至少需要4人');
  const players = regs.map(r => r.userId);
  const circle = players.slice();
  const dummy = -1;
  if (circle.length % 2 !== 0) circle.push(dummy);
  const moving = circle.length - 1;
  const allPairs = [];
  const leftovers = [];
  const matches = [];
  const makePair = (f, s) => ({ first: f, second: s });
  // 双分支：传入 pair 对象 {first,second} 或成员数组均可
  const keyOf = (x) => {
    const arr = Array.isArray(x) ? x : [x.first, x.second];
    return arr.filter(v => v !== dummy && v != null).map(String).sort().join(',');
  };
  const toPlanMatch = (p, q) => ({ team1Key: 't_' + keyOf(p), team2Key: 't_' + keyOf(q) });
  const pairOverlaps = (p, q) => p.first === q.first || p.first === q.second || p.second === q.first || p.second === q.second;
  for (let round = 0; round < moving; round++) {
    const roundPairs = [makePair(circle[moving], circle[round % moving])];
    for (let step = 1; step <= Math.floor(moving / 2); step++) {
      roundPairs.push(makePair(circle[(round + step) % moving], circle[(round - step + moving) % moving]));
    }
    const realPairs = roundPairs.filter(p => p.first !== dummy && p.second !== dummy);
    if (realPairs.length % 2 === 0) {
      for (let i = 0; i < realPairs.length; i += 2) matches.push(toPlanMatch(realPairs[i], realPairs[i + 1]));
    } else {
      for (let i = 0; i < realPairs.length - 1; i += 2) matches.push(toPlanMatch(realPairs[i], realPairs[i + 1]));
      leftovers.push(realPairs[realPairs.length - 1]);
    }
  }
  const usedLeft = new Array(leftovers.length).fill(false);
  for (let i = 0; i < leftovers.length; i++) {
    if (usedLeft[i]) continue;
    usedLeft[i] = true;
    let leftover = leftovers[i];
    let partner = null;
    for (let j = i + 1; j < leftovers.length; j++) {
      if (!usedLeft[j] && !pairOverlaps(leftover, leftovers[j])) { partner = leftovers[j]; usedLeft[j] = true; break; }
    }
    if (partner === null) {
      for (const up of allPairs) { if (!pairOverlaps(leftover, up)) { partner = up; break; } }
    }
    if (partner !== null) { matches.push(toPlanMatch(leftover, partner)); allPairs.push(leftover); }
  }
  matches.forEach((m, idx) => { m.roundOrder = idx + 1; });
  const firstRoundByTeam = new Map();
  const addTeam = (members, round) => { const k = keyOf(members); if (!firstRoundByTeam.has(k)) firstRoundByTeam.set(k, round); };
  matches.forEach(m => {
    addTeam(m.team1Key.replace('t_', '').split(','), m.roundOrder);
    addTeam(m.team2Key.replace('t_', '').split(','), m.roundOrder);
  });
  const teams = [];
  const reasons = [];
  for (const [key, round] of firstRoundByTeam) {
    const members = key.split(',').filter(Boolean);
    const name = members.map(id => playersMap[id] ? playersMap[id].nickname : id).join('/');
    teams.push({ key: 't_' + key, members, name });
    reasons.push('轮转组合：' + name + '（第' + round + '轮）');
  }
  return { teams, matches, reasons, matchesCount: matches.length };
}

module.exports = { buildRotatingDoublesPlan };
