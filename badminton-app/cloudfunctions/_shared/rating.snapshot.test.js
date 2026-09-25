/**
 * ARCH-02 评分引擎快照对拍验证
 * 运行：node _shared/rating.snapshot.test.js
 * 原实现取自 submit-score/index.js 原 applyRating（1000+(lvl-5)*80 / K=32 / spread=15 / bonus=0.3）
 */
const assert = require('assert');
const rating = require('./rating');

// ---- 原实现（冻结，用于对拍）----
function legacyEloDelta(m1, m2, s1, s2, umap) {
  function ratingOf(uid) {
    var u = umap[uid];
    if (u && u.rating != null) return u.rating;
    var lvl = (u && u.level) || 5;
    return 1000 + (lvl - 5) * 80;
  }
  function avg(ids) {
    if (!ids.length) return 1200;
    var s = 0;
    ids.forEach(function(id) { s += ratingOf(id); });
    return s / ids.length;
  }
  var rA = avg(m1), rB = avg(m2);
  var expected1 = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  var expected2 = 1 - expected1;
  var diff = Math.abs(s1 - s2);
  var weight = 1 + Math.min(diff, 15) / 15 * 0.3;
  var delta1, delta2;
  if (s1 > s2) {
    delta1 = Math.max(Math.round(32 * (1 - expected1) * weight), 1);
    delta2 = -delta1;
  } else {
    delta2 = Math.max(Math.round(32 * (1 - expected2) * weight), 1);
    delta1 = -delta2;
  }
  return { delta1: delta1, delta2: delta2 };
}

// ---- 测试用例覆盖主要分支 ----
const cases = [
  { name: '同水平 21:15', m1: ['a', 'b'], m2: ['c', 'd'], s1: 21, s2: 15,
    umap: { a: { rating: 1000 }, b: { rating: 1000 }, c: { rating: 1000 }, d: { rating: 1000 } } },
  { name: '高分胜 21:19', m1: ['a'], m2: ['b'], s1: 21, s2: 19,
    umap: { a: { rating: 1500 }, b: { rating: 1100 } } },
  { name: '高分负 15:21', m1: ['a'], m2: ['b'], s1: 15, s2: 21,
    umap: { a: { rating: 1500 }, b: { rating: 1100 } } },
  { name: '无 rating 用 level', m1: ['x'], m2: ['y'], s1: 30, s2: 0,
    umap: { x: { level: 8 }, y: { level: 3 } } },
  { name: '平局被上层拦截后 fallback 保底', m1: ['a'], m2: ['b'], s1: 21, s2: 20,
    umap: { a: { rating: 2000 }, b: { rating: 800 } } },
  { name: '空队伍极端', m1: ['a'], m2: [], s1: 21, s2: 0,
    umap: { a: { rating: 1000 } } },
  { name: '分差 30 权重上限', m1: ['a'], m2: ['b'], s1: 30, s2: 0,
    umap: { a: { rating: 1000 }, b: { rating: 1000 } } }
];

let passed = 0;
for (const c of cases) {
  const legacy = legacyEloDelta(c.m1, c.m2, c.s1, c.s2, c.umap);
  const neu = rating.eloDelta(c.m1, c.m2, c.s1, c.s2, c.umap);
  assert.strictEqual(neu.delta1, legacy.delta1, c.name + ' delta1 不一致: ' + neu.delta1 + ' vs ' + legacy.delta1);
  assert.strictEqual(neu.delta2, legacy.delta2, c.name + ' delta2 不一致: ' + neu.delta2 + ' vs ' + legacy.delta2);
  // 单调性：胜负绝对值一致
  assert.strictEqual(Math.abs(neu.delta1), Math.abs(neu.delta2), c.name + ' 应为零和');
  passed++;
  console.log('OK', c.name, 'delta1=' + neu.delta1, 'delta2=' + neu.delta2);
}

// ratingOfLevel 参数化检查
assert.strictEqual(rating.ratingOfLevel(5), 1000);
assert.strictEqual(rating.ratingOfLevel(9), 1320);
assert.strictEqual(rating.ratingOfLevel(1), 680);
assert.strictEqual(rating.ratingOfLevel(null), 1000);
assert.strictEqual(rating.RATING_BASE, 1000);
assert.strictEqual(rating.RATING_PER_LEVEL, 80);
assert.strictEqual(rating.ELO_K, 32);
assert.strictEqual(rating.ELO_SPREAD, 15);
assert.strictEqual(rating.ELO_BONUS, 0.3);

console.log('ARCH-02 快照对拍通过: ' + passed + ' 例，delta 全一致');
