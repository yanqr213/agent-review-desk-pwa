import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addReviewNote,
  clampScore,
  filterItems,
  getDashboardStats,
  getUniqueOptions,
  groupItems,
  inferRisk,
  normalizeCheck,
  normalizeCi,
  normalizeDataset,
  normalizeFile,
  normalizeItem,
  normalizeRisk,
  normalizeStatus,
  parseImportPayload,
  patchItem,
  sortItems,
  toPortableDataset
} from "../src/domain.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function fixture(overrides = {}) {
  return {
    id: "item-1",
    title: "Fix checkout redirect",
    project: "checkout",
    agent: "codex-a",
    summary: "Update redirect behavior",
    status: "new",
    risk: "medium",
    ci: { status: "passed" },
    files: [{ path: "src/checkout.ts", additions: 20, deletions: 2 }],
    tags: ["auth"],
    notes: [],
    ...overrides
  };
}

test("parseImportPayload parses an object with items", () => {
  const dataset = parseImportPayload(JSON.stringify({ items: [fixture()] }));
  assert.equal(dataset.items.length, 1);
  assert.equal(dataset.items[0].title, "Fix checkout redirect");
});

test("parseImportPayload parses a top-level array", () => {
  const dataset = parseImportPayload(JSON.stringify([fixture({ id: "array-item" })]));
  assert.equal(dataset.items[0].id, "array-item");
});

test("parseImportPayload reports invalid JSON", () => {
  assert.throws(() => parseImportPayload("{oops"), /JSON 解析失败/);
});

test("normalizeDataset accepts tasks as an alias", () => {
  const dataset = normalizeDataset({ tasks: [fixture({ id: "task-alias" })] });
  assert.equal(dataset.items[0].id, "task-alias");
});

test("normalizeDataset rejects missing arrays", () => {
  assert.throws(() => normalizeDataset({ records: [] }), /items\/tasks/);
});

test("normalizeDataset rejects duplicate ids", () => {
  assert.throws(() => normalizeDataset({ items: [fixture(), fixture()] }), /重复 id/);
});

test("normalizeItem requires a title-like field", () => {
  assert.throws(() => normalizeItem({ id: "x" }), /缺少 title/);
});

test("normalizeItem uses task as title alias", () => {
  const item = normalizeItem({ task: "Run smoke tests" });
  assert.equal(item.title, "Run smoke tests");
});

test("normalizeItem generates stable fallback ids", () => {
  const item = normalizeItem({ title: "Run smoke tests", project: "ops console" });
  assert.equal(item.id, "ops-console-run-smoke-tests");
});

test("normalizeStatus handles common aliases", () => {
  assert.equal(normalizeStatus("in progress"), "reviewing");
  assert.equal(normalizeStatus("needs_changes"), "needs-changes");
  assert.equal(normalizeStatus("done"), "approved");
});

test("normalizeRisk handles common aliases", () => {
  assert.equal(normalizeRisk("major"), "high");
  assert.equal(normalizeRisk("blocker"), "critical");
  assert.equal(normalizeRisk("normal"), "medium");
});

test("normalizeCi infers failed when any check fails", () => {
  const ci = normalizeCi({ checks: [{ name: "unit", status: "passed" }, { name: "e2e", status: "failed" }] });
  assert.equal(ci.status, "failed");
});

test("normalizeCi infers passed when all checks pass", () => {
  const ci = normalizeCi({ checks: [{ name: "unit", status: "passed" }] });
  assert.equal(ci.status, "passed");
});

test("normalizeCheck accepts string shorthand", () => {
  const check = normalizeCheck("lint");
  assert.deepEqual(check, { name: "lint", status: "unknown", duration: "", details: "" });
});

test("normalizeFile accepts string shorthand", () => {
  const file = normalizeFile("src/app.js");
  assert.deepEqual(file, { path: "src/app.js", additions: 0, deletions: 0, risk: "" });
});

test("normalizeItem infers blocked status from failed CI", () => {
  const item = normalizeItem({ title: "Broken task", ci: { status: "failed" } });
  assert.equal(item.status, "blocked");
});

test("inferRisk returns critical for critical files", () => {
  const risk = inferRisk({
    ci: { status: "passed" },
    files: [{ path: "db.sql", additions: 1, deletions: 0, risk: "critical" }],
    tags: []
  });
  assert.equal(risk, "critical");
});

test("inferRisk returns high for security-like tags", () => {
  const risk = inferRisk({ ci: { status: "passed" }, files: [], tags: ["security"] });
  assert.equal(risk, "high");
});

test("inferRisk considers large changes high risk", () => {
  const risk = inferRisk({
    ci: { status: "passed" },
    files: [{ path: "big.ts", additions: 700, deletions: 110 }],
    tags: []
  });
  assert.equal(risk, "high");
});

test("clampScore clamps values to the 1-5 range", () => {
  assert.equal(clampScore(9), 5);
  assert.equal(clampScore(-2), 1);
  assert.equal(clampScore(""), null);
});

test("filterItems searches title, files, tags, and notes", () => {
  const items = normalizeDataset({
    items: [
      fixture({ id: "a", title: "Checkout auth", notes: ["manual replay"], files: ["src/auth.ts"] }),
      fixture({ id: "b", title: "Docs update", project: "docs", tags: ["process"], files: ["README.md"] })
    ]
  }).items;

  assert.equal(filterItems(items, { query: "manual" }).length, 1);
  assert.equal(filterItems(items, { query: "README" }).length, 1);
  assert.equal(filterItems(items, { query: "process" }).length, 1);
});

test("filterItems combines project, status, risk, and ci filters", () => {
  const items = normalizeDataset({
    items: [
      fixture({ id: "a", project: "checkout", status: "blocked", risk: "high", ci: { status: "failed" } }),
      fixture({ id: "b", project: "docs", status: "approved", risk: "low", ci: { status: "passed" } })
    ]
  }).items;

  const filtered = filterItems(items, {
    project: "checkout",
    status: "blocked",
    risk: "high",
    ciStatus: "failed"
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "a");
});

test("groupItems groups by status with definition labels", () => {
  const items = normalizeDataset({
    items: [
      fixture({ id: "a", status: "approved" }),
      fixture({ id: "b", status: "blocked" })
    ]
  }).items;

  const groups = groupItems(items, "status");
  assert.deepEqual(groups.map((group) => group.label), ["阻塞", "已通过"]);
});

test("groupItems groups by project", () => {
  const items = normalizeDataset({
    items: [fixture({ id: "a", project: "b" }), fixture({ id: "b", project: "a" })]
  }).items;

  assert.deepEqual(groupItems(items, "project").map((group) => group.key), ["a", "b"]);
});

test("sortItems prioritizes higher risk", () => {
  const items = normalizeDataset({
    items: [
      fixture({ id: "low", title: "Low", risk: "low" }),
      fixture({ id: "critical", title: "Critical", risk: "critical" })
    ]
  }).items;

  assert.equal(sortItems(items)[0].id, "critical");
});

test("getDashboardStats summarizes score and attention counts", () => {
  const items = normalizeDataset({
    items: [
      fixture({ id: "a", status: "blocked", risk: "high", score: 2, ci: { status: "failed" } }),
      fixture({ id: "b", status: "approved", risk: "low", score: 4, ci: { status: "passed" } })
    ]
  }).items;

  const stats = getDashboardStats(items);
  assert.equal(stats.total, 2);
  assert.equal(stats.blockedCount, 1);
  assert.equal(stats.needsAttention, 1);
  assert.equal(stats.averageScore, 3);
});

test("getDashboardStats totals file changes", () => {
  const items = normalizeDataset({
    items: [
      fixture({ id: "a", files: [{ path: "a.ts", additions: 5, deletions: 3 }] }),
      fixture({ id: "b", files: [{ path: "b.ts", additions: 2, deletions: 1 }] })
    ]
  }).items;

  const stats = getDashboardStats(items);
  assert.equal(stats.changedFiles, 2);
  assert.equal(stats.additions, 7);
  assert.equal(stats.deletions, 4);
});

test("getUniqueOptions returns sorted projects, agents, and tags", () => {
  const items = normalizeDataset({
    items: [
      fixture({ id: "a", project: "z", agent: "b", tags: ["beta"] }),
      fixture({ id: "b", project: "a", agent: "a", tags: ["alpha", "beta"] })
    ]
  }).items;

  assert.deepEqual(getUniqueOptions(items), {
    projects: ["a", "z"],
    agents: ["a", "b"],
    tags: ["alpha", "beta"]
  });
});

test("patchItem updates status, risk, and score without mutating the original item", () => {
  const items = normalizeDataset({ items: [fixture()] }).items;
  const next = patchItem(items, "item-1", { status: "approved", risk: "low", score: 5, updatedAt: "2026-01-01T00:00:00Z" });

  assert.equal(next[0].status, "approved");
  assert.equal(next[0].risk, "low");
  assert.equal(next[0].score, 5);
  assert.equal(items[0].status, "new");
});

test("patchItem throws when id is unknown", () => {
  const items = normalizeDataset({ items: [fixture()] }).items;
  assert.throws(() => patchItem(items, "missing", { score: 4 }), /未找到条目/);
});

test("addReviewNote appends a normalized note", () => {
  const items = normalizeDataset({ items: [fixture()] }).items;
  const next = addReviewNote(items, "item-1", "Review this manually", "ana", "2026-06-08T00:00:00.000Z");

  assert.equal(next[0].notes.length, 1);
  assert.equal(next[0].notes[0].author, "ana");
  assert.equal(next[0].notes[0].text, "Review this manually");
});

test("addReviewNote rejects blank notes", () => {
  const items = normalizeDataset({ items: [fixture()] }).items;
  assert.throws(() => addReviewNote(items, "item-1", " "), /不能为空/);
});

test("toPortableDataset sorts and clones items", () => {
  const items = normalizeDataset({
    items: [
      fixture({ id: "low", title: "Low", risk: "low" }),
      fixture({ id: "critical", title: "Critical", risk: "critical" })
    ]
  }).items;
  const portable = toPortableDataset(items, { exportedAt: "2026-06-08T00:00:00.000Z" });
  portable.items[0].title = "changed";

  assert.equal(portable.exportedAt, "2026-06-08T00:00:00.000Z");
  assert.equal(portable.items[0].id, "critical");
  assert.equal(items.find((item) => item.id === "critical").title, "Critical");
});

test("sample fixture parses successfully", async () => {
  const sample = await readFile(join(root, "sample-data", "agent-review-sample.json"), "utf8");
  const dataset = parseImportPayload(sample);
  assert.equal(dataset.items.length, 6);
  assert.equal(dataset.items.some((item) => item.risk === "critical"), true);
});
