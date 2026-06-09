import test from "node:test";
import assert from "node:assert/strict";
import {
  createReportFileName,
  exportJsonReport,
  exportMarkdownReport,
  buildReportModel
} from "../src/report.js";
import { normalizeDataset } from "../src/domain.js";

function items() {
  return normalizeDataset({
    items: [
      {
        id: "critical-task",
        title: "Critical migration",
        project: "billing",
        agent: "codex-a",
        status: "blocked",
        risk: "critical",
        score: 2,
        summary: "Needs DBA review",
        tags: ["database"],
        ci: {
          status: "passed",
          checks: [{ name: "migration-dry-run", status: "passed", details: "fixture only" }]
        },
        files: [{ path: "db/migration.sql", additions: 50, deletions: 0, risk: "critical" }],
        notes: [{ text: "Wait for approval", author: "lead" }]
      },
      {
        id: "docs-task",
        title: "Docs update",
        project: "docs",
        agent: "codex-b",
        status: "approved",
        risk: "low",
        score: 5,
        ci: { status: "passed" },
        files: ["README.md"],
        notes: []
      }
    ]
  }).items;
}

test("buildReportModel includes stats and grouped items", () => {
  const model = buildReportModel(items(), { groupBy: "project", generatedAt: "2026-06-08T00:00:00.000Z" });
  assert.equal(model.stats.total, 2);
  assert.equal(model.groups.length, 2);
  assert.equal(model.groups[0].key, "billing");
});

test("exportJsonReport emits portable JSON", () => {
  const report = exportJsonReport(items(), { exportedAt: "2026-06-08T00:00:00.000Z", filters: { risk: "critical" } });
  const parsed = JSON.parse(report);
  assert.equal(parsed.source, "agent-review-desk-pwa");
  assert.equal(parsed.filters.risk, "critical");
  assert.equal(parsed.items[0].id, "critical-task");
});

test("exportMarkdownReport includes overview and item details", () => {
  const report = exportMarkdownReport(items(), {
    title: "Weekly Review",
    reviewer: "Ana",
    generatedAt: "2026-06-08T00:00:00.000Z",
    groupBy: "project"
  });

  assert.match(report, /^# Weekly Review/);
  assert.match(report, /条目总数：2/);
  assert.match(report, /处理优先级/);
  assert.match(report, /优先处理队列/);
  assert.match(report, /现在处理/);
  assert.match(report, /Critical migration/);
  assert.match(report, /Wait for approval/);
  assert.match(report, /db\/migration\.sql/);
});

test("exportMarkdownReport escapes markdown syntax in titles", () => {
  const special = normalizeDataset({
    items: [
      {
        id: "x",
        title: "Fix [auth] *flow*",
        status: "new",
        risk: "low",
        ci: { status: "unknown" }
      }
    ]
  }).items;
  const report = exportMarkdownReport(special);
  assert.equal(report.includes("Fix \\[auth\\] \\*flow\\*"), true);
});

test("createReportFileName creates timestamped markdown names", () => {
  const name = createReportFileName("markdown", new Date("2026-06-08T01:02:03.000Z"));
  assert.equal(name, "agent-review-report-20260608010203.md");
});

test("createReportFileName creates timestamped json names", () => {
  const name = createReportFileName("json", new Date("2026-06-08T01:02:03.000Z"));
  assert.equal(name, "agent-review-report-20260608010203.json");
});
