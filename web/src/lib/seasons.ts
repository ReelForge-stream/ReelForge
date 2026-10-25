import type { Estimate } from './types';

export interface SeasonGroup {
  key: string;
  number: number | null;
  episodes: Estimate[];
  size: number;
  after: number;
  saves: number;
}

export interface ShowGroup {
  key: string;
  name: string;
  seasons: SeasonGroup[];
  episodes: Estimate[];
  size: number;
  after: number;
  saves: number;
}

const sum = (list: Estimate[]) => ({
  size: list.reduce((a, c) => a + c.SizeBytes, 0),
  after: list.reduce((a, c) => a + c.EstimatedBytes, 0),
  saves: list.reduce((a, c) => a + c.SavingsBytes, 0),
});

/** Splits a Space Saver result into movies and shows → seasons → episodes (in episode order), biggest savings first. */
export function groupBySeason(cands: Estimate[]): { movies: Estimate[]; shows: ShowGroup[] } {
  const movies: Estimate[] = [];
  const byShow = new Map<string, { name: string; seasons: Map<string, { number: number | null; episodes: Estimate[] }> }>();
  for (const c of cands) {
    if (c.Kind !== 'Episode') {
      movies.push(c);
      continue;
    }
    const name = c.SeriesName || c.Title.replace(/\s+S\d+E\d+.*$/i, '') || 'Unknown show';
    const showKey = c.SeriesId || `name:${name.toLowerCase()}`;
    const show = byShow.get(showKey) ?? { name, seasons: new Map() };
    byShow.set(showKey, show);
    const number = c.SeasonNumber ?? null;
    const seasonKey = `${showKey}|${number ?? 'x'}`;
    const season = show.seasons.get(seasonKey) ?? { number, episodes: [] };
    show.seasons.set(seasonKey, season);
    season.episodes.push(c);
  }

  const shows: ShowGroup[] = [...byShow.entries()].map(([key, s]) => {
    const seasons: SeasonGroup[] = [...s.seasons.entries()]
      .map(([k, v]) => {
        const episodes = [...v.episodes].sort((a, b) => (a.EpisodeNumber ?? 9999) - (b.EpisodeNumber ?? 9999) || a.Title.localeCompare(b.Title));
        return { key: k, number: v.number, episodes, ...sum(episodes) };
      })
      // Specials (season 0) and unknown seasons go last.
      .sort((a, b) => (a.number || 9999) - (b.number || 9999));
    const episodes = seasons.flatMap((x) => x.episodes);
    return { key, name: s.name, seasons, episodes, ...sum(episodes) };
  });
  shows.sort((a, b) => b.saves - a.saves);
  return { movies, shows };
}

export function seasonLabel(n: number | null): string {
  return n == null ? 'Other episodes' : n === 0 ? 'Specials' : `Season ${n}`;
}
