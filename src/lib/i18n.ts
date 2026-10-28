// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Interface language. The source of every message is its Chinese text, which is also its
// key, so a missing translation shows the Chinese rather than a key or an empty string.
// Both the app and the view modules use this, which is why it lives in lib/.
import { useSyncExternalStore } from 'react';
import { EN } from './messages.en';

export type Locale = 'zh' | 'en';

export const LOCALES: Array<{ value: Locale; label: string; htmlLang: string }> = [
  { value: 'zh', label: '简体中文', htmlLang: 'zh-CN' },
  { value: 'en', label: 'English', htmlLang: 'en' },
];

const STORAGE_KEY = 'gatc.locale';

function initial(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // Storage may be unavailable; fall through to the browser's own preference.
  }
  const preferred = globalThis.navigator?.language ?? '';
  return /^zh\b/i.test(preferred) || !preferred ? 'zh' : 'en';
}

let locale: Locale = initial();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Not being able to remember the choice does not stop it taking effect now.
  }
  applyHtmlLang();
  for (const listener of listeners) listener();
}

/** Keeps `<html lang>` in step, which screen readers and hyphenation rely on. */
export function applyHtmlLang(): void {
  const element = globalThis.document?.documentElement;
  if (!element) return;
  element.lang = LOCALES.find((l) => l.value === locale)?.htmlLang ?? 'zh-CN';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The message for the current language. `zh` returns the key itself, so the Chinese
 * text in the source is always what is shown and can never go missing.
 * Placeholders are written `{name}` and filled from `vars`.
 */
export function t(message: string, vars?: Record<string, string | number>): string {
  const text = locale === 'en' ? (EN[message] ?? message) : message;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** `t` bound to the current language, re-rendering the component when it changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLocale, () => 'zh' as Locale);
  return t;
}

/** The current language, for components that branch on it rather than translate. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => 'zh' as Locale);
}

/** Every message that has an English translation, for the completeness test. */
export function translatedKeys(): string[] {
  return Object.keys(EN);
}
