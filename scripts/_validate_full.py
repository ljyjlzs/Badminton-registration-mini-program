# -*- coding: utf-8 -*-
"""交接文档严格校验：围栏/密钥/表格/占位符/链接/交叉引用。"""
import io, re, json, os, sys

# Windows 控制台默认 GBK，打印 🔴 等字符会 UnicodeEncodeError 中断整个校验
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

DOC = '开发交接清单-问题统计与优化建议.md'
txt = io.open(DOC, encoding='utf-8').read()
lines = txt.split('\n')
fails, warns = [], []

# ---------- 1. 代码围栏配对 ----------
fence_lines = [i + 1 for i, l in enumerate(lines) if l.strip().startswith('```')]
if len(fence_lines) % 2 != 0:
    fails.append('代码围栏不配对：共 %d 个 ``` 标记' % len(fence_lines))
# 行内三反引号（破坏表格的元凶）
bad_inline = []
for i, l in enumerate(lines, 1):
    if l.lstrip().startswith('```'):
        continue
    if l.count('```') > 0 and not l.strip().startswith('```'):
        bad_inline.append(i)
if bad_inline:
    fails.append('行内出现三反引号（会破坏表格）：行 %s' % bad_inline[:10])

# ---------- 2. 密钥泄漏 ----------
# 采集 cloudbaserc 全部 envVariables，排除已知非敏感键（URL / 模型名），
# 其余长度足够的值一律视为潜在密钥——否则新加的键（如 AMAP_KEY）永远扫不到。
NON_SENSITIVE_ENV = {'AI_BASE_URL', 'AI_MODEL', 'AMAP_URL'}
_secret_by_key = {}   # 键名 -> 值集合
for root, dirs, files in os.walk('badminton-app/cloudfunctions'):
    for fn in files:
        if fn.endswith('cloudbaserc.json'):
            try:
                j = json.load(io.open(os.path.join(root, fn), encoding='utf-8'))
            except Exception:
                continue
            for fnc in (j.get('functions') or []):
                for k, v in (fnc.get('envVariables') or {}).items():
                    if k in NON_SENSITIVE_ENV:
                        continue
                    v = str(v or '')
                    if len(v) > 10:
                        _secret_by_key.setdefault(k, set()).add(v)
secrets = set().union(*_secret_by_key.values()) if _secret_by_key else set()
hits = [s for s in secrets if s in txt]
if hits:
    _hit_keys = sorted({k for k, vs in _secret_by_key.items() for s in hits if s in vs})
    fails.append('密钥明文泄漏 %d 处（键名 %s）' % (len(hits), _hit_keys))
# 通用密钥形态
for pat, name in [(r'sk-[A-Za-z0-9]{20,}', 'sk-密钥'),
                  (r'AKID[A-Za-z0-9]{20,}', '腾讯云 AKID'),
                  (r'mimo-[A-Za-z0-9]{16,}', 'mimo 密钥')]:
    m = re.findall(pat, txt)
    if m:
        fails.append('疑似%s泄漏：%s' % (name, m[:3]))

# ---------- 3. 表格结构 ----------
def cells(row):
    # 去掉首尾空管道，再按未转义竖线切
    r = row.strip()
    # 先剔除行内代码段：单元格里常见的 d.content || d.reply 含 |，
    # 不剔除会被当成列分隔符，制造假的「列数不一致」。
    r = re.sub(r'`[^`]*`', '', r)
    if r.startswith('|'): r = r[1:]
    if r.endswith('|'): r = r[:-1]
    # 生成器已把内容里的裸竖线转义成 \|；转义竖线是内容，不是列分隔符
    return re.split(r'(?<!\\)\|', r)

bad_tbl = []
in_tbl = False
hdr_n = 0
for i, l in enumerate(lines, 1):
    s = l.strip()
    if s.startswith('|'):
        n = len(cells(s))
        if not in_tbl:
            in_tbl = True
            hdr_n = n
        elif set(s) <= set('|-: '):
            if n != hdr_n:
                bad_tbl.append((i, n, hdr_n, '分隔行'))
        elif n != hdr_n:
            bad_tbl.append((i, n, hdr_n, s[:60]))
    else:
        in_tbl = False
        hdr_n = 0
if bad_tbl:
    fails.append('表格列数不一致 %d 处，前 5：' % len(bad_tbl))
    for b in bad_tbl[:5]:
        warns.append('   行%d 实际%d列 应为%d列 %s' % b)

# ---------- 4. Python/占位残留 ----------
# dev=None 之类来自 package-lock 字段缺失的转述已由生成器修正，此处兜底再查
for pat, name in [(r'\bdatetime\.datetime\(', 'datetime残留'), (r'OrderedDict\(', 'OrderedDict残留'),
                  (r'\bset\(\)\b', 'set()残留'), (r'\bnan\b', 'nan残留'),
                  (r'\$\{[a-z_]+\}', '模板变量未展开'), (r'None', 'None残留')]:
    m = [i + 1 for i, l in enumerate(lines) if re.search(pat, l)]
    if m:
        # None 只在疑似 Python 语境（=None 且非 lock 字段）时判 FAIL，否则降级 WARN
        if name == 'None残留':
            hard = [i for i in m if re.search(r'\bNone\b(?!\s*字段)', lines[i - 1])
                    and not re.search(r'(字段未声明|package-lock|lock\s*file|dev|optional|peer)', lines[i - 1])]
            if hard:
                fails.append('疑似 %s 残留于行 %s' % (name, hard[:8]))
            elif m:
                warns.append('出现 None 字样于行 %s（已确认为 lock 字段引用或已修正）' % m[:5])
            continue
        if name == '模板变量未展开':
            continue  # 上面已按上下文单独判断
        if name == 'nan残留':
            if [i for i in m if not re.search(r'NaN|nanodev|nano', lines[i - 1])]:
                fails.append('%s 残留于行 %s' % (name, m[:8]))
            continue
        fails.append('%s 残留于行 %s' % (name, m[:8]))

# 未展开的 JS 模板串：只在「非代码行且不在围栏内」才告警；
# 本项目里 `${...}` 出现在 JS/WXML 代码引用中属正常，需人工确认上下文
js_var = []
_in_fence = False
for i, l in enumerate(lines, 1):
    if l.lstrip().startswith('```'):
        _in_fence = not _in_fence
        continue
    if _in_fence or '${' not in l:
        continue
    for m in re.findall(r'\$\{[a-zA-Z_]+\}', l):
        # 合法上下文：在反引号代码片段里 / 等号右侧 / 字符串字面量里
        ctx = l[max(0, l.find(m) - 40):l.find(m)]
        if '`' in ctx or '=' in ctx or "'" in ctx or '/' in ctx:
            continue
        js_var.append(i)
if js_var:
    warns.append('${...} 出现在疑似未展开模板的行 %s（需人工确认）' % sorted(set(js_var))[:5])

# ---------- 5. 链接目标存在 ----------
links = re.findall(r'\]\(([^)]+\.md)\)', txt)
missing = [l for l in set(links) if not os.path.exists(l.replace('%20', ' '))]
if missing:
    fails.append('链接目标不存在：%s' % missing)

# ---------- 6. 关键数字自洽 ----------
checks = [
    ('143 条问题', txt.count('143') >= 5),
    ('优化 113', '113' in txt),
    ('驳回 24', '24' in txt),
    ('分档合计 35/47/61', all(str(x) in txt for x in (35, 47, 61))),
]
for name, ok in checks:
    if not ok:
        fails.append('数字自洽失败：%s' % name)

# ---------- 7. 章节完整性 ----------
for sec in ['## 一、问题总体统计', '## 二、问题逐条索引', '## 三、优化建议总览',
            '## 四、优化建议 ROI 总表', '## 五、优化建议明细', '## 六、对抗验证驳回项',
            '## 七、检查过确认', '## 八、总体执行排期', '## 九、验收方式',
            '## 十、完整性复核补遗（本轮新增，与 1–9 章同级）']:
    if sec not in txt:
        fails.append('缺少章节：%s' % sec)

# 7b. 第十章不是空壳：真漏报条目与三条报告缺陷必须真的写进去
#     （只查标题存在是空转校验——章节被清空也会 PASS）
_s10 = txt.find('## 十、完整性复核补遗')
if _s10 < 0:
    fails.append('第十章不存在，补遗内容无处安放')
else:
    _body10 = txt[_s10:]
    for _needle, _why in (
        ('grouping.wxml', '真漏报条目 grouping.wxml:67'),
        ('DOC-SEC-02', '密钥泄漏面 DOC-SEC-02'),
        ('DOC-CONFLICT-01', '报告自相矛盾 DOC-CONFLICT-01'),
        ('MIMO_API_KEY', '进了 git 历史的 MIMO_API_KEY'),
        ('1945480', '换钥匙提交 1945480'),
        ('debug-comprehensive-test', '零覆盖 debug 云函数清单'),
        ('weather', '带 AMAP_KEY 的未覆盖 cloudbaserc'),
        ('隐私', '隐私合规维度缺口'),
        ('完整清单', '本章定位声明'),
    ):
        if _needle not in _body10:
            fails.append('第十章缺少%s（%s）' % (_why, _needle))
    if _body10.count('\n') < 80:
        fails.append('第十章过短（%d 行），疑似未真正生成'
                     % _body10.count('\n'))

# ---------- 8. 条目计数 ----------
opt_heads = re.findall(r'^### \d+\. \[', txt, re.M)
if len(opt_heads) != 113:
    fails.append('优化明细条目数 = %d，应为 113' % len(opt_heads))
# 索引只统计「二、逐条索引」段（1.6 严重速览表也用同样编号，会被误计）
_s = txt.find('## 二、问题逐条索引')
_e = txt.find('## 三、优化建议总览')
idx_sec = txt[_s:_e]
bug_rows = re.findall(r'^\| (?:BUG|AI)-\d+ \|', idx_sec, re.M)
if len(bug_rows) != 143:
    fails.append('问题索引行数 = %d，应为 143' % len(bug_rows))
# 1.6 速览表应为 5 条严重
_s16 = txt.find('### 1.6')
_s2 = txt.find('## 二、')
sev_rows = re.findall(r'^\| (?:BUG|AI)-\d+ \|', txt[_s16:_s2], re.M)
if len(sev_rows) != 5:
    fails.append('1.6 严重速览行数 = %d，应为 5' % len(sev_rows))
# 驳回表计数
sec_start = txt.find('## 六、对抗验证驳回项')
sec_end = txt.find('## 七、')
rej_sec = txt[sec_start:sec_end]
rej_n = len(re.findall(r'^\| \d+ \|', rej_sec, re.M))
if rej_n != 24:
    fails.append('驳回条目 = %d，应为 24' % rej_n)

# ---------- 9. 优化编号唯一性（防 10 路审计各自从 -01 编起） ----------
_s4 = txt.find('## 四、'); _e4 = txt.find('## 五、')
roi_ids = re.findall(r'^\| \d+ \| `([A-Z]+-\d+)`', txt[_s4:_e4], re.M)
if len(roi_ids) != 113:
    fails.append('ROI 表编号行数 = %d，应为 113' % len(roi_ids))
_dup = sorted({k for k in roi_ids if roi_ids.count(k) > 1})
if _dup:
    fails.append('优化编号重复 %d 个：%s' % (len(_dup), _dup))
_s5 = txt.find('## 五、'); _e5 = txt.find('## 六、')
det_ids = re.findall(r'^### \d+\. \[([A-Z]+-\d+)', txt[_s5:_e5], re.M)
if sorted(det_ids) != sorted(roi_ids):
    fails.append('ROI 表与明细章节编号不一致（对称差 %s）' %
                 sorted(set(roi_ids) ^ set(det_ids))[:8])

# ---------- 10. 路径口径 + 反引号层数：位置列一律相对 badminton-app/ 且必须是单层代码标记 ----------
# 只在表格行（以 | 开头）里查，不碰正文叙述——
# 正文的 `badminton-app/...` 是相对仓库根的正确写法（git status、"在 badminton-app/ 下新建"）。
_s6 = txt.find('## 六、'); _e6 = txt.find('## 七、')
_loc_spans, _double_fence = [], []
for _a, _b, _lbl in ((_s4, _e4, '四章ROI表位置列'), (_s5, _e5, '五章明细主文件列'),
                     (_s6, _e6, '六章驳回表位置列')):
    for _ln, _line in enumerate(txt[_a:_b].split('\n'), 1):
        if not _line.lstrip().startswith('|'):
            continue
        # 双反引号 ``path`` 不会被渲染成代码，必须抓
        for _m in re.finditer(r'`{2}([^`]+)`{2}', _line):
            _double_fence.append((_lbl, _m.group(1)[:70]))
        # 列内的反引号路径带了 badminton-app/ 前缀。
        # 限定片段内不含空格与竖线，否则会把「前一列收尾反引号 ~ 后一列起始反引号」
        # 之间的整段表格（含「优化点」正文里的 badminton-app/）误判为路径。
        for _m in re.finditer(r'`([^`\s|]*badminton-app/[^`\s|]*)`', _line):
            _loc_spans.append((_lbl, _m.group(1)))
if _double_fence:
    fails.append('位置列出现双反引号（不渲染成代码）%d 处：%s'
                 % (len(_double_fence), _double_fence[:5]))
if _loc_spans:
    fails.append('位置列仍带 badminton-app/ 前缀 %d 处：%s'
                 % (len(_loc_spans), _loc_spans[:5]))

# ---------- 11. 新建项不得编造行号锚点 ----------
_newf = re.findall(r'`([^`（]*?)（新建）`', txt[_s4:_e5])
_bad_anchor = [p for p in _newf if re.search(r':\d+$', p)]
if not _newf:
    fails.append('未识别到任何「新建」标记（4 个新建项应有标注）')
if _bad_anchor:
    fails.append('新建项带了不存在的行号锚点：%s' % _bad_anchor)

# ---------- 12. 明细序号必须是 1..113 连续且不重复 ----------
_det_seq = [int(x) for x in re.findall(r'^### (\d+)\. \[', txt[_s5:_e5], re.M)]
if _det_seq != list(range(1, len(_det_seq) + 1)):
    fails.append('优化明细序号非 1..N 连续（前 8：%s）' % _det_seq[:8])

# ---------- 13. 交叉引用章号 + 优化章数字闭合 ----------
_sec_at = {}   # 章首字符位置
for _m in re.finditer(r'^## ([一二三四五六七八九])、', txt, re.M):
    _sec_at[_m.group(1)] = _m.start()
_keys = sorted(_sec_at, key=lambda k: _sec_at[k])
_bnds = [_sec_at[k] for k in _keys] + [len(txt)]
_sec_map = {k: (_bnds[i], _bnds[i + 1]) for i, k in enumerate(_keys)}


def _chapter_of(pos):
    for k, (a, b) in _sec_map.items():
        if a <= pos < b:
            return k
    return None


_ref_bad = []
# 不依赖全角括号（表内也可能写成 `），见第六章`），窗口跨 `|` 以便取到前一列的名词
for _m in re.finditer(r'见第([一二三四五六七八九])章', txt):
    _tgt = _m.group(1)
    _anchor = txt[max(0, _m.start() - 60):_m.start()]
    if _tgt not in _sec_map:
        _ref_bad.append((_m.group(0), '目标第%s章不存在' % _tgt, ''))
        continue
    _ta, _tb = _sec_map[_tgt]
    # 判据用目标章**标题**而非全文：第五章正文会提到「驳回」10 次，
    # 用全文会把错引当成命中，标题才是该章的语义标识。
    _tgt_txt = txt[_ta:_tb].split('\n', 1)[0]
    _kw = None
    for _c in ('检查点', '驳回', '明细', 'ROI'):
        if _c in _anchor:
            _kw = _c
            break
    if _kw and _kw not in _tgt_txt:
        _ref_bad.append((_anchor[-36:].replace('\n', ' ') + _m.group(0),
                         '第%s章无「%s」' % (_tgt, _kw),
                         '实际在第%s章' % _chapter_of(_m.start())))
    elif not _kw:
        _ref_bad.append((_anchor[-36:].replace('\n', ' ') + _m.group(0),
                         '引用前 60 字无名词可校验', ''))
if _ref_bad:
    fails.append('章节交叉引用异常 %d 处：%s' % (len(_ref_bad), _ref_bad[:3]))
_m = re.search(r'检查点（见第(.)章）', txt)
if not _m or _m.group(1) != '七':
    fails.append('「检查点」交叉引用应为第七章，实际：%s'
                 % (txt[_m.start():_m.end()] if _m else '未找到'))
# 优化章数字闭合：初筛 = 通过+驳回；采纳 = 通过+批判追加
_sec3 = txt[txt.find('## 三、'):txt.find('## 四、')]


def _g(pat):
    mm = re.search(pat, _sec3)
    return int(mm.group(1)) if mm else None


_n_raw = _g(r'初筛建议 \| (\d+) 条')
_n_pass = _g(r'对抗验证\*\*通过\*\* \| \*\*(\d+) 条')
_n_rej = _g(r'对抗验证\*\*驳回\*\* \| \*\*(\d+) 条')
_n_crit = _g(r'完整性批判\*\*追加\*\* \| \*\*(\d+) 条')
_n_acc = _g(r'确认采纳 \| \*\*(\d+) 条')
if None in (_n_raw, _n_pass, _n_rej, _n_crit, _n_acc):
    fails.append('三章数字行缺失：raw=%s pass=%s rej=%s crit=%s acc=%s'
                 % (_n_raw, _n_pass, _n_rej, _n_crit, _n_acc))
else:
    if _n_pass + _n_rej != _n_raw:
        fails.append('三章不闭合：通过%d + 驳回%d = %d ≠ 初筛 %d'
                     % (_n_pass, _n_rej, _n_pass + _n_rej, _n_raw))
    if _n_pass + _n_crit != _n_acc:
        fails.append('三章不闭合：通过%d + 批判追加%d = %d ≠ 采纳 %d'
                     % (_n_pass, _n_crit, _n_pass + _n_crit, _n_acc))
    if (_n_raw, _n_rej, _n_acc) != (124, 24, 113):
        fails.append('三章关键数字偏离 124/24/113：raw=%d rej=%d acc=%d'
                     % (_n_raw, _n_rej, _n_acc))

print('=' * 62)
print('校验报告：', DOC)
print('=' * 62)
print('行数 %d ｜ 字符 %d ｜ 围栏 %d 个' % (len(lines), len(txt), len(fence_lines)))
print('索引 %d 行 ｜ 优化明细 %d 条 ｜ 驳回 %d 条' % (len(bug_rows), len(opt_heads), rej_n))
print('密钥扫描：env 键 %d 类 %d 值，泄漏 %d 个'
      % (len(_secret_by_key), len(secrets), len(hits)))
print('-' * 62)
for w_ in warns:
    print('WARN:', w_)
if fails:
    print('-' * 62)
    for f in fails:
        print('FAIL:', f)
    print('结论：FAIL（%d 项）' % len(fails))
    sys.exit(1)
print('结论：PASS —— 无围栏破损、无行内反引号、无密钥泄漏、')
print('       无占位符残留、表格列数全部一致、链接全部有效、')
print('       章节 10/10 完整（第十章补遗 9 项关键锚点齐全）、条目数 143/113/24 全部对上、')
print('       优化编号 113 个全唯一且 ROI 表↔明细一致、')
print('       位置列口径统一、新建项无伪造锚点、')
print('       章节交叉引用指向真实章节、优化章 124=100+24 与 113=100+13 数字闭合。')
