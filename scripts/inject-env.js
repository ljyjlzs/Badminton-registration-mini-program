#!/usr/bin/env node
/**
 * inject-env.js — 密钥外部注入链路（X-8 动作②）
 *
 * 读取根 .env 文件，将环境变量注入到 badminton-app/cloudbaserc.json 的
 * 各函数 envVariables 字段，使 tcb fn deploy 能正确传递线上 env。
 *
 * 用法：node scripts/inject-env.js
 * 前置：根目录 .env 已配置（参见 .env.example）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const CLAUDEDBASERC_PATH = path.join(ROOT, 'badminton-app', 'cloudbaserc.json');

function parseEnv(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key) env[key] = val;
  }
  return env;
}

function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('[inject-env] 错误：根目录 .env 不存在。请复制 .env.example 为 .env 并填入真实值。');
    process.exit(1);
  }

  const env = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
  const config = JSON.parse(fs.readFileSync(CLAUDEDBASERC_PATH, 'utf8'));

  // 每个函数需要的 env 键映射
  const FN_ENV_MAP = {
    'ai-chat': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH'],
    'ai-history': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH'],
    'generate-copy': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH'],
    'invite': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH'],
    'parse-activity': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH'],
    'photo-ai-note': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH', 'AI_VISION_MODEL'],
    'recommend-time': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH'],
    'rules-qa': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH'],
    'match-reminders': ['MATCH_REMINDER_TEMPLATE_ID'],
    'match-live-score': ['LIVE_SCORE_TEMPLATE_ID'],
    'voice-score-parse': ['TENCENT_ASR_SECRET_ID', 'TENCENT_ASR_SECRET_KEY'],
    'get-user-stats': ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_PATH', 'TENCENT_ASR_SECRET_ID', 'TENCENT_ASR_SECRET_KEY'],
    'weather': ['AMAP_KEY'],
  };

  // AI_VISION_MODEL 默认使用 mimo-v2.6-pro（AI-24）
  if (!env.AI_VISION_MODEL) env.AI_VISION_MODEL = 'mimo-v2.6-pro';

  let injected = 0;
  let skipped = 0;

  config.functions.forEach(fn => {
    const keys = FN_ENV_MAP[fn.name];
    if (!keys) return;

    const envVariables = {};
    for (const key of keys) {
      if (env[key] && env[key] !== '') {
        envVariables[key] = env[key];
        injected++;
      } else {
        skipped++;
        if (!['MATCH_REMINDER_TEMPLATE_ID', 'LIVE_SCORE_TEMPLATE_ID'].includes(key)) {
          console.warn(`[inject-env] ⚠ ${fn.name}.${key} 在 .env 中为空，跳过`);
        }
      }
    }
    fn.envVariables = envVariables;
  });

  fs.writeFileSync(CLAUDEDBASERC_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log(`[inject-env] 完成：注入 ${injected} 个 env 键，跳过 ${skipped} 个（含可选键）`);
  console.log(`[inject-env] 目标：${CLAUDEDBASERC_PATH}`);
}

main();
