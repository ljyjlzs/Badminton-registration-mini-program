/**
 * AI-43: parseScoreText 多局比分解析测试
 * 运行：node test-regex.js
 */
const assert = require('assert');
const { parseScoreText } = require('./index.js');

// 1) 实测场景：多局比分（带队名），应解析出 2 局（旧正则只出第一局）
const multi = parseScoreText('张三 李四 21:19 王五 赵六 15:21');
assert.strictEqual(multi.length, 2, '多局比分应解析出 2 局，实际：' + multi.length);
assert.strictEqual(multi[0].scoreA, 21, '第 1 局 team1Score');
assert.strictEqual(multi[0].scoreB, 19, '第 1 局 team2Score');
assert.strictEqual(multi[0].teamA, '张三李四', '第 1 局 teamA');
assert.strictEqual(multi[0].teamB, '王五赵六', '第 1 局 teamB');
assert.strictEqual(multi[1].scoreA, 15, '第 2 局 team1Score');
assert.strictEqual(multi[1].scoreB, 21, '第 2 局 team2Score');

// 2) 复现审计用例：A队21比15B队21比18B队 → 2 局
const audit = parseScoreText('A队21比15B队21比18B队');
assert.strictEqual(audit.length, 2, '审计用例应解析出 2 局，实际：' + audit.length);
assert.strictEqual(audit[0].scoreA, 21);
assert.strictEqual(audit[0].scoreB, 15);
assert.strictEqual(audit[1].scoreA, 21);
assert.strictEqual(audit[1].scoreB, 18);

// 3) 分隔符必须显式存在：纯数字串不误配
assert.strictEqual(parseScoreText('1234').length, 0, '无显式分隔符不应解析出比分');
assert.strictEqual(parseScoreText('21 19').length, 0, '空格不是分隔符，不应解析出比分');

// 4) 三种分隔符（比 / 全角冒号 / 半角冒号）都支持
const cn = parseScoreText('A队21比15B队');
assert.strictEqual(cn.length, 1);
assert.strictEqual(cn[0].teamA, 'A队');
assert.strictEqual(cn[0].scoreA, 21);
assert.strictEqual(cn[0].scoreB, 15);
assert.strictEqual(cn[0].teamB, 'B队');

const full = parseScoreText('A队21：15B队');
assert.strictEqual(full.length, 1, '全角冒号分隔');
assert.strictEqual(full[0].scoreA, 21);

const half = parseScoreText('A队21:15B队');
assert.strictEqual(half.length, 1, '半角冒号分隔');
assert.strictEqual(half[0].scoreB, 15);

// 5) 队名可选（裸比分）
const bare = parseScoreText('21:19 15:21');
assert.strictEqual(bare.length, 2, '无队名多局比分应全部识别');
assert.strictEqual(bare[0].scoreA, 21);
assert.strictEqual(bare[0].scoreB, 19);
assert.strictEqual(bare[1].scoreA, 15);
assert.strictEqual(bare[1].scoreB, 21);

// 6) 比分越界不收
assert.strictEqual(parseScoreText('A31比15B').length, 0, '比分超过 30 应丢弃');

console.log('test-regex.js 全部断言通过');
