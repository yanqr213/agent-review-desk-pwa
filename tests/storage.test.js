import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDataset,
  loadDataset,
  loadPreferences,
  saveDataset,
  savePreferences
} from "../src/storage.js";
import { normalizeDataset } from "../src/domain.js";

function memoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

test("loadDataset returns an empty dataset when storage is empty", () => {
  const dataset = loadDataset(memoryStorage());
  assert.deepEqual(dataset.items, []);
});

test("saveDataset and loadDataset round-trip normalized data", () => {
  const storage = memoryStorage();
  const dataset = normalizeDataset({ items: [{ id: "x", title: "Task" }] });
  saveDataset(dataset, storage);

  assert.equal(loadDataset(storage).items[0].id, "x");
});

test("loadDataset falls back to empty data for corrupted storage", () => {
  const storage = memoryStorage();
  storage.setItem("agent-review-desk:v1", "{bad");
  assert.deepEqual(loadDataset(storage).items, []);
});

test("clearDataset removes stored data", () => {
  const storage = memoryStorage();
  const dataset = normalizeDataset({ items: [{ id: "x", title: "Task" }] });
  saveDataset(dataset, storage);
  clearDataset(storage);

  assert.deepEqual(loadDataset(storage).items, []);
});

test("preferences round-trip", () => {
  const storage = memoryStorage();
  savePreferences({ filters: { risk: "high" } }, storage);

  assert.deepEqual(loadPreferences(storage), { filters: { risk: "high" } });
});

test("loadPreferences falls back to empty object for corrupted storage", () => {
  const storage = memoryStorage();
  storage.setItem("agent-review-desk:preferences", "{bad");
  assert.deepEqual(loadPreferences(storage), {});
});
