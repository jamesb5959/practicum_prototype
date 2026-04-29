import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export const CLASSIFICATION_LEVELS = ['UNCLASSIFIED', 'CUI', 'CLASSIFIED'] as const;
export type ClassificationLevel = (typeof CLASSIFICATION_LEVELS)[number];

const STORAGE_KEY = 'app_classification_level';

export const activeClassification = writable<ClassificationLevel>('UNCLASSIFIED');

export function initClassification() {
  if (!browser) return;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && CLASSIFICATION_LEVELS.includes(stored as ClassificationLevel)) {
    activeClassification.set(stored as ClassificationLevel);
  }
}

export function setClassification(level: ClassificationLevel) {
  activeClassification.set(level);
  if (browser) {
    localStorage.setItem(STORAGE_KEY, level);
  }
}
