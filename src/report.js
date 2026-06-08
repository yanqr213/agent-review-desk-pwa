import {
  CI_DEFINITIONS,
  RISK_DEFINITIONS,
  STATUS_DEFINITIONS,
  getDashboardStats,
  groupItems,
  sortItems,
  toPortableDataset
} from "./domain.js";

export function buildReportModel(items, options = {}) {
  const sortedItems = sortItems(items);
  return {
    title: options.title || "Agent Review Desk 报告",
    generatedAt: options.generatedAt || new Date().toISOString(),
    reviewer: options.reviewer || "",
    scope: options.scope || "当前筛选结果",
    stats: getDashboardStats(sortedItems),
    groups: groupItems(sortedItems, options.groupBy || "project"),
    items: sortedItems
  };
}

export function exportJsonReport(items, options = {}) {
  return `${JSON.stringify(toPortableDataset(items, options), null, 2)}\n`;
}

export function exportMarkdownReport(items, options = {}) {
  const report = buildReportModel(items, options);
  const lines = [
    `# ${escapeMarkdown(report.title)}`,
    "",
    `- 生成时间：${formatDateTime(report.generatedAt)}`,
    `- 评审人：${escapeMarkdown(report.reviewer || "未填写")}`,
    `- 范围：${escapeMarkdown(report.scope)}`,
    "",
    "## 总览",
    "",
    `- 条目总数：${report.stats.total}`,
    `- 需关注：${report.stats.needsAttention}`,
    `- 阻塞：${report.stats.blockedCount}`,
    `- 已评分：${report.stats.scoredCount}`,
    `- 平均评分：${report.stats.averageScore || "暂无"}`,
    `- 变更文件：${report.stats.changedFiles}`,
    `- 增删行：+${report.stats.additions} / -${report.stats.deletions}`,
    "",
    "### 状态分布",
    "",
    countTable(report.stats.byStatus, STATUS_DEFINITIONS),
    "",
    "### 风险分布",
    "",
    countTable(report.stats.byRisk, RISK_DEFINITIONS),
    "",
    "## 条目明细",
    ""
  ];

  for (const group of report.groups) {
    lines.push(`### ${escapeMarkdown(group.label)} (${group.items.length})`, "");
    for (const item of group.items) {
      lines.push(...renderItem(item), "");
    }
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function createDownloadBlob(content, type) {
  return new Blob([content], { type });
}

export function createReportFileName(kind, now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const extension = kind === "markdown" ? "md" : "json";
  return `agent-review-report-${stamp}.${extension}`;
}

function renderItem(item) {
  const lines = [
    `#### ${escapeMarkdown(item.title)}`,
    "",
    `- ID：\`${item.id}\``,
    `- 项目：${escapeMarkdown(item.project)}`,
    `- 代理：${escapeMarkdown(item.agent)}`,
    `- 状态：${STATUS_DEFINITIONS[item.status].label}`,
    `- 风险：${RISK_DEFINITIONS[item.risk].label}`,
    `- CI：${CI_DEFINITIONS[item.ci.status].label}`,
    `- 评分：${item.score || "未评分"}`
  ];

  if (item.summary) {
    lines.push(`- 摘要：${escapeMarkdown(item.summary)}`);
  }
  if (item.branch) {
    lines.push(`- 分支：\`${item.branch}\``);
  }
  if (item.commit) {
    lines.push(`- 提交：\`${item.commit}\``);
  }
  if (item.tags.length) {
    lines.push(`- 标签：${item.tags.map(escapeMarkdown).join("、")}`);
  }
  if (item.files.length) {
    lines.push("", "变更文件：", "");
    for (const file of item.files) {
      const risk = file.risk ? `，风险：${RISK_DEFINITIONS[file.risk].label}` : "";
      lines.push(`- \`${file.path}\` (+${file.additions}/-${file.deletions}${risk})`);
    }
  }
  if (item.ci.checks.length) {
    lines.push("", "CI 检查：", "");
    for (const check of item.ci.checks) {
      lines.push(`- ${escapeMarkdown(check.name)}：${CI_DEFINITIONS[check.status].label}${check.details ? `，${escapeMarkdown(check.details)}` : ""}`);
    }
  }
  if (item.notes.length) {
    lines.push("", "复核意见：", "");
    for (const note of item.notes) {
      const author = note.author ? ` (${escapeMarkdown(note.author)})` : "";
      lines.push(`- ${escapeMarkdown(note.text)}${author}`);
    }
  }

  return lines;
}

function countTable(counts, definitions) {
  const rows = ["| 类别 | 数量 |", "| --- | ---: |"];
  for (const [key, definition] of Object.entries(definitions)) {
    rows.push(`| ${definition.label} | ${counts[key] || 0} |`);
  }
  return rows.join("\n");
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 19);
}
