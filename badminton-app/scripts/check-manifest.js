#!/usr/bin/env node
/**
 * cloudbaserc 双清单一致性校验（ENG-09）
 *
 * 对比根 cloudbaserc.json 与 cloudfunctions/cloudbaserc.json 的函数名集合：
 *   - 不一致 → 输出差异（仅在根 / 仅在 cloudfunctions）并以退出码 1 结束
 *   - 一致   → 输出函数条数并以退出码 0 结束
 *
 * 用法: node scripts/check-manifest.js
 * 退出码: 两份清单一致 = 0；存在差异 = 1
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const ROOT_MANIFEST = path.join(PROJECT_ROOT, 'cloudbaserc.json');
const SUB_MANIFEST = path.join(PROJECT_ROOT, 'cloudfunctions', 'cloudbaserc.json');

/**
 * 读取清单的函数名集合与列表（保持出现顺序）
 * 兼容 functions 为数组或对象映射两种写法。
 */
function loadNames(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const json = JSON.parse(raw);
  const list = Array.isArray(json.functions)
    ? json.functions
    : Object.values(json.functions || {});

  const names = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name : null;
    if (name) names.push(name);
  }
  return names;
}

function relPath(absPath) {
  return path.relative(PROJECT_ROOT, absPath).split(path.sep).join('/');
}

function main() {
  for (const p of [ROOT_MANIFEST, SUB_MANIFEST]) {
    if (!fs.existsSync(p)) {
      console.log(`[错误] 清单文件不存在: ${relPath(p)}`);
      return 1;
    }
  }

  let rootNames;
  let subNames;
  try {
    rootNames = loadNames(ROOT_MANIFEST);
    subNames = loadNames(SUB_MANIFEST);
  } catch (err) {
    console.log(`[错误] 清单解析失败: ${err.message}`);
    return 1;
  }

  const rootSet = new Set(rootNames);
  const subSet = new Set(subNames);
  const onlyInRoot = rootNames.filter((n) => !subSet.has(n)).sort();
  const onlyInSub = subNames.filter((n) => !rootSet.has(n)).sort();

  if (onlyInRoot.length > 0) {
    console.log(
      `[差异] ${relPath(SUB_MANIFEST)} 缺少 ${onlyInRoot.length} 个（仅在 ${relPath(ROOT_MANIFEST)}）: ` +
        onlyInRoot.join(', ')
    );
  }
  if (onlyInSub.length > 0) {
    console.log(
      `[差异] ${relPath(SUB_MANIFEST)} 多出 ${onlyInSub.length} 个（不在 ${relPath(ROOT_MANIFEST)}）: ` +
        onlyInSub.join(', ')
    );
  }

  if (onlyInRoot.length > 0 || onlyInSub.length > 0) {
    console.log(`汇总: 两份清单不一致（根 ${rootSet.size} 条 / cloudfunctions ${subSet.size} 条）`);
    return 1;
  }

  console.log(`清单一致: ${rootSet.size} 个函数（${relPath(ROOT_MANIFEST)} == ${relPath(SUB_MANIFEST)}）`);
  return 0;
}

process.exit(main());
