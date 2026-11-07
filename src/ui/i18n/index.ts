import { en } from './en.ts';
import { es, type MessageKey, type Messages } from './es.ts';

export type Lang = 'es' | 'en';
export type { MessageKey };

const catalogs: Record<Lang, Messages> = { es, en };
const STORAGE_KEY = 'acoustic-modem.lang';
const listeners = new Set<() => void>();

function initialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'es' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current: Lang = initialLang();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  for (const listener of listeners) listener();
}

/** Registers a callback run whenever the language changes. */
export function onLangChange(listener: () => void): void {
  listeners.add(listener);
}

/** Translates `key`, replacing `{name}` placeholders with `params`. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return catalogs[current][key].replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

/** Formats a number with the current language's decimal separator. */
export function num(value: number, digits = 1): string {
  return value.toLocaleString(current === 'es' ? 'es-ES' : 'en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
