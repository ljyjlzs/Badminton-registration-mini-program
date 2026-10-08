#!/usr/bin/env node
/**
 * generate-manifest.js — 生成脱敏 cloudbaserc manifest（X-8 动作①）
 *
 * 从 badminton-app/cloudbaserc.json 生成 cloudbaserc.example.json：
 *   - 保留所有函数名、runtime、timeout、memorySize 等配置
 *   - envVariables 只保留键名，值替换为空字符串或 ${VAR_NAME} 占位符
 *
 * 用法：node scripts/generate-manifest.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'badminton-app', 'cloudbaserc.json');
const OUT_PATH = path.join(ROOT, 'badminton-app', 'cloudbaserc.example.json');

function main() {
  if (!fs.existsSync(SRC_PATH)) {
    console.error('[manifest] 错误：' + SRC_PATH + ' 不存在。先运行 inject-env.js。');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));

  // 脱敏处理：envVariables 值 → ${KEY_NAME} 占位符
  const sanitized = {
    ...config,
    functions: config.functions.map(fn => {
      const clean = { ...fn };
      if (clean.envVariables && Object.keys(clean.envVariables).length > 0) {
        const sanitizedEnv = {};
        for (const key of Object.keys(clean.envVariables)) {
          sanitizedEnv[key] = '${' + key + '}';
        }
        clean.envVariables = sanitizedEnv;
      } else {
        // 清空的 envVariables 不输出，保持清单精简
        delete clean.envVariables;
      }
      return clean;
    })
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(sanitized, null, 2) + '\n');

  const fnCount = sanitized.functions.length;
  const withEnv = sanitized.functions.filter(f => f.envVariables).length;
  console.log(`[manifest] 生成 ${OUT_PATH}`);
  console.log(`[manifest] ${fnCount} 个函数，其中 ${withEnv} 个含 envVariables 占位`);
}

main();
