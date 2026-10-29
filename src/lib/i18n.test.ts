// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { EN } from './messages.en';
import { getLocale, LOCALES, setLocale, t } from './i18n';

afterEach(() => setLocale('zh'));

describe('interface language', () => {
  it('starts in Chinese for the tests, whatever the machine prefers', () => {
    expect(getLocale()).toBe('zh');
  });

  it('returns the key itself in Chinese, so a message can never go missing', () => {
    expect(t('打开')).toBe('打开');
    // A message with no translation at all still shows its Chinese.
    setLocale('en');
    expect(t('这条消息故意没有英文')).toBe('这条消息故意没有英文');
  });

  it('translates in English and fills the placeholders in either language', () => {
    expect(t('已打开 {names}', { names: 'pUC19' })).toBe('已打开 pUC19');
    setLocale('en');
    expect(t('打开')).toBe('Open');
    expect(t('已打开 {names}', { names: 'pUC19' })).toBe('Opened pUC19');
    // An unknown placeholder is left as it stands rather than becoming "undefined".
    expect(t('已打开 {names}')).toBe('Opened {names}');
  });

  it('offers both languages, each with the lang attribute it needs', () => {
    expect(LOCALES.map((l) => l.value)).toEqual(['zh', 'en']);
    expect(LOCALES.map((l) => l.htmlLang)).toEqual(['zh-CN', 'en']);
  });

  it('gives every English message the same placeholders as its key', () => {
    const names = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    const wrong: string[] = [];
    for (const [key, value] of Object.entries(EN)) {
      if (names(key).join() !== names(value).join()) wrong.push(key);
    }
    expect(wrong).toEqual([]);
  });

  it('leaves no English entry empty or identical to a Chinese key by accident', () => {
    const blank = Object.entries(EN).filter(([, value]) => !value.trim());
    expect(blank).toEqual([]);
    const stillChinese = Object.entries(EN).filter(([, value]) => /[一-鿿]/.test(value));
    expect(stillChinese).toEqual([]);
  });
});
