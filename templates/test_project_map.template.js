/**
 * [变更日志]
 * 修改时间：{{DATE}}
 * AI模型：{{MODEL}}
 * 修改内容：[v1.1 初版：自检脚本 Node 兼容版。Python 版（test_project_map.template.py）为权威主版，
 *           断言升级优先落地 Python；本版为功能镜像，改断言时两份模板必须同步修改。
 *           移植已修复 4 个保真度点：① CRLF 行数统计（对齐 Python splitlines）；② /s 等价正则解析
 *           map-paths 块；③ 非法 UTF-8 容错（Node toString 默认替换不抛异常）；④ 路径统一 path.join；
 *           ⑤ Windows 管道红灯输出不被 process.exit 截断（exitCode 替代，输出走 stdout 对齐 Python 版）]
 * 用法:
 *   node scripts/test_project_map.js          # 独立运行（红灯退出码 1）
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ══════════════════ 常量配置区（移植到新项目只需改这里）══════════════════

const ROOT = path.resolve(__dirname, '..');
// 地图文件名（默认根目录 project-map.md）
const MAP_NAME = 'project-map.md';
const MAP = path.join(ROOT, MAP_NAME);

// 行为准则文件清单（断言二校验存在性；断言五校验它们至少一个实际引用了地图+自检脚本）
// 留空表示项目无准则文件——应先新建 AGENTS.md，断言五会报配置错误而非误报饿死
const RULE_FILES = ['AGENTS.md'];
// 准则文件启动协议引用的活跃文档白名单（准则文件加新引用时同步此处；脚本名跟随所选运行时）
const AGENT_REFERENCES = [...RULE_FILES, MAP_NAME, 'scripts/test_project_map.js'];

// 结构活跃区：这些层级的子目录必须已在清单登记（''=根目录一级；再深层不反扫，由断言一管存在性）
const ACTIVE_PARENTS = ['', 'src', 'scripts', 'docs'];

// 机械缓存白名单：仅限纯机械生成目录。运行产物/资源区在清单块内用 # 产物区 / # 资源区 开头的注释声明
const IGNORE = new Set(['node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', 'target', 'vendor']);

// 地图体积预算红线（行）
const MAP_BUDGET_LINES = 150;

// 豁免标注 token：清单行注释以这些词【开头】才视为运行产物/资源区（防注释中段偶遇关键词误豁免）
const ARTIFACT_MARKERS = ['产物区', '资源区'];
// 内联待确认标记：自检红灯建议追加的行带此标记，人工补语义时删掉
const PENDING_TOKEN = '【待确认】';
// 待确认欠账上限：超过即红灯，防语义衰减成"有结构无语义"
const PENDING_BUDGET = 5;

// ══════════════════ 以下为通用实现，勿改 ═══════════════════

// 保真度点③：Node 的 buf.toString('utf8') 遇非法字节默认替换为 U+FFFD 而非抛异常，
// 与 Python errors="ignore" 行为对齐（含 GBK 注释的准则文件不会崩掉整个自检）
function readTextSafe(file) {
  return fs.readFileSync(file).toString('utf8');
}

// 保真度点①：对齐 Python splitlines——正确处理 CRLF/CR/LF，且末尾换行不产生多余空行
function splitLines(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function isArtifact(comment) {
  return ARTIFACT_MARKERS.some(mk => comment.startsWith(mk));
}

function loadManifest() {
  if (!fs.existsSync(MAP)) {
    throw new Error(`未找到地图文件 ${MAP}\n`
      + `请先在项目根目录生成 ${MAP_NAME}（可用 agent-project-map 技能）`);
  }
  const text = readTextSafe(MAP);
  // 保真度点②：[\s\S]*? 等价 Python re.S，跨行解析 map-paths 围栏块
  const m = text.match(/```map-paths\s*\n([\s\S]*?)```/);
  if (!m) throw new Error(`${MAP_NAME} 中未找到 \`\`\`map-paths 清单块`);
  const entries = [];
  for (const raw of m[1].split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const hashIdx = line.indexOf('#');
    if (hashIdx !== -1) {
      entries.push([line.slice(0, hashIdx).trim().replace(/\/+$/, ''), line.slice(hashIdx + 1).trim()]);
    } else {
      entries.push([line.replace(/\/+$/, ''), '']);
    }
  }
  return entries;
}

function existsRel(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function testProjectMap() {
  const errors = [];
  const manifest = loadManifest();
  const artifactPaths = new Set(manifest.filter(([, c]) => isArtifact(c)).map(([p]) => p));
  const declared = new Set(manifest.map(([p]) => p));

  // 断言一：清单声明路径全部存在；产物区/资源区豁免（fresh clone 无产物目录不算失效）
  for (const [p, c] of manifest) {
    if (artifactPaths.has(p)) continue;
    if (!existsRel(p)) {
      const hint = c ? "（若为运行产物，注释需以 '产物区' 或 '资源区' 开头以豁免存在性检查）" : '';
      errors.push(`[声明失效] 清单声明但不存在: ${p}${hint}`);
    }
  }

  // 断言二：行为准则引用的核心文档存在（防"引用静默失效"）
  for (const p of AGENT_REFERENCES) {
    if (!existsRel(p)) errors.push(`[引用失效] 行为准则引用但缺失: ${p}`);
  }

  // 断言三：反向扫描活跃区——未登记的新目录必须暴露；红灯附可复制答案（断言六守欠账上限）
  for (const parent of ACTIVE_PARENTS) {
    const base = parent ? path.join(ROOT, parent) : ROOT;
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue;
    for (const name of fs.readdirSync(base)) {
      const child = path.join(base, name);
      let isDir = false;
      try { isDir = fs.statSync(child).isDirectory(); } catch (e) { continue; }
      if (!isDir || name.startsWith('.') || IGNORE.has(name)) continue;
      const rel = parent ? `${parent}/${name}` : name;
      if (declared.has(rel)) continue;
      errors.push(`[未登记] 活跃区新目录未在地图清单声明: ${rel}/\n`
        + `  → 追加到 map-paths 块：${rel}/  # ${PENDING_TOKEN}`);
    }
  }

  // 断言四：体积预算红线
  const lineCount = splitLines(readTextSafe(MAP)).length;
  if (lineCount > MAP_BUDGET_LINES) {
    errors.push(`[预算超限] ${MAP_NAME} 共 ${lineCount} 行，超出 ${MAP_BUDGET_LINES} 行红线，必须精简`);
  }

  // 断言五：防地图饿死——至少一个准则文件实际引用了地图与自检脚本
  // 准则文件被重写时常丢掉接入的四条规则，地图静默饿死且其余断言全绿无人察觉
  if (RULE_FILES.length === 0) {
    throw new Error('[配置错误] RULE_FILES 为空——请先在项目根目录新建 AGENTS.md');
  }
  const scriptName = path.basename(__filename); // 零配置自取，脚本改名自动跟随
  const ruleTexts = [];
  for (const rf of RULE_FILES) {
    const f = path.join(ROOT, rf);
    if (fs.existsSync(f)) ruleTexts.push(readTextSafe(f));
  }
  if (ruleTexts.length === 0) {
    errors.push('[饿死风险] RULE_FILES 中的准则文件均不存在，'
      + '地图已失去读取入口——请先创建准则文件并执行接入');
  } else {
    for (const [needle, label] of [[MAP_NAME, '地图'], [scriptName, '自检脚本']]) {
      if (!ruleTexts.some(t => t.includes(needle))) {
        errors.push(`[饿死风险] 所有准则文件均未引用 ${label}（${needle}），`
          + `地图已失去读取入口——请重新执行接入四条规则`);
      }
    }
  }

  // 断言六：防语义欠账——内联【待确认】超过上限即红灯
  const pendingCount = manifest.filter(([, c]) => c.includes(PENDING_TOKEN)).length;
  if (pendingCount > PENDING_BUDGET) {
    errors.push(`[语义欠账] 清单块内有 ${pendingCount} 项 ${PENDING_TOKEN} 待补语义，`
      + `超出 ${PENDING_BUDGET} 上限——请逐条补注释后删掉 ${PENDING_TOKEN}`);
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
  // 绿灯汇总：让待确认欠账与产物区豁免数量可见，不静默
  console.log(`OK: 六层断言全部通过（清单 ${declared.size} 项，产物区豁免 ${artifactPaths.size} 项，`
    + `待确认 ${pendingCount} 项，共 ${lineCount} 行）`);
}

try {
  testProjectMap();
} catch (e) {
  // 保真度点⑤：与 Python 版一致断言输出走 stdout（CI 友好）；用 exitCode 而非 process.exit——
  // Windows 管道上 console 输出为异步写入，紧跟 process.exit 会把未刷出的红灯信息直接丢弃
  console.log(e.message);
  process.exitCode = 1;
}
