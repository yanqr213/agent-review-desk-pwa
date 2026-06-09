import {
  CI_DEFINITIONS,
  RISK_DEFINITIONS,
  STATUS_DEFINITIONS,
  TRIAGE_DEFINITIONS,
  addReviewNote,
  filterItems,
  getDashboardStats,
  getTriageLane,
  getUniqueOptions,
  groupItems,
  normalizeDataset,
  parseImportPayload,
  patchItem
} from "./domain.js";
import { exportJsonReport, exportMarkdownReport, createDownloadBlob, createReportFileName } from "./report.js";
import { clearDataset, loadDataset, loadPreferences, saveDataset, savePreferences } from "./storage.js";

const sampleUrl = new URL("../sample-data/agent-review-sample.json", import.meta.url);

const state = {
  dataset: loadDataset(),
  selectedId: "",
  filters: {
    query: "",
    project: "",
    status: "",
    risk: "",
    ciStatus: "",
    groupBy: "status"
  },
  preferences: loadPreferences()
};

const elements = {
  storageStatus: document.querySelector("#storage-status"),
  sampleButton: document.querySelector("#sample-button"),
  emptySampleButton: document.querySelector("#empty-sample-button"),
  fileInput: document.querySelector("#file-input"),
  pasteButton: document.querySelector("#paste-button"),
  emptyPasteButton: document.querySelector("#empty-paste-button"),
  exportMdButton: document.querySelector("#export-md-button"),
  exportJsonButton: document.querySelector("#export-json-button"),
  queryInput: document.querySelector("#query-input"),
  projectFilter: document.querySelector("#project-filter"),
  statusFilter: document.querySelector("#status-filter"),
  riskFilter: document.querySelector("#risk-filter"),
  ciFilter: document.querySelector("#ci-filter"),
  groupSelect: document.querySelector("#group-select"),
  resetFiltersButton: document.querySelector("#reset-filters-button"),
  metrics: document.querySelector("#metrics"),
  resultCount: document.querySelector("#result-count"),
  clearButton: document.querySelector("#clear-button"),
  errorPanel: document.querySelector("#error-panel"),
  emptyState: document.querySelector("#empty-state"),
  noResults: document.querySelector("#no-results"),
  groupContainer: document.querySelector("#group-container"),
  detailEmpty: document.querySelector("#detail-empty"),
  detailForm: document.querySelector("#detail-form"),
  detailProject: document.querySelector("#detail-project"),
  detailTitle: document.querySelector("#detail-title"),
  detailRiskPill: document.querySelector("#detail-risk-pill"),
  detailSummary: document.querySelector("#detail-summary"),
  detailMeta: document.querySelector("#detail-meta"),
  detailStatus: document.querySelector("#detail-status"),
  detailRisk: document.querySelector("#detail-risk"),
  detailScore: document.querySelector("#detail-score"),
  detailFiles: document.querySelector("#detail-files"),
  detailChecks: document.querySelector("#detail-checks"),
  detailNotes: document.querySelector("#detail-notes"),
  noteInput: document.querySelector("#note-input"),
  addNoteButton: document.querySelector("#add-note-button"),
  pasteDialog: document.querySelector("#paste-dialog"),
  pasteForm: document.querySelector("#paste-form"),
  pasteTextarea: document.querySelector("#paste-textarea"),
  pasteImportButton: document.querySelector("#paste-import-button"),
  toast: document.querySelector("#toast")
};

init();

function init() {
  fillStaticSelects();
  hydratePreferences();
  bindEvents();
  registerServiceWorker();
  render();
}

function bindEvents() {
  elements.sampleButton.addEventListener("click", importSample);
  elements.emptySampleButton.addEventListener("click", importSample);
  elements.fileInput.addEventListener("change", handleFileInput);
  elements.pasteButton.addEventListener("click", openPasteDialog);
  elements.emptyPasteButton.addEventListener("click", openPasteDialog);
  elements.pasteForm.addEventListener("submit", handlePasteSubmit);
  elements.exportMdButton.addEventListener("click", () => exportCurrent("markdown"));
  elements.exportJsonButton.addEventListener("click", () => exportCurrent("json"));
  elements.resetFiltersButton.addEventListener("click", resetFilters);
  elements.clearButton.addEventListener("click", clearLocalData);
  elements.detailForm.addEventListener("submit", handleDetailSubmit);

  for (const [element, key] of [
    [elements.queryInput, "query"],
    [elements.projectFilter, "project"],
    [elements.statusFilter, "status"],
    [elements.riskFilter, "risk"],
    [elements.ciFilter, "ciStatus"],
    [elements.groupSelect, "groupBy"]
  ]) {
    element.addEventListener("input", () => {
      state.filters[key] = element.value;
      persistPreferences();
      render();
    });
  }

  for (const element of [elements.detailStatus, elements.detailRisk, elements.detailScore]) {
    element.addEventListener("change", saveDetailEdits);
  }

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.queryInput.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
      event.preventDefault();
      exportCurrent("markdown");
    }
  });
}

function fillStaticSelects() {
  fillOptions(elements.statusFilter, STATUS_DEFINITIONS, "全部状态");
  fillOptions(elements.riskFilter, RISK_DEFINITIONS, "全部风险", (definition) => `${definition.label}风险`);
  fillOptions(elements.ciFilter, CI_DEFINITIONS, "全部 CI");
  fillOptions(elements.detailStatus, STATUS_DEFINITIONS);
  fillOptions(elements.detailRisk, RISK_DEFINITIONS, "", (definition) => `${definition.label}风险`);
}

function hydratePreferences() {
  state.filters = {
    ...state.filters,
    ...(state.preferences.filters || {})
  };
  elements.queryInput.value = state.filters.query;
  elements.statusFilter.value = state.filters.status;
  elements.riskFilter.value = state.filters.risk;
  elements.ciFilter.value = state.filters.ciStatus;
  elements.groupSelect.value = state.filters.groupBy;
}

function persistPreferences() {
  savePreferences({ filters: state.filters });
}

async function importSample() {
  try {
    const response = await fetch(sampleUrl);
    if (!response.ok) throw new Error(`样例读取失败：${response.status}`);
    const payload = await response.text();
    importPayload(payload, "已导入样例数据。");
  } catch (error) {
    showError(error.message);
  }
}

async function importSampleForDemoUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("sample")) return;
  await importSample();
}

async function handleFileInput(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    importPayload(await file.text(), `已导入 ${file.name}。`);
    event.target.value = "";
  } catch (error) {
    showError(error.message);
  }
}

function openPasteDialog() {
  elements.pasteTextarea.value = "";
  elements.pasteDialog.showModal();
  queueMicrotask(() => elements.pasteTextarea.focus());
}

function handlePasteSubmit(event) {
  if (event.submitter !== elements.pasteImportButton) return;
  event.preventDefault();
  try {
    importPayload(elements.pasteTextarea.value, "已导入粘贴数据。");
    elements.pasteDialog.close();
  } catch (error) {
    showError(error.message);
  }
}

function importPayload(text, message) {
  const dataset = parseImportPayload(text);
  state.dataset = dataset;
  state.selectedId = dataset.items[0]?.id || "";
  saveDataset(dataset);
  clearError();
  render();
  showToast(message);
}

function clearLocalData() {
  if (!state.dataset.items.length) return;
  const confirmed = window.confirm("确定清空浏览器本地保存的评审数据吗？");
  if (!confirmed) return;
  state.dataset = normalizeDataset({ items: [] });
  state.selectedId = "";
  clearDataset();
  render();
  showToast("本地数据已清空。");
}

function resetFilters() {
  state.filters = {
    query: "",
    project: "",
    status: "",
    risk: "",
    ciStatus: "",
    groupBy: state.filters.groupBy || "status"
  };
  elements.queryInput.value = "";
  elements.projectFilter.value = "";
  elements.statusFilter.value = "";
  elements.riskFilter.value = "";
  elements.ciFilter.value = "";
  persistPreferences();
  render();
}

function exportCurrent(kind) {
  const items = getVisibleItems();
  if (!items.length) {
    showToast("当前没有可导出的条目。");
    return;
  }

  const options = {
    filters: state.filters,
    groupBy: state.filters.groupBy,
    generatedAt: new Date().toISOString()
  };
  const content = kind === "markdown" ? exportMarkdownReport(items, options) : exportJsonReport(items, options);
  const blob = createDownloadBlob(content, kind === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8");
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = createReportFileName(kind);
  link.click();
  URL.revokeObjectURL(href);
  showToast(kind === "markdown" ? "Markdown 报告已导出。" : "JSON 报告已导出。");
}

function handleDetailSubmit(event) {
  event.preventDefault();
  const noteText = elements.noteInput.value;
  try {
    saveDetailEdits();
    if (noteText.trim()) {
      state.dataset.items = addReviewNote(state.dataset.items, state.selectedId, noteText, "reviewer");
      elements.noteInput.value = "";
    }
    saveDataset(state.dataset);
    render();
    showToast("复核意见已保存。");
  } catch (error) {
    showError(error.message);
  }
}

function saveDetailEdits() {
  if (!state.selectedId) return;
  try {
    state.dataset.items = patchItem(state.dataset.items, state.selectedId, {
      status: elements.detailStatus.value,
      risk: elements.detailRisk.value,
      score: elements.detailScore.value
    });
    saveDataset(state.dataset);
    render({ keepFocus: true });
  } catch (error) {
    showError(error.message);
  }
}

function render(options = {}) {
  const filteredItems = getVisibleItems();
  const selectedStillVisible = filteredItems.some((item) => item.id === state.selectedId);
  if (!selectedStillVisible) {
    state.selectedId = filteredItems[0]?.id || state.dataset.items[0]?.id || "";
  }

  renderStorageStatus();
  renderFilters();
  renderMetrics(filteredItems);
  renderBoard(filteredItems);
  renderDetail();

  if (options.keepFocus) {
    const selectedControl = document.activeElement?.id;
    if (selectedControl) document.getElementById(selectedControl)?.focus();
  }
}

function renderStorageStatus() {
  const count = state.dataset.items.length;
  elements.storageStatus.textContent = count ? `${count} 条记录已保存在本地` : "本地离线工作台";
}

function renderFilters() {
  const options = getUniqueOptions(state.dataset.items);
  if (state.filters.project && !options.projects.includes(state.filters.project)) {
    state.filters.project = "";
    persistPreferences();
  }
  fillPlainOptions(elements.projectFilter, options.projects, "全部项目", state.filters.project);
}

function renderMetrics(items) {
  const stats = getDashboardStats(items);
  elements.metrics.replaceChildren(
    metricNode("条目", stats.total),
    metricNode("需关注", stats.needsAttention),
    metricNode("阻塞", stats.blockedCount),
    metricNode("均分", stats.averageScore || "暂无"),
    metricNode("现在处理", stats.byTriage.now)
  );
}

function renderBoard(items) {
  elements.resultCount.textContent = `${items.length} / ${state.dataset.items.length} 条记录`;
  const hasData = state.dataset.items.length > 0;
  elements.emptyState.hidden = hasData;
  elements.noResults.hidden = !hasData || items.length > 0;
  elements.groupContainer.hidden = !hasData || items.length === 0;
  elements.groupContainer.replaceChildren();

  if (!hasData || !items.length) return;

  for (const group of groupItems(items, state.filters.groupBy)) {
    elements.groupContainer.append(groupNode(group));
  }
}

function renderDetail() {
  const item = state.dataset.items.find((candidate) => candidate.id === state.selectedId);
  elements.detailEmpty.hidden = Boolean(item);
  elements.detailForm.hidden = !item;
  if (!item) return;

  elements.detailProject.textContent = `${item.project} · ${item.agent}`;
  elements.detailTitle.textContent = item.title;
  elements.detailRiskPill.textContent = `${RISK_DEFINITIONS[item.risk].label}风险`;
  elements.detailRiskPill.className = `risk-pill risk-${item.risk}`;
  elements.detailSummary.textContent = item.summary || "暂无摘要。";
  elements.detailStatus.value = item.status;
  elements.detailRisk.value = item.risk;
  elements.detailScore.value = item.score || "";

  elements.detailMeta.replaceChildren(
    metaNode("ID", item.id),
    metaNode("处理优先级", TRIAGE_DEFINITIONS[getTriageLane(item)].label),
    metaNode("分支", item.branch || "未提供"),
    metaNode("提交", item.commit || "未提供"),
    metaNode("标签", item.tags.length ? item.tags.join("、") : "无"),
    metaNode("更新时间", item.updatedAt ? formatLocalTime(item.updatedAt) : "未更新")
  );

  elements.detailFiles.replaceChildren(...listOrEmpty(item.files.map(fileNode), "没有文件信息。"));
  elements.detailChecks.replaceChildren(...listOrEmpty(item.ci.checks.map(checkNode), `CI 状态：${CI_DEFINITIONS[item.ci.status].label}`));
  elements.detailNotes.replaceChildren(...listOrEmpty(item.notes.map(noteNode), "暂无复核意见。"));
}

function groupNode(group) {
  const section = document.createElement("section");
  section.className = "group";

  const header = document.createElement("div");
  header.className = "group-header";
  header.innerHTML = `<h3>${escapeHtml(group.label)}</h3><span>${group.items.length} 条</span>`;

  const list = document.createElement("div");
  list.className = "item-list";
  for (const item of group.items) {
    list.append(taskRow(item));
  }

  section.append(header, list);
  return section;
}

function taskRow(item) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `task-row${item.id === state.selectedId ? " is-selected" : ""}`;
  row.addEventListener("click", () => {
    state.selectedId = item.id;
    render();
  });

  row.innerHTML = `
    <span class="task-main">
      <span class="task-title">${escapeHtml(item.title)}</span>
      <span class="task-summary">${escapeHtml(item.summary || "暂无摘要")}</span>
      <span class="task-meta">${escapeHtml(item.project)} · ${escapeHtml(item.agent)} · ${item.files.length} files</span>
    </span>
    <span><span class="pill status-${item.status}">${STATUS_DEFINITIONS[item.status].label}</span></span>
    <span><span class="pill risk-${item.risk}">${RISK_DEFINITIONS[item.risk].label}风险</span></span>
    <span><span class="pill ci-${item.ci.status}">CI ${CI_DEFINITIONS[item.ci.status].label}</span></span>
    <span><span class="pill triage-${getTriageLane(item)}">${TRIAGE_DEFINITIONS[getTriageLane(item)].label}</span></span>
    <span><span class="pill">${item.score ? `${item.score}/5` : "未评分"}</span></span>
  `;

  return row;
}

function metricNode(label, value) {
  const node = document.createElement("div");
  node.className = "metric";
  node.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
  return node;
}

function metaNode(label, value) {
  const fragment = document.createDocumentFragment();
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  fragment.append(term, description);
  return fragment;
}

function fileNode(file) {
  const item = document.createElement("li");
  const risk = file.risk ? ` · ${RISK_DEFINITIONS[file.risk].label}风险` : "";
  item.innerHTML = `<span class="file-path">${escapeHtml(file.path)}</span><span class="file-change">+${file.additions} / -${file.deletions}${risk}</span>`;
  return item;
}

function checkNode(check) {
  const item = document.createElement("li");
  item.innerHTML = `<strong>${escapeHtml(check.name)}</strong>：${CI_DEFINITIONS[check.status].label}${check.details ? `<span class="file-change">${escapeHtml(check.details)}</span>` : ""}`;
  return item;
}

function noteNode(note) {
  const item = document.createElement("li");
  const meta = [note.author, note.createdAt ? formatLocalTime(note.createdAt) : ""].filter(Boolean).join(" · ");
  item.innerHTML = `${escapeHtml(note.text)}${meta ? `<span class="note-meta">${escapeHtml(meta)}</span>` : ""}`;
  return item;
}

function listOrEmpty(nodes, text) {
  if (nodes.length) return nodes;
  const item = document.createElement("li");
  item.textContent = text;
  return [item];
}

function getVisibleItems() {
  return filterItems(state.dataset.items, state.filters);
}

function fillOptions(select, definitions, emptyLabel = "", format = (definition) => definition.label) {
  select.replaceChildren();
  if (emptyLabel) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
  }
  for (const [key, definition] of Object.entries(definitions)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = format(definition);
    select.append(option);
  }
}

function fillPlainOptions(select, values, emptyLabel, selectedValue) {
  select.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  select.append(empty);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.value = selectedValue;
}

function showError(message) {
  elements.errorPanel.textContent = message;
  elements.errorPanel.hidden = false;
  showToast(message);
}

function clearError() {
  elements.errorPanel.textContent = "";
  elements.errorPanel.hidden = true;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2600);
}

function formatLocalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      elements.storageStatus.textContent = "本地工作台，Service Worker 注册失败";
    });
  });
}

importSampleForDemoUrl();
