export const STATUS_DEFINITIONS = Object.freeze({
  new: { label: "待评审", order: 10 },
  reviewing: { label: "评审中", order: 20 },
  "needs-changes": { label: "需修改", order: 30 },
  blocked: { label: "阻塞", order: 40 },
  approved: { label: "已通过", order: 50 }
});

export const RISK_DEFINITIONS = Object.freeze({
  low: { label: "低", score: 1 },
  medium: { label: "中", score: 2 },
  high: { label: "高", score: 3 },
  critical: { label: "严重", score: 4 }
});

export const CI_DEFINITIONS = Object.freeze({
  passed: { label: "通过", order: 10 },
  failed: { label: "失败", order: 40 },
  running: { label: "运行中", order: 20 },
  skipped: { label: "跳过", order: 30 },
  unknown: { label: "未知", order: 50 }
});

export const TRIAGE_DEFINITIONS = Object.freeze({
  now: { label: "现在处理", order: 10 },
  next: { label: "下一批", order: 20 },
  watch: { label: "观察", order: 30 },
  done: { label: "已完成", order: 40 }
});

const STATUS_ALIASES = new Map([
  ["todo", "new"],
  ["pending", "new"],
  ["open", "new"],
  ["in-progress", "reviewing"],
  ["in progress", "reviewing"],
  ["review", "reviewing"],
  ["changes", "needs-changes"],
  ["requested", "needs-changes"],
  ["needs_changes", "needs-changes"],
  ["fail", "blocked"],
  ["failed", "blocked"],
  ["pass", "approved"],
  ["passed", "approved"],
  ["done", "approved"],
  ["ok", "approved"]
]);

const RISK_ALIASES = new Map([
  ["minor", "low"],
  ["normal", "medium"],
  ["med", "medium"],
  ["major", "high"],
  ["severe", "critical"],
  ["blocker", "critical"]
]);

const CI_ALIASES = new Map([
  ["pass", "passed"],
  ["success", "passed"],
  ["ok", "passed"],
  ["failure", "failed"],
  ["fail", "failed"],
  ["error", "failed"],
  ["pending", "running"],
  ["in-progress", "running"],
  ["ignore", "skipped"]
]);

export function parseImportPayload(text) {
  if (typeof text !== "string") {
    throw new TypeError("导入内容必须是 JSON 字符串。");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }

  return normalizeDataset(parsed);
}

export function normalizeDataset(payload) {
  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.tasks)
        ? payload.tasks
        : null;

  if (!rawItems) {
    throw new Error("数据格式无效：需要数组，或包含 items/tasks 数组的对象。");
  }

  const items = rawItems.map((item, index) => normalizeItem(item, index));
  assertUniqueIds(items);

  return {
    version: toCleanString(payload?.version) || "1.0",
    importedAt: toIsoDate(payload?.importedAt) || new Date().toISOString(),
    source: toCleanString(payload?.source),
    items
  };
}

export function normalizeItem(rawItem, index = 0) {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    throw new Error(`第 ${index + 1} 条记录不是对象。`);
  }

  const id = toCleanString(rawItem.id) || slugify(`${rawItem.project || "project"}-${rawItem.title || rawItem.task || index + 1}`);
  const title = toCleanString(rawItem.title || rawItem.task || rawItem.summary);

  if (!title) {
    throw new Error(`第 ${index + 1} 条记录缺少 title/task/summary。`);
  }

  const ci = normalizeCi(rawItem.ci || rawItem.checks || rawItem.pipeline);
  const files = normalizeFiles(rawItem.files || rawItem.changedFiles || []);
  const tags = normalizeStringList(rawItem.tags);
  const notes = normalizeNotes(rawItem.notes || rawItem.reviewNotes || []);
  const risk = normalizeRisk(rawItem.risk || rawItem.severity) || inferRisk({ ci, files, tags });
  const status = normalizeStatus(rawItem.status || rawItem.reviewStatus) || inferStatus(ci);
  const score = clampScore(rawItem.score ?? rawItem.review?.score);

  return {
    id,
    title,
    project: toCleanString(rawItem.project) || "未分组项目",
    agent: toCleanString(rawItem.agent || rawItem.agentName) || "未知代理",
    branch: toCleanString(rawItem.branch),
    commit: toCleanString(rawItem.commit || rawItem.sha),
    summary: toCleanString(rawItem.summary || rawItem.description),
    risk,
    status,
    ci,
    files,
    tags,
    score,
    notes,
    createdAt: toIsoDate(rawItem.createdAt) || "",
    updatedAt: toIsoDate(rawItem.updatedAt) || "",
    metadata: normalizeMetadata(rawItem.metadata)
  };
}

export function normalizeStatus(value) {
  const key = normalizeToken(value);
  if (!key) return "";
  return STATUS_DEFINITIONS[key] ? key : STATUS_ALIASES.get(key) || "";
}

export function normalizeRisk(value) {
  const key = normalizeToken(value);
  if (!key) return "";
  return RISK_DEFINITIONS[key] ? key : RISK_ALIASES.get(key) || "";
}

export function normalizeCiStatus(value) {
  const key = normalizeToken(value);
  if (!key) return "unknown";
  return CI_DEFINITIONS[key] ? key : CI_ALIASES.get(key) || "unknown";
}

export function normalizeCi(rawCi) {
  if (!rawCi) {
    return { status: "unknown", url: "", checks: [] };
  }

  if (Array.isArray(rawCi)) {
    return normalizeCi({ checks: rawCi });
  }

  const checks = Array.isArray(rawCi.checks)
    ? rawCi.checks.map((check, index) => normalizeCheck(check, index))
    : [];

  const status = normalizeCiStatus(rawCi.status || rawCi.conclusion || inferCiStatusFromChecks(checks));
  return {
    status,
    url: toCleanString(rawCi.url || rawCi.href),
    checks
  };
}

export function normalizeCheck(rawCheck, index = 0) {
  if (typeof rawCheck === "string") {
    return { name: rawCheck, status: "unknown", duration: "", details: "" };
  }

  if (!rawCheck || typeof rawCheck !== "object") {
    return {
      name: `check-${index + 1}`,
      status: "unknown",
      duration: "",
      details: ""
    };
  }

  return {
    name: toCleanString(rawCheck.name) || `check-${index + 1}`,
    status: normalizeCiStatus(rawCheck.status || rawCheck.conclusion),
    duration: toCleanString(rawCheck.duration),
    details: toCleanString(rawCheck.details || rawCheck.summary)
  };
}

export function normalizeFiles(rawFiles) {
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles
    .map((file, index) => normalizeFile(file, index))
    .filter((file) => file.path);
}

export function normalizeFile(rawFile, index = 0) {
  if (typeof rawFile === "string") {
    return { path: rawFile.trim(), additions: 0, deletions: 0, risk: "" };
  }

  if (!rawFile || typeof rawFile !== "object") {
    return { path: `unknown-${index + 1}`, additions: 0, deletions: 0, risk: "" };
  }

  return {
    path: toCleanString(rawFile.path || rawFile.name || rawFile.file),
    additions: toInteger(rawFile.additions),
    deletions: toInteger(rawFile.deletions),
    risk: normalizeRisk(rawFile.risk || rawFile.severity)
  };
}

export function normalizeNotes(rawNotes) {
  if (!rawNotes) return [];
  const notes = Array.isArray(rawNotes) ? rawNotes : [rawNotes];
  return notes
    .map((note, index) => normalizeNote(note, index))
    .filter((note) => note.text);
}

export function normalizeNote(rawNote, index = 0) {
  if (typeof rawNote === "string") {
    return {
      id: `note-${index + 1}`,
      text: rawNote.trim(),
      author: "",
      createdAt: ""
    };
  }

  if (!rawNote || typeof rawNote !== "object") {
    return { id: `note-${index + 1}`, text: "", author: "", createdAt: "" };
  }

  return {
    id: toCleanString(rawNote.id) || `note-${index + 1}`,
    text: toCleanString(rawNote.text || rawNote.body || rawNote.note),
    author: toCleanString(rawNote.author),
    createdAt: toIsoDate(rawNote.createdAt) || ""
  };
}

export function normalizeStringList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(list.map((item) => toCleanString(item)).filter(Boolean))];
}

export function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => [key, typeof item === "object" ? JSON.stringify(item) : String(item)])
  );
}

export function filterItems(items, filters = {}) {
  const query = toCleanString(filters.query).toLowerCase();
  const project = toCleanString(filters.project);
  const status = normalizeStatus(filters.status);
  const risk = normalizeRisk(filters.risk);
  const agent = toCleanString(filters.agent);
  const tag = toCleanString(filters.tag);
  const ciStatus = filters.ciStatus ? normalizeCiStatus(filters.ciStatus) : "";

  return items.filter((item) => {
    if (query && !itemMatchesQuery(item, query)) return false;
    if (project && item.project !== project) return false;
    if (status && item.status !== status) return false;
    if (risk && item.risk !== risk) return false;
    if (agent && item.agent !== agent) return false;
    if (tag && !item.tags.includes(tag)) return false;
    if (ciStatus && item.ci.status !== ciStatus) return false;
    return true;
  });
}

export function itemMatchesQuery(item, query) {
  const haystack = [
    item.id,
    item.title,
    item.project,
    item.agent,
    item.branch,
    item.commit,
    item.summary,
    item.status,
    item.risk,
    item.ci.status,
    ...item.tags,
    ...item.files.map((file) => file.path),
    ...item.notes.map((note) => note.text)
  ].join(" ").toLowerCase();

  return haystack.includes(query);
}

export function groupItems(items, groupBy = "status") {
  const getKey = createGroupKeyGetter(groupBy);
  const groups = new Map();

  for (const item of items) {
    const key = getKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return Array.from(groups.entries())
    .map(([key, groupItemsForKey]) => ({
      key,
      label: formatGroupLabel(groupBy, key),
      items: sortItems(groupItemsForKey)
    }))
    .sort((a, b) => compareGroup(groupBy, a.key, b.key));
}

export function sortItems(items) {
  return [...items].sort((a, b) => {
    const riskDiff = RISK_DEFINITIONS[b.risk].score - RISK_DEFINITIONS[a.risk].score;
    if (riskDiff) return riskDiff;
    const statusDiff = STATUS_DEFINITIONS[a.status].order - STATUS_DEFINITIONS[b.status].order;
    if (statusDiff) return statusDiff;
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });
}

export function getDashboardStats(items) {
  const emptyStats = {
    total: items.length,
    byStatus: createZeroCount(Object.keys(STATUS_DEFINITIONS)),
    byRisk: createZeroCount(Object.keys(RISK_DEFINITIONS)),
    byCi: createZeroCount(Object.keys(CI_DEFINITIONS)),
    byTriage: createZeroCount(Object.keys(TRIAGE_DEFINITIONS)),
    averageScore: 0,
    scoredCount: 0,
    blockedCount: 0,
    needsAttention: 0,
    changedFiles: 0,
    additions: 0,
    deletions: 0
  };

  let scoreSum = 0;
  for (const item of items) {
    emptyStats.byStatus[item.status] += 1;
    emptyStats.byRisk[item.risk] += 1;
    emptyStats.byCi[item.ci.status] += 1;
    emptyStats.byTriage[getTriageLane(item)] += 1;
    emptyStats.changedFiles += item.files.length;
    emptyStats.additions += item.files.reduce((sum, file) => sum + file.additions, 0);
    emptyStats.deletions += item.files.reduce((sum, file) => sum + file.deletions, 0);

    if (item.status === "blocked") emptyStats.blockedCount += 1;
    if (item.status === "blocked" || item.status === "needs-changes" || item.risk === "critical" || item.ci.status === "failed") {
      emptyStats.needsAttention += 1;
    }
    if (typeof item.score === "number") {
      emptyStats.scoredCount += 1;
      scoreSum += item.score;
    }
  }

  emptyStats.averageScore = emptyStats.scoredCount ? round(scoreSum / emptyStats.scoredCount, 1) : 0;
  return emptyStats;
}

export function getTriageLane(item) {
  if (item.status === "approved") return "done";
  if (item.status === "blocked" || item.ci.status === "failed" || item.risk === "critical") return "now";
  if (item.status === "needs-changes" || item.risk === "high" || item.ci.status === "running") return "next";
  return "watch";
}

export function getTriageSummary(items) {
  const stats = createZeroCount(Object.keys(TRIAGE_DEFINITIONS));
  const ordered = sortItems(items);
  for (const item of ordered) {
    stats[getTriageLane(item)] += 1;
  }
  return {
    stats,
    lanes: Object.keys(TRIAGE_DEFINITIONS).map((key) => ({
      key,
      label: TRIAGE_DEFINITIONS[key].label,
      items: ordered.filter((item) => getTriageLane(item) === key)
    }))
  };
}

export function getUniqueOptions(items) {
  return {
    projects: uniqueSorted(items.map((item) => item.project)),
    agents: uniqueSorted(items.map((item) => item.agent)),
    tags: uniqueSorted(items.flatMap((item) => item.tags))
  };
}

export function patchItem(items, id, patch) {
  let found = false;
  const nextItems = items.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return normalizeItemPatch(item, patch);
  });

  if (!found) {
    throw new Error(`未找到条目：${id}`);
  }

  return nextItems;
}

export function normalizeItemPatch(item, patch = {}) {
  const next = structuredCloneSafe(item);

  if (Object.hasOwn(patch, "status")) {
    const status = normalizeStatus(patch.status);
    if (!status) throw new Error("状态值无效。");
    next.status = status;
  }

  if (Object.hasOwn(patch, "risk")) {
    const risk = normalizeRisk(patch.risk);
    if (!risk) throw new Error("风险值无效。");
    next.risk = risk;
  }

  if (Object.hasOwn(patch, "score")) {
    next.score = clampScore(patch.score);
  }

  if (Object.hasOwn(patch, "notes")) {
    next.notes = normalizeNotes(patch.notes);
  }

  if (Object.hasOwn(patch, "tags")) {
    next.tags = normalizeStringList(patch.tags);
  }

  next.updatedAt = patch.updatedAt || new Date().toISOString();
  return next;
}

export function addReviewNote(items, id, text, author = "reviewer", now = new Date().toISOString()) {
  const cleanText = toCleanString(text);
  if (!cleanText) {
    throw new Error("复核意见不能为空。");
  }

  return patchItem(items, id, {
    notes: [
      ...(items.find((item) => item.id === id)?.notes || []),
      {
        id: `note-${stableHash(`${id}-${cleanText}-${now}`)}`,
        text: cleanText,
        author: toCleanString(author),
        createdAt: now
      }
    ],
    updatedAt: now
  });
}

export function toPortableDataset(items, metadata = {}) {
  return {
    version: "1.0",
    exportedAt: metadata.exportedAt || new Date().toISOString(),
    source: "agent-review-desk-pwa",
    filters: metadata.filters || {},
    items: sortItems(items).map((item) => structuredCloneSafe(item))
  };
}

export function createEmptyDataset() {
  return {
    version: "1.0",
    importedAt: "",
    source: "",
    items: []
  };
}

export function assertUniqueIds(items) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`数据格式无效：重复 id "${item.id}"。`);
    }
    seen.add(item.id);
  }
}

export function inferRisk({ ci, files, tags }) {
  if (ci?.status === "failed") return "high";
  if (files.some((file) => file.risk === "critical")) return "critical";
  if (files.some((file) => file.risk === "high")) return "high";
  if (tags.some((tag) => /security|auth|migration|database|支付|权限/.test(tag.toLowerCase()))) {
    return "high";
  }

  const changedLines = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  if (changedLines >= 800) return "high";
  if (changedLines >= 150) return "medium";
  return "low";
}

export function inferStatus(ci) {
  if (ci.status === "failed") return "blocked";
  if (ci.status === "running") return "reviewing";
  return "new";
}

export function clampScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function inferCiStatusFromChecks(checks) {
  if (!checks.length) return "unknown";
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "running")) return "running";
  if (checks.every((check) => check.status === "skipped")) return "skipped";
  if (checks.every((check) => check.status === "passed")) return "passed";
  return "unknown";
}

function createGroupKeyGetter(groupBy) {
  if (groupBy === "triage") return (item) => getTriageLane(item);
  if (groupBy === "project") return (item) => item.project;
  if (groupBy === "risk") return (item) => item.risk;
  if (groupBy === "agent") return (item) => item.agent;
  if (groupBy === "ci") return (item) => item.ci.status;
  return (item) => item.status;
}

function formatGroupLabel(groupBy, key) {
  if (groupBy === "triage") return TRIAGE_DEFINITIONS[key]?.label || key;
  if (groupBy === "status") return STATUS_DEFINITIONS[key]?.label || key;
  if (groupBy === "risk") return `${RISK_DEFINITIONS[key]?.label || key}风险`;
  if (groupBy === "ci") return `CI ${CI_DEFINITIONS[key]?.label || key}`;
  return key || "未分组";
}

function compareGroup(groupBy, keyA, keyB) {
  if (groupBy === "triage") return TRIAGE_DEFINITIONS[keyA].order - TRIAGE_DEFINITIONS[keyB].order;
  if (groupBy === "status") return STATUS_DEFINITIONS[keyA].order - STATUS_DEFINITIONS[keyB].order;
  if (groupBy === "risk") return RISK_DEFINITIONS[keyB].score - RISK_DEFINITIONS[keyA].score;
  if (groupBy === "ci") return CI_DEFINITIONS[keyA].order - CI_DEFINITIONS[keyB].order;
  return keyA.localeCompare(keyB, "zh-Hans-CN");
}

function createZeroCount(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function toCleanString(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toIsoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function normalizeToken(value) {
  return toCleanString(value).toLowerCase().replace(/_/g, "-");
}

function slugify(value) {
  const slug = toCleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `item-${stableHash(String(value))}`;
}

function stableHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
