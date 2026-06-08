import { createEmptyDataset, normalizeDataset } from "./domain.js";

const STORAGE_KEY = "agent-review-desk:v1";
const PREFERENCES_KEY = "agent-review-desk:preferences";

export function loadDataset(storage = globalThis.localStorage) {
  if (!storage) return createEmptyDataset();
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return createEmptyDataset();

  try {
    return normalizeDataset(JSON.parse(raw));
  } catch {
    return createEmptyDataset();
  }
}

export function saveDataset(dataset, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(dataset));
}

export function clearDataset(storage = globalThis.localStorage) {
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}

export function loadPreferences(storage = globalThis.localStorage) {
  if (!storage) return {};
  try {
    return JSON.parse(storage.getItem(PREFERENCES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function savePreferences(preferences, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
