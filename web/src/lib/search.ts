import type { Api } from './api';
import { rank, score } from './fuzzy';
import type { Item } from './types';

// The title list is fetched once and reused for a few minutes, so suggestions appear as fast as you type.
let cache: { user: string; at: number; items: Promise<Item[]> } | null = null;
const TTL = 5 * 60 * 1000;

export function titleIndex(api: Api): Promise<Item[]> {
  if (!cache || cache.user !== api.userId || Date.now() - cache.at > TTL) {
    const items = api.titleIndex().catch((e) => {
      cache = null;
      throw e;
    });
    cache = { user: api.userId, at: Date.now(), items };
  }
  return cache.items;
}

export function forgetTitleIndex() {
  cache = null;
}

/** Best matches first; equally good matches go to the better rated, then newer, title. */
// Keep one searchable entry per title so the matcher's prepared text is reused between keystrokes.
const entries = new WeakMap<Item[], { name: string; alt?: string; item: Item }[]>();

export function searchTitles(query: string, items: Item[], limit: number) {
  let list = entries.get(items);
  if (!list) {
    list = items.map((i) => ({ name: i.Name, alt: i.OriginalTitle && i.OriginalTitle !== i.Name ? i.OriginalTitle : undefined, item: i }));
    entries.set(items, list);
  }
  const ranked = rank(
    query,
    list,
    limit,
    (a, b) => (b.item.CommunityRating ?? 0) - (a.item.CommunityRating ?? 0) || (b.item.ProductionYear ?? 0) - (a.item.ProductionYear ?? 0),
  );
  // When there are good matches, drop the far-fetched ones (loose letter matches) so the list stays clean.
  const top = ranked[0]?.score ?? 0;
  const floor = top >= 850 ? 650 : top >= 700 ? 560 : top >= 500 ? 300 : 0;
  return ranked.filter((r) => r.score >= floor).map((r) => ({ item: r.item.item, score: r.score }));
}

/** True when the best result is only a typo-level match (show "closest matches"). */
export function onlyClose(query: string, best?: Item): boolean {
  return !!best && score(query, { name: best.Name, alt: best.OriginalTitle }) < 650;
}
