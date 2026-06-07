import { es, type I18nKeys } from './es.js';
import { en } from './en.js';

export type Locale = 'es' | 'en';

const translations: Record<Locale, Record<I18nKeys, string>> = { es, en };

let currentLocale: Locale = (localStorage.getItem('fmr_locale') as Locale) ?? 'es';

export function setLocale(locale: Locale) {
  currentLocale = locale;
  localStorage.setItem('fmr_locale', locale);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: I18nKeys): string {
  return translations[currentLocale][key] ?? translations.es[key] ?? key;
}
