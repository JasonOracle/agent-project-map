"""
[变更日志]
修改时间：{{DATE}}
AI模型：{{MODEL}}
修改内容：[v1.0：契约#5 重写（结构可再生/语义层唯人）；新增断言五防地图饿死（准则文件须实际引用地图+自检脚本）；新增断言六防语义欠账（内联【待确认】超限红灯）；load_manifest 升级为标注解析器，断言一按 # 产物区/# 资源区 开头标注豁免存在性（治 fresh clone 误报）；IGNORE 退化为纯机械缓存，目录性质唯一事实源是地图清单标注（治名字碰撞盲区）；未登记红灯给可复制答案（降维护摩擦）；RULE_FILES 空配置前置校验；技能更名 scan-project-map → agent-project-map]
用法:
  python scripts/test_project_map.py     # 独立运行（红灯退出码 1）
  python -m pytest scripts/test_project_map.py -q   # 并入 pytest 流程（可选）
"""
import re
import sys
from pathlib import Path

# ══════════════════ 常量配置区（移植到新项目只需改这里）══════════════════

ROOT = Path(__file__).resolve().parent.parent
# 地图文件名（默认根目录 project-map.md）
MAP_NAME = "project-map.md"
MAP = ROOT / MAP_NAME

# 行为准则文件清单（断言二校验存在性；断言五校验它们至少一个实际引用了地图+自检脚本）
# 留空表示项目无准则文件——应先新建 AGENTS.md，断言五会报配置错误而非误报饿死
RULE_FILES = ["AGENTS.md"]
# 准则文件启动协议引用的活跃文档白名单（准则文件加新引用时同步此处）
AGENT_REFERENCES = RULE_FILES + [MAP_NAME, "scripts/test_project_map.py"]

# 结构活跃区：这些层级的子目录必须已在清单登记（""=根目录一级；再深层不反扫，由断言一管存在性）
ACTIVE_PARENTS = ["", "src", "scripts", "docs"]

# 机械缓存白名单：仅限纯机械生成目录（依赖、虚拟环境、构建输出根目录）
# 运行产物/资源区不再靠名字豁免（名字黑名单无法区分"根目录产物 data/"和"src 源码 data/"，
# 会造成永久失明）——必须在清单块内用 # 产物区 / # 资源区 开头的注释声明，目录性质唯一事实源是地图
IGNORE = {"node_modules", "__pycache__", ".venv", "venv", "dist", "build", "target", "vendor"}

# 地图体积预算红线（行）
MAP_BUDGET_LINES = 150

# 豁免标注 token：清单行注释以这些词【开头】才视为运行产物/资源区
# 开头匹配是防误豁免的关键——"src/foo/ # 生成产物区的工具"这类注释偶遇关键词的源码目录不受豁免
ARTIFACT_MARKERS = ("产物区", "资源区")
# 内联待确认标记：自检红灯建议追加的行带此标记，人工补语义时删掉
PENDING_TOKEN = "【待确认】"
# 待确认欠账上限：超过即红灯。没有强制力的提醒在工程上等于没有，
# 该上限防机器追加的待登记行长期无人补语义，退化成"有结构无语义"
PENDING_BUDGET = 5

# ══════════════════ 以下为通用实现，勿改 ═══════════════════


def load_manifest():
    """唯一解析面：地图内的 ```map-paths 围栏块。

    返回 [(path, comment), ...]：comment 为井号后全部文本（已 strip），无注释为空串。
    保留注释是为了让断言一（产物区豁免）与断言六（待确认计数）按标注做差异化判定。"""
    if not MAP.exists():
        raise AssertionError(f"未找到地图文件 {MAP}\n"
                             f"请先在项目根目录生成 {MAP_NAME}（可用 agent-project-map 技能）")
    text = MAP.read_text(encoding="utf-8")
    m = re.search(r"```map-paths\s*\n(.*?)```", text, re.S)
    if not m:
        raise AssertionError(f"{MAP_NAME} 中未找到 ```map-paths 清单块")
    entries = []
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "#" in line:
            path_part, comment = line.split("#", 1)
            path = path_part.strip().rstrip("/")
            comment = comment.strip()
        else:
            path, comment = line.rstrip("/"), ""
        entries.append((path, comment))
    return entries


def is_artifact(comment):
    """注释以"产物区"或"资源区"开头才豁免（startswith 多前缀匹配）。"""
    return comment.startswith(ARTIFACT_MARKERS)


def test_project_map():
    errors = []
    manifest = load_manifest()
    artifact_paths = {p for p, c in manifest if is_artifact(c)}
    declared = {p for p, _ in manifest}

    # 断言一：清单声明路径全部存在（防"声明失效"）
    # 产物区/资源区豁免存在性检查——fresh clone / CI 首跑没有运行产物目录不算失效
    for p, c in manifest:
        if p in artifact_paths:
            continue
        if not (ROOT / p).exists():
            hint = ("（若为运行产物，注释需以 '产物区' 或 '资源区' 开头以豁免存在性检查）"
                    if c else "")
            errors.append(f"[声明失效] 清单声明但不存在: {p}{hint}")

    # 断言二：行为准则引用的核心文档存在（防"引用静默失效"）
    for p in AGENT_REFERENCES:
        if not (ROOT / p).exists():
            errors.append(f"[引用失效] 行为准则引用但缺失: {p}")

    # 断言三：反向扫描活跃区——未登记的新目录必须暴露（防"新增未登记"）
    # 目录性质不靠名字豁免：产物区一旦存在就必须登记并带标注，未登记照样红灯
    for parent in ACTIVE_PARENTS:
        base = ROOT if parent == "" else ROOT / parent
        if not base.is_dir():
            continue
        for child in base.iterdir():
            if not child.is_dir() or child.name.startswith(".") or child.name in IGNORE:
                continue
            rel = f"{parent}/{child.name}" if parent else child.name
            if rel in declared:
                continue
            # 给可复制答案：建议带【待确认】标记追加，人工补语义后删掉标记（断言六守欠账上限）
            errors.append(f"[未登记] 活跃区新目录未在地图清单声明: {rel}/\n"
                          f"  → 追加到 map-paths 块：{rel}/  # {PENDING_TOKEN}")

    # 断言四：体积预算红线
    line_count = len(MAP.read_text(encoding="utf-8").splitlines())
    if line_count > MAP_BUDGET_LINES:
        errors.append(f"[预算超限] {MAP_NAME} 共 {line_count} 行，"
                      f"超出 {MAP_BUDGET_LINES} 行红线，必须精简")

    # 断言五：防地图饿死——至少一个准则文件实际引用了地图与自检脚本
    # 准则文件被重写时常丢掉 Phase 6 接入的四条规则，地图静默饿死且其余断言全绿无人察觉
    if not RULE_FILES:
        raise AssertionError("[配置错误] RULE_FILES 为空——请先在项目根目录新建 AGENTS.md")
    script_name = Path(__file__).name  # 零配置自取，脚本改名自动跟随
    rule_texts = [(rf, (ROOT / rf).read_text(encoding="utf-8", errors="ignore"))
                  for rf in RULE_FILES if (ROOT / rf).exists()]
    if not rule_texts:
        errors.append("[饿死风险] RULE_FILES 中的准则文件均不存在，"
                      "地图已失去读取入口——请先创建准则文件并执行接入")
    else:
        for needle, label in ((MAP_NAME, "地图"), (script_name, "自检脚本")):
            if not any(needle in text for _, text in rule_texts):
                errors.append(f"[饿死风险] 所有准则文件均未引用 {label}（{needle}），"
                              f"地图已失去读取入口——请重新执行接入四条规则")

    # 断言六：防语义欠账——内联【待确认】超过上限即红灯
    pending_count = sum(1 for _, c in manifest if PENDING_TOKEN in c)
    if pending_count > PENDING_BUDGET:
        errors.append(f"[语义欠账] 清单块内有 {pending_count} 项 {PENDING_TOKEN} 待补语义，"
                      f"超出 {PENDING_BUDGET} 上限——请逐条补注释后删掉 {PENDING_TOKEN}")

    if errors:
        raise AssertionError("\n".join(errors))
    # 绿灯汇总：让待确认欠账与产物区豁免数量可见，不静默
    print(f"OK: 六层断言全部通过（清单 {len(declared)} 项，产物区豁免 {len(artifact_paths)} 项，"
          f"待确认 {pending_count} 项，共 {line_count} 行）")


if __name__ == "__main__":
    try:
        test_project_map()
    except AssertionError as e:
        print(str(e))
        sys.exit(1)
