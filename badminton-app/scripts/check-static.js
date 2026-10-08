#!/usr/bin/env node
/**
 * 五项静态检查（ENG-07）
 *
 * 1. WXML 语法       — 标签配对 / 自闭合 / 注释与 <wxs> 内容剥离后的结构校验
 * 2. require 路径     — 相对路径 require('...') 必须能解析到真实文件
 * 3. usingComponents — json 中组件路径必须存在（兼容 / 绝对路径与相对路径）
 * 4. JSON 格式       — 所有 .json 可被 JSON.parse
 * 5. JS 语法         — 逐文件 node --check（并发执行）
 *
 * 用法: node scripts/check-static.js
 * 退出码: 有错误 = 1；全部通过 = 0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const MINIPROGRAM_ROOT = path.join(PROJECT_ROOT, 'miniprogram');

/** 递归遍历时跳过的目录 */
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git']);

/** node --check 并发数 */
const SYNTAX_CONCURRENCY = 16;

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

/** 统一用正斜杠输出相对路径 */
function relPath(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

/** 递归收集目录下所有文件 */
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** 由字符下标求 1 行号 */
function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** 把区间替换成等长空白（保留换行），使下标/行号不漂移 */
function blankRange(text) {
  return text.replace(/[^\n]/g, ' ');
}

// ---------------------------------------------------------------------------
// 检查 1：WXML 语法（标签配对）
// ---------------------------------------------------------------------------

/** 剥离注释与 <wxs>…</wxs> 整段（wxs 内是 JS，可能含 < > 会干扰解析） */
function normalizeWxml(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, blankRange)
    .replace(/<wxs\b[^>]*>[\s\S]*?<\/wxs>/gi, blankRange);
}

/** 手写扫描器解析标签，避免正则在引号内 `>` 上失手 */
function parseWxmlTags(source) {
  const tags = [];
  const errors = [];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;
    const next = source[lt + 1];
    if (next === '!') {
      // doctype / 其它声明：跳到 >
      const gt = source.indexOf('>', lt);
      i = gt === -1 ? source.length : gt + 1;
      continue;
    }
    const isClose = next === '/';
    const nameStart = isClose ? lt + 2 : lt + 1;
    if (!isClose && !(next && /[a-zA-Z]/.test(next))) {
      i = lt + 1; // 文本中的孤立 '<'，跳过
      continue;
    }
    let j = nameStart;
    while (j < source.length && /[a-zA-Z0-9-]/.test(source[j])) j++;
    const name = source.slice(nameStart, j);
    if (!name) {
      errors.push({ index: lt, message: '标签名为空' });
      i = lt + 1;
      continue;
    }
    // 扫描属性区直到 '>'，处理引号与自闭合 />
    let selfClose = false;
    let quote = null;
    while (j < source.length) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      } else if (c === '/' && source[j + 1] === '>') {
        selfClose = true;
        break;
      }
      j++;
    }
    if (j >= source.length) {
      errors.push({ index: lt, message: `标签 <${name}> 缺少 '>'` });
      break;
    }
    tags.push({ name, close: isClose, selfClose, index: lt });
    i = j + 1;
  }
  return { tags, errors };
}

/** WXML 结构校验：返回 { file, line, message }[] */
function checkWxml(file, raw) {
  const issues = [];
  const source = normalizeWxml(raw);
  const { tags, errors } = parseWxmlTags(source);
  for (const e of errors) {
    issues.push({ file, line: lineOf(source, e.index), message: e.message });
  }
  const stack = [];
  for (const t of tags) {
    if (t.close) {
      if (stack.length === 0) {
        issues.push({ file, line: lineOf(source, t.index), message: `多余的结束标签 </${t.name}>` });
      } else {
        const open = stack.pop();
        if (open.name !== t.name) {
          issues.push({
            file,
            line: lineOf(source, t.index),
            message: `标签不匹配: <${open.name}>（第 ${open.line} 行）被 </${t.name}> 关闭`
          });
        }
      }
    } else if (!t.selfClose) {
      stack.push({ name: t.name, line: lineOf(source, t.index) });
    }
  }
  for (const open of stack) {
    issues.push({ file, line: open.line, message: `未闭合标签 <${open.name}>` });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 检查 2：require 相对路径存在
// ---------------------------------------------------------------------------

/** 剥离 JS 注释（保留字符串字面量，require 路径在里面） */
function blankJsComments(source) {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, blankRange);
  return noBlock.replace(/(^|[^:'"])\/\/[^\n]*/g, (m, prefix) => prefix + ' '.repeat(m.length - prefix.length));
}

const REQUIRE_RE = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

/** 目标文件存在性（含省略扩展名 / 目录 index 的解析） */
function resolveModule(fromFile, reqPath) {
  const base = path.resolve(path.dirname(fromFile), reqPath);
  const candidates = [
    base,
    base + '.js',
    base + '.json',
    base + '.wxs',
    path.join(base, 'index.js'),
    path.join(base, 'index.json')
  ];
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

function checkRequirePaths(file, raw) {
  const issues = [];
  const source = blankJsComments(raw);
  let m;
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(source)) !== null) {
    const reqPath = m[2];
    if (!reqPath.startsWith('.')) continue; // 仅校验相对路径；npm 包/内置模块跳过
    if (!resolveModule(file, reqPath)) {
      issues.push({
        file,
        line: lineOf(source, m.index),
        message: `require 路径不存在: '${reqPath}'`
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 检查 3 + 4：usingComponents 路径存在、JSON 格式
// ---------------------------------------------------------------------------

/** usingComponents 目标存在性（微信按无扩展名基名解析 .js/.json/.wxml） */
function resolveComponent(jsonPath, compPath) {
  const base = compPath.startsWith('/')
    ? path.join(MINIPROGRAM_ROOT, compPath.slice(1))
    : path.resolve(path.dirname(jsonPath), compPath);
  const candidates = [
    base + '.js',
    base + '.json',
    base + '.wxml',
    base,
    path.join(base, 'index.js')
  ];
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

function checkJson(file, raw) {
  const issues = [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    issues.push({ file, line: 1, message: `JSON 格式错误: ${e.message}` });
    return { issues, parsed: null };
  }
  const using = parsed && typeof parsed === 'object' ? parsed.usingComponents : null;
  if (using !== undefined && using !== null) {
    if (typeof using !== 'object' || Array.isArray(using)) {
      issues.push({ file, line: 1, message: 'usingComponents 不是对象' });
    } else {
      for (const tag of Object.keys(using)) {
        const compPath = using[tag];
        if (typeof compPath !== 'string' || !compPath) {
          issues.push({ file, line: 1, message: `usingComponents['${tag}'] 路径为空或非字符串` });
        } else if (!resolveComponent(file, compPath)) {
          issues.push({ file, line: 1, message: `usingComponents 路径不存在: '${compPath}'（组件 <${tag}>）` });
        }
      }
    }
  }
  return { issues, parsed };
}

// ---------------------------------------------------------------------------
// 检查 5：JS 语法（node --check，并发）
// ---------------------------------------------------------------------------

function checkJsSyntax(files) {
  return new Promise((resolve) => {
    if (files.length === 0) {
      resolve([]);
      return;
    }
    const results = [];
    let nextIndex = 0;
    let inFlight = 0;
    let finished = 0;

    function pump() {
      while (inFlight < SYNTAX_CONCURRENCY && nextIndex < files.length) {
        const file = files[nextIndex++];
        inFlight++;
        let settled = false;
        const child = spawn(process.execPath, ['--check', file], { windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d; });
        const settle = (error) => {
          if (settled) return;
          settled = true;
          results.push({ file, error });
          inFlight--;
          done();
        };
        child.on('error', (e) => settle('node --check 无法执行: ' + e.message));
        child.on('close', (code) => settle(code === 0 ? null : condenseSyntaxError(stderr)));
      }
    }
    function done() {
      finished++;
      if (finished === files.length) {
        results.sort((a, b) => relPath(a.file).localeCompare(relPath(b.file)));
        resolve(results);
      } else {
        pump();
      }
    }
    pump();
  });
}

/** 把 node --check 的多行 stderr 压成一行 */
function condenseSyntaxError(stderr) {
  const lines = String(stderr).split('\n').map((l) => l.trim()).filter(Boolean);
  const errLine = lines.find((l) => /Error/.test(l)) || lines[lines.length - 1] || '语法错误';
  const loc = lines[0] && lines[0].includes(':') ? lines[0] + ': ' : '';
  return 'node --check 失败: ' + loc + errLine;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const allFiles = walk(PROJECT_ROOT, []);
  const wxmlFiles = [];
  const jsFiles = [];
  const jsonFiles = [];
  for (const f of allFiles) {
    if (f.endsWith('.wxml')) wxmlFiles.push(f);
    else if (f.endsWith('.js')) jsFiles.push(f);
    else if (f.endsWith('.json')) jsonFiles.push(f);
  }
  wxmlFiles.sort();
  jsFiles.sort();
  jsonFiles.sort();

  const issues = []; // { check, file, line, message }
  const counts = {
    wxml: { label: 'WXML 语法', n: wxmlFiles.length, errors: 0 },
    require: { label: 'require 路径', n: jsFiles.length, errors: 0 },
    usingComponents: { label: 'usingComponents', n: 0, errors: 0 },
    json: { label: 'JSON 格式', n: jsonFiles.length, errors: 0 },
    syntax: { label: 'JS 语法', n: jsFiles.length, errors: 0 }
  };

  // 1. WXML 语法
  for (const f of wxmlFiles) {
    for (const issue of checkWxml(f, fs.readFileSync(f, 'utf8'))) {
      issues.push({ check: 'wxml', ...issue });
      counts.wxml.errors++;
    }
  }

  // 2. require 路径
  for (const f of jsFiles) {
    for (const issue of checkRequirePaths(f, fs.readFileSync(f, 'utf8'))) {
      issues.push({ check: 'require', ...issue });
      counts.require.errors++;
    }
  }

  // 3 + 4. JSON 格式 / usingComponents
  for (const f of jsonFiles) {
    const raw = fs.readFileSync(f, 'utf8');
    if (raw.includes('usingComponents')) counts.usingComponents.n++;
    const { issues: jsonIssues } = checkJson(f, raw);
    for (const issue of jsonIssues) {
      const isUsing = issue.message.startsWith('usingComponents');
      const check = isUsing ? 'usingComponents' : 'json';
      issues.push({ check, ...issue });
      if (isUsing) counts.usingComponents.errors++;
      else counts.json.errors++;
    }
  }

  // 5. JS 语法（node --check）
  const syntaxResults = await checkJsSyntax(jsFiles);
  for (const r of syntaxResults) {
    if (r.error) {
      issues.push({ check: 'syntax', file: r.file, line: 1, message: r.error });
      counts.syntax.errors++;
    }
  }

  // 输出
  issues.sort((a, b) => relPath(a.file).localeCompare(relPath(b.file)) || a.line - b.line);
  for (const issue of issues) {
    console.log(`[错误] ${relPath(issue.file)}:${issue.line} [${counts[issue.check].label}] ${issue.message}`);
  }

  const totalErrors = issues.length;
  const summary = Object.keys(counts)
    .map((k) => `${counts[k].label} ${counts[k].errors}/${counts[k].n}`)
    .join('，');
  console.log(`汇总: ${totalErrors} 个错误（${summary}）`);
  return totalErrors > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
