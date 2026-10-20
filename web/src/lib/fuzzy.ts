// Forgiving title matching for predictive search: prefixes, any word, initials ("lotr"),
// typos ("breking bad", "matrx") and missing punctuation all find the right title.

export interface Searchable {
  name: string;
  alt?: string; // original title, sort title
}

const ARTICLES = new Set(['the', 'a', 'an']);

/** Lower case, accents removed, "&" → "and", punctuation → spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Damerau-Levenshtein distance (adjacent swaps count as one edit), stopping early past `max`. */
let r0 = new Int32Array(64);
let r1 = new Int32Array(64);
let r2 = new Int32Array(64);
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const cols = b.length + 1;
  if (cols > r0.length) {
    r0 = new Int32Array(cols * 2);
    r1 = new Int32Array(cols * 2);
    r2 = new Int32Array(cols * 2);
  }
  let prev2 = r0;
  let prev = r1;
  let cur = r2;
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j < cols; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === bj ? 0 : 1));
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[b.length];
}

/** How many typos to forgive for a word of this length. */
function allowance(len: number): number {
  return len <= 3 ? 0 : len <= 6 ? 1 : 2;
}

/** Is `word` a prefix of `target`, allowing a few typos? Returns typos used, or -1. */
function fuzzyPrefix(word: string, target: string): number {
  if (target.startsWith(word)) return 0;
  // Dropped letters, as people type fast: "dep" → "deep", "brkng" → "breaking".
  const skipped = () => word.length >= 3 && word[0] === target[0] && isSubsequence(word, target.slice(0, word.length * 2));
  const max = allowance(word.length);
  if (!max) return skipped() ? 1 : -1;
  // Compare against target prefixes of similar length (a typo can add or drop a letter).
  let best = max + 1;
  for (let len = Math.max(1, word.length - max); len <= Math.min(target.length, word.length + max); len++) {
    best = Math.min(best, editDistance(word, target.slice(0, len), max));
    if (best === 0) break;
  }
  return best <= max ? best : skipped() ? max : -1;
}

/**
 * Score how well a query matches a title (0 = no match). Higher is better:
 * exact > starts with > every word matches a word > contains > initials > typo matches > loose letters.
 */
interface Prepared {
  t: string;
  words: string[];
  sig: string[];
  tNoArticle: string;
  ts: string;
  ini: string;
  iniSig: string;
}
const prepared = new WeakMap<Searchable, Prepared[]>();

function prepare(item: Searchable): Prepared[] {
  let p = prepared.get(item);
  if (p) return p;
  p = [];
  for (const raw of [item.name, item.alt]) {
    if (!raw) continue;
    const t = normalize(raw);
    if (!t) continue;
    const words = t.split(' ');
    const sig = words.filter((w) => !ARTICLES.has(w));
    const tNoArticle = sig.join(' ');
    p.push({ t, words, sig, tNoArticle, ts: tNoArticle.replace(/ /g, ''), ini: initials(words), iniSig: initials(sig) });
  }
  prepared.set(item, p);
  return p;
}

export function score(query: string, item: Searchable): number {
  return scoreNormalized(normalize(query), item);
}

function scoreNormalized(q: string, item: Searchable): number {
  if (!q) return 0;
  let best = 0;
  const qWords = q.split(' ');
  const qs = q.replace(/ /g, '');
  for (const { t, words, tNoArticle, ts, ini, iniSig } of prepare(item)) {
    let s = 0;
    if (t === q || tNoArticle === q) s = 1000;
    else if (t.startsWith(q) || tNoArticle.startsWith(q)) s = 900 - Math.min(100, t.length - q.length);
    else {
      // Every typed word starts some word of the title, in order ("dark kn" → "The Dark Knight").
      let wi = 0;
      let typos = 0;
      let ok = true;
      for (const qw of qWords) {
        let found = false;
        while (wi < words.length) {
          const used = fuzzyPrefix(qw, words[wi++]);
          if (used >= 0) {
            typos += used;
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          break;
        }
      }
      if (ok) s = (typos ? 640 : 800) - typos * 40 - Math.min(60, words.length * 4);
      else if (t.includes(q)) s = 700;
      else if (q.length >= 2 && qWords.length === 1 && (ini === q || iniSig === q)) s = 680;
      else if (q.length >= 2 && qWords.length === 1 && (ini.startsWith(q) || iniSig.startsWith(q))) s = 560;
      else {
        // Typos across the whole title, ignoring spaces ("spiderman" → "Spider-Man").
        const max = allowance(qs.length);
        if (max && ts.length >= qs.length - max) {
          const d = Math.min(editDistance(qs, ts, max), fuzzyPrefixDistance(qs, ts, max));
          if (d <= max) s = 600 - d * 60;
        }
        if (!s && qs.length >= 4 && isSubsequence(qs, ts)) s = 300;
      }
    }
    best = Math.max(best, s);
  }
  return best;
}

function fuzzyPrefixDistance(q: string, t: string, max: number): number {
  let best = max + 1;
  for (let len = Math.max(1, q.length - max); len <= Math.min(t.length, q.length + max); len++) best = Math.min(best, editDistance(q, t.slice(0, len), max));
  return best;
}

function initials(words: string[]): string {
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0] ?? '')).join('');
}

function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length;
}

/** Rank items for a query; ties go to the given tiebreak (e.g. newer or better rated first). */
export function rank<T extends Searchable>(query: string, items: T[], limit: number, tiebreak?: (a: T, b: T) => number): { item: T; score: number }[] {
  const out: { item: T; score: number }[] = [];
  const q = normalize(query);
  for (const item of items) {
    const s = scoreNormalized(q, item);
    if (s > 0) out.push({ item, score: s });
  }
  out.sort((a, b) => b.score - a.score || (tiebreak ? tiebreak(a.item, b.item) : 0) || a.item.name.localeCompare(b.item.name));
  return out.slice(0, limit);
}
