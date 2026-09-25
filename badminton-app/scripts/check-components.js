#!/usr/bin/env node
/**
 * 构建期组件校验（BUG-81）
 *
 * 扫描 miniprogram/pages/ 下所有 .wxml 中使用的自定义组件标签，
 * 对照同名页面 .json 的 usingComponents 声明：
 *   - wxml 用了组件但 json 未声明 → 错误（退出码 1，可用于 CI）
 *   - json 声明了组件但 wxml 未使用 → 警告（不算错误）
 *
 * 用法: node scripts/check-components.js
 * 退出码: 有错误 = 1；仅警告或无问题 = 0
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const PAGES_DIR = path.join(PROJECT_ROOT, 'miniprogram', 'pages');

/** 小程序内置标签（含带连字符的内置组件），不算自定义组件 */
const STANDARD_TAGS = new Set([
  'view', 'text', 'image', 'button', 'input', 'textarea', 'scroll-view',
  'swiper', 'swiper-item', 'navigator', 'picker', 'picker-view', 'switch',
  'slider', 'checkbox', 'checkbox-group', 'radio', 'radio-group', 'form',
  'label', 'block', 'template', 'import', 'include', 'wxs', 'canvas', 'video',
  'audio', 'map', 'web-view', 'rich-text', 'progress', 'icon', 'open-data',
  'official-account', 'ad', 'cover-view', 'cover-image'
]);

const TAG_RE = /<[/]?([a-zA-Z][a-zA-Z0-9-]*)/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** 自定义组件判定：标签名含 "-" 且不在内置标签表中 */
function isCustomComponent(tag) {
  return tag.includes('-') && !STANDARD_TAGS.has(tag);
}

/** 提取 wxml 文本中所有自定义组件标签名（去重，含开/闭标签） */
function extractCustomComponentTags(wxml) {
  const source = wxml.replace(COMMENT_RE, '');
  const found = new Set();
  let match;
  while ((match = TAG_RE.exec(source)) !== null) {
    const tag = match[1];
    if (isCustomComponent(tag)) found.add(tag);
  }
  return found;
}

/** 递归收集目录下所有 .wxml 文件 */
function listWxmlFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listWxmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.wxml')) {
      files.push(full);
    }
  }
  return files.sort();
}

/** 读取页面 json 的 usingComponents；返回 { declared: Set, error: string|null } */
function readUsingComponents(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    return { declared: new Set(), error: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return { declared: new Set(), error: `json 解析失败: ${e.message}` };
  }
  const using = parsed && parsed.usingComponents;
  if (using === undefined || using === null) {
    return { declared: new Set(), error: null };
  }
  if (typeof using !== 'object' || Array.isArray(using)) {
    return { declared: new Set(), error: 'usingComponents 不是对象' };
  }
  return { declared: new Set(Object.keys(using)), error: null };
}

/** 统一用正斜杠输出相对路径 */
function relPath(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

function main() {
  if (!fs.existsSync(PAGES_DIR)) {
    console.error(`[错误] 页面目录不存在: ${relPath(PAGES_DIR)}`);
    return 1;
  }

  const issues = []; // { level: 'error'|'warn', file, message }
  const wxmlFiles = listWxmlFiles(PAGES_DIR);

  for (const wxmlPath of wxmlFiles) {
    const jsonPath = wxmlPath.replace(/\.wxml$/, '.json');
    const wxmlText = fs.readFileSync(wxmlPath, 'utf8');
    const usedTags = extractCustomComponentTags(wxmlText);

    const { declared, error } = readUsingComponents(jsonPath);
    const wxmlRel = relPath(wxmlPath);
    const jsonRel = relPath(jsonPath);

    if (error) {
      issues.push({ level: 'error', file: jsonRel, message: error });
      continue;
    }

    for (const tag of [...usedTags].sort()) {
      if (!declared.has(tag)) {
        issues.push({
          level: 'error',
          file: wxmlRel,
          message: `使用了组件 <${tag}>，但 ${jsonRel} 的 usingComponents 中未声明`
        });
      }
    }

    for (const tag of [...declared].sort()) {
      if (!usedTags.has(tag)) {
        issues.push({
          level: 'warn',
          file: jsonRel,
          message: `usingComponents 声明了组件 <${tag}>，但 wxml 中未使用`
        });
      }
    }
  }

  let errorCount = 0;
  let warnCount = 0;
  for (const issue of issues) {
    const label = issue.level === 'error' ? '[错误]' : '[警告]';
    if (issue.level === 'error') errorCount += 1;
    else warnCount += 1;
    console.log(`${label} ${issue.file}: ${issue.message}`);
  }

  console.log(
    `汇总: ${errorCount} 个错误, ${warnCount} 个警告（共检查 ${wxmlFiles.length} 个页面 wxml）`
  );
  return errorCount > 0 ? 1 : 0;
}

process.exit(main());
