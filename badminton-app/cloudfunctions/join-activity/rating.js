/**
 * 共享评分引擎（ARCH-02）
 * ELO 积分计算与结算逻辑，供 submit-score / court-submit-score 复用。
 * ⚠️ 涉及积分/财务，任何公式改动前必须做快照对拍验证（见 _shared/rating.snapshot.test.js）。
 */
const RATING_BASE = 1000;
const RATING_PER_LEVEL = 80;
const ELO_K = 32;
const ELO_SPREAD = 15;
const ELO_BONUS = 0.3;

/** 按等级折算基准积分 */
function ratingOfLevel(level) {
  const lvl = level != null ? level : 5;
  return RATING_BASE + (lvl - 5) * RATING_PER_LEVEL;
}

/** 取玩家当前积分（无 rating 时按 level 折算） */
function ratingOf(user) {
  if (user && user.rating != null) return user.rating;
  return ratingOfLevel(user && user.level);
}

/** 队伍平均积分 */
function avgRating(ids, umap) {
  if (!ids.length) return 1200;
  var s = 0;
  for (var i = 0; i < ids.length; i++) {
    s += ratingOf(umap[ids[i]]);
  }
  return s / ids.length;
}

/** 期望胜率 */
function expectedScore(rSelf, rOpp) {
  return 1 / (1 + Math.pow(10, (rOpp - rSelf) / 400));
}

/** 分差权重 */
function scoreWeight(diff) {
  return 1 + Math.min(diff, ELO_SPREAD) / ELO_SPREAD * ELO_BONUS;
}

/**
 * 计算胜负双方积分增量（delta2 = -delta1，保底 ±1）
 * @returns {{delta1:number, delta2:number, expected1:number, expected2:number, rA:number, rB:number, weight:number}}
 */
function eloDelta(m1, m2, s1, s2, umap) {
  const rA = avgRating(m1, umap);
  const rB = avgRating(m2, umap);
  const expected1 = expectedScore(rA, rB);
  const expected2 = 1 - expected1;
  const diff = Math.abs(s1 - s2);
  const weight = scoreWeight(diff);
  let delta1, delta2;
  if (s1 > s2) {
    delta1 = Math.max(Math.round(ELO_K * (1 - expected1) * weight), 1);
    delta2 = -delta1;
  } else {
    delta2 = Math.max(Math.round(ELO_K * (1 - expected2) * weight), 1);
    delta1 = -delta2;
  }
  return { delta1, delta2, expected1, expected2, rA, rB, weight };
}

/**
 * 应用评分：写 users.rating 与 rating_changes
 * 支持 db 或 transaction（两者 API 兼容）
 * @param {*} db  wx db 或 transaction
 * @param {*} umap 可选：预取的 {openid: user}，传入则不再重查 users（PERF-14）
 */
async function applyRating(db, activityId, matchId, m1, m2, s1, s2, cmd, umap) {
  if (!umap) {
    const allIds = m1.concat(m2);
    const usersRes = await db.collection('users').where({ openid: cmd.in(allIds) }).get();
    umap = {};
    (usersRes.data || []).forEach(u => { umap[u.openid] = u; });
  }

  const { delta1, delta2 } = eloDelta(m1, m2, s1, s2, umap);

  async function applyOne(ids, delta) {
    for (let k = 0; k < ids.length; k++) {
      const uid = ids[k];
      const before = ratingOf(umap[uid]);
      const after = before + delta;
      // PERF-14：复用 umap 中的 _id，不再逐个 where
      if (umap[uid] && umap[uid]._id) {
        // BUG-14: 用 _.inc(delta) 增量更新，避免并发覆盖
        await db.collection('users').doc(umap[uid]._id).update({ data: { rating: cmd.inc(delta) } });
      }
      await db.collection('rating_changes').add({
        data: {
          activityId: activityId,
          matchId: matchId,
          userId: uid,
          ratingBefore: before,
          ratingAfter: after,
          delta: delta,
          createdAt: (db.serverDate ? db.serverDate() : new Date())
        }
      });
    }
  }
  await applyOne(m1, delta1);
  await applyOne(m2, delta2);
}

module.exports = {
  RATING_BASE,
  RATING_PER_LEVEL,
  ELO_K,
  ELO_SPREAD,
  ELO_BONUS,
  ratingOfLevel,
  ratingOf,
  avgRating,
  expectedScore,
  scoreWeight,
  eloDelta,
  applyRating
};
