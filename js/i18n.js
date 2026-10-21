import { sdkLocale } from './platform.js';
import es from '../locales/es.js';
import fr from '../locales/fr.js';
import de from '../locales/de.js';
import pt from '../locales/pt.js';
import ru from '../locales/ru.js';
import tr from '../locales/tr.js';
import ja from '../locales/ja.js';
import zh from '../locales/zh.js';

// Localisation. The English text is the key: t('Play') returns the player's-language version, or the English
// text itself when there isn't one. {name} placeholders are filled from `vars`. The language is chosen once,
// before the game builds its interface (so data tables can call t() when they are defined), in this order:
// ?lang=xx in the address (for testing), the CrazyGames SDK locale, then the browser's languages. To add a language, add locales/xx.js and list it below.

const DICTS = { en: null, es, fr, de, pt, ru, tr, ja, zh };

// "pt-BR" -> "pt", "zh-Hans-CN" -> "zh"; null if that language isn't supported.
const supported = (code) => {
  const base = String(code || '').toLowerCase().split(/[-_]/)[0];
  return base in DICTS ? base : null;
};

async function detect() {
  const fromUrl = supported(new URLSearchParams(location.search).get('lang'));
  if (fromUrl) return fromUrl;
  const fromSdk = supported(await sdkLocale());
  if (fromSdk) return fromSdk;
  for (const l of navigator.languages || [navigator.language]) {
    const s = supported(l);
    if (s) return s;
  }
  return 'en';
}

export const lang = await detect();
const dict = DICTS[lang];
document.documentElement.lang = lang;
export const missing = new Set(); // English strings with no translation yet (for checking a language is complete)
window.__i18nMissing = missing;

export function t(text, vars) {
  let s = text;
  if (dict) {
    if (text in dict) s = dict[text];
    else if (/\p{L}/u.test(text)) missing.add(text);
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}

// Upper-case in the player's language (Turkish dotted/dotless i, for one).
export const upper = (s) => s.toLocaleUpperCase(lang);

// Translate the static page: text of elements with no child elements, title attributes and aria-labels.
export function translatePage(root = document) {
  const leaf = (el) => {
    for (const attr of ['title', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (v) el.setAttribute(attr, t(v));
    }
    if (el.children.length) return;
    // Keep any child text nodes' emoji/spacing: the whole trimmed text is the key.
    const text = el.textContent.trim();
    if (text) el.textContent = el.textContent.replace(text, () => t(text));
  };
  for (const el of root.querySelectorAll('body *:not(script):not(style):not(canvas)')) {
    if (el.closest('.help')) continue;
    leaf(el);
  }
}
