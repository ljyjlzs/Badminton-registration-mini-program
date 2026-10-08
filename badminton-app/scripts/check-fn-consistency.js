#!/usr/bin/env node
/**
 * cloudbaserc 双清单一致性检查（ENG-02）
 *
 * 对比根 cloudbaserc.json 与 cloudfunctions/cloudbaserc.json 的函数清单：
 *   - 条目集合不相等（子清单缺失 / 多余）→ 错误
 *   - 同名函数 timeout 不一致 → 错误
 *   - 条目缺 name / timeout / runtime → 错误
 *
 * 用法: node scripts/check-fn-consistency.js
 * 退出码: 有错误 = 1；两份清单一致 = 0
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const ROOT_MANIFEST = path.join(PROJECT_ROOT, 'cloudbaserc.json');
const SUB_MANIFEST = path.join(PROJECT_ROOT, 'cloudfunctions', 'cloudbaserc.json');

/**
 * 读取清单并归一化为 Map<name, {timeout, runtime, installDependency}>
 * 兼容 functions 为数组或对象映射两种写法。
 */
function loadFunctions(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const json = JSON.parse(raw);
  const list = Array.isArray(json.functions)
    ? json.functions
    : Object.values(json.functions || {});

  const byName = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name : null;
    if (!name) continue;
    byName.set(name, {
      timeout: entry.timeout,
      runtime: entry.runtime,
      installDependency: entry.installDependency
    });
  }
  return byName;
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

  let rootFns;
  let subFns;
  try {
    rootFns = loadFunctions(ROOT_MANIFEST);
    subFns = loadFunctions(SUB_MANIFEST);
  } catch (err) {
    console.log(`[错误] 清单解析失败: ${err.message}`);
    return 1;
  }

  const issues = [];

  // 1. 条目集合差集：缺失 / 多余
  const onlyInRoot = [...rootFns.keys()].filter((n) => !subFns.has(n)).sort();
  const onlyInSub = [...subFns.keys()].filter((n) => !rootFns.has(n)).sort();

  if (onlyInRoot.length > 0) {
    issues.push({
      level: 'error',
      message: `子清单缺失 ${onlyInRoot.length} 个（仅在根 ${relPath(ROOT_MANIFEST)}）: ${onlyInRoot.join(', ')}`
    });
  }
  if (onlyInSub.length > 0) {
    issues.push({
      level: 'error',
      message: `子清单多余 ${onlyInSub.length} 个（不在根 ${relPath(ROOT_MANIFEST)}）: ${onlyInSub.join(', ')}`
    });
  }

  // 2. 同名函数 timeout / runtime 一致性
  for (const name of [...rootFns.keys()].sort()) {
    const root = rootFns.get(name);
    const sub = subFns.get(name);
    if (!sub) continue;

    if (root.timeout !== sub.timeout) {
      issues.push({
        level: 'error',
        message: `timeout 不一致: ${name}（根 ${root.timeout} / 子 ${sub.timeout}）`
      });
    }
    for (const [label, fn, field] of [
      ['根', root, 'timeout'],
      ['根', root, 'runtime'],
      ['子', sub, 'timeout'],
      ['子', sub, 'runtime']
    ]) {
      if (fn[field] === undefined || fn[field] === null || fn[field] === '') {
        issues.push({
          level: 'error',
          message: `${label}清单条目缺 ${field}: ${name}`
        });
      }
    }
  }

  let errorCount = 0;
  for (const issue of issues) {
    errorCount += 1;
    console.log(`[错误] ${issue.message}`);
  }

  console.log(
    `汇总: ${errorCount} 个错误（根 ${rootFns.size} 条 / 子 ${subFns.size} 条；` +
      `集合一致 = ${onlyInRoot.length === 0 && onlyInSub.length === 0}）`
  );
  return errorCount > 0 ? 1 : 0;
}

process.exit(main());
