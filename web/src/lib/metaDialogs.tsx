import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { MatchResult } from './api';
import { publishItem } from './itemMenu';
import { forgetTitleIndex } from './search';
import type { Item } from './types';
import { Icon, useApi, useToast } from './ui';

/** Shared modal frame for the title editors. */
export function Modal({ title, sub, onClose, busy, children, wide }: { title: string; sub: string; onClose: () => void; busy: boolean; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);
  return (
    <div className="dialog-back art-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`art-dialog${wide ? '' : ' narrow'}`} role="dialog" aria-modal="true" aria-label={`${title}: ${sub}`}>
        <header className="art-head">
          <div>
            <h2>{title}</h2>
            <p className="muted">{sub}</p>
          </div>
          <button className="details-close static" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon.close />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const label = (i: Item) => (i.Type === 'Episode' ? `${i.SeriesName ?? ''} · ${i.Name}` : i.Name);

// ---------- Edit info (rename etc.) ----------

/** Tiles carry only a summary of a title; the editors need the full record (original title, locks, IDs). */
function useFullItem(item: Item): Item | null {
  const api = useApi();
  const [full, setFull] = useState<Item | null>(null);
  useEffect(() => {
    let live = true;
    api.item(item.Id).then((x) => live && setFull(x)).catch(() => live && setFull(item));
    return () => {
      live = false;
    };
  }, [api, item]);
  return full;
}

export function EditInfoDialog({ item: summary, onClose }: { item: Item; onClose: () => void }) {
  const item = useFullItem(summary);
  if (!item) return <Modal title="Edit info" sub={label(summary)} onClose={onClose} busy={false}><p className="muted meta-loading">Loading…</p></Modal>;
  return <EditInfoForm item={item} onClose={onClose} />;
}

function EditInfoForm({ item, onClose }: { item: Item; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [name, setName] = useState(item.Name);
  const [sortName, setSortName] = useState(item.ForcedSortName ?? '');
  const [original, setOriginal] = useState(item.OriginalTitle ?? '');
  const [year, setYear] = useState(item.ProductionYear ? String(item.ProductionYear) : '');
  const [overview, setOverview] = useState(item.Overview ?? '');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.select();
  }, []);
  const locked = item.LockedFields ?? [];

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {
        Name: name.trim(),
        ForcedSortName: sortName.trim() || null,
        OriginalTitle: original.trim() || null,
        ProductionYear: year ? Number(year) : null,
        Overview: overview,
      };
      // Lock what was changed so "Refresh info" doesn't put the old values back.
      const lock = [...(name.trim() !== item.Name ? ['Name'] : []), ...(overview !== (item.Overview ?? '') ? ['Overview'] : [])];
      await api.meta.update(item.Id, patch, lock);
      forgetTitleIndex();
      publishItem(await api.item(item.Id));
      toast('Info saved');
      onClose();
    } catch (x) {
      toast(`Couldn’t save: ${(x as Error).message}`);
      setBusy(false);
    }
  }

  const unlock = async () => {
    setBusy(true);
    try {
      await api.meta.unlock(item.Id, ['Name', 'Overview']);
      await api.art.refresh(item.Id, false);
      toast('Unlocked. Getting the official title and summary again…');
      onClose();
      setTimeout(async () => publishItem(await api.item(item.Id)), 4000);
    } catch (x) {
      toast((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit info" sub={label(item)} onClose={onClose} busy={busy}>
      <form className="meta-form" onSubmit={save}>
        <div className="field">
          <label htmlFor="mi-name">Title</label>
          <input ref={first} id="mi-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="mi-sort">Sort as</label>
            <input id="mi-sort" className="input" value={sortName} placeholder={item.SortName ?? 'Same as title'} onChange={(e) => setSortName(e.target.value)} />
            <span className="hint">E.g. “Lord of the Rings 1” to keep a series in order.</span>
          </div>
          {item.Type !== 'Episode' && (
            <div className="field">
              <label htmlFor="mi-year">Year</label>
              <input id="mi-year" className="input" inputMode="numeric" pattern="[0-9]{4}" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
          )}
        </div>
        {item.Type !== 'Episode' && (
          <div className="field">
            <label htmlFor="mi-orig">Original title</label>
            <input id="mi-orig" className="input" value={original} placeholder="For foreign-language titles" onChange={(e) => setOriginal(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="mi-ov">Summary</label>
          <textarea id="mi-ov" className="input area plain" rows={5} value={overview} onChange={(e) => setOverview(e.target.value)} />
        </div>
        <p className="hint">Changes you make here are kept when info is refreshed from the internet.</p>
        <div className="meta-actions">
          {locked.some((f) => f === 'Name' || f === 'Overview') ? (
            <button type="button" className="btn ghost sm" onClick={unlock} disabled={busy}>Undo my edits and use the official info</button>
          ) : (
            <span />
          )}
          <div className="row-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Fix match ----------

const PROVIDERS: Record<string, { name: string; url?: (id: string, t: string) => string }> = {
  Tmdb: { name: 'TMDB', url: (id, t) => `https://www.themoviedb.org/${t === 'Series' ? 'tv' : 'movie'}/${id}` },
  Imdb: { name: 'IMDb', url: (id) => `https://www.imdb.com/title/${id}` },
  Tvdb: { name: 'TVDB' },
  TvMaze: { name: 'TVmaze' },
};

/** "tt0133093" → IMDb, "tmdb:603" or "603" → TMDB, "tvdb:81189" → TVDB. */
function parseId(raw: string): Record<string, string> | null {
  const v = raw.trim();
  if (!v) return null;
  const imdb = v.match(/tt\d{5,}/i);
  if (imdb) return { Imdb: imdb[0].toLowerCase() };
  const tagged = v.match(/^(tmdb|tvdb|imdb)\s*[:#]?\s*(\S+)$/i);
  if (tagged) return { [tagged[1][0].toUpperCase() + tagged[1].slice(1).toLowerCase()]: tagged[2] };
  const url = v.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/i);
  if (url) return { Tmdb: url[1] };
  if (/^\d+$/.test(v)) return { Tmdb: v };
  return null;
}

export function FixMatchDialog({ item: summary, onClose }: { item: Item; onClose: () => void }) {
  const item = useFullItem(summary);
  if (!item) return <Modal title="Fix match" sub={label(summary)} onClose={onClose} busy={false} wide><p className="muted meta-loading">Loading…</p></Modal>;
  return <FixMatchForm item={item} onClose={onClose} />;
}

function FixMatchForm({ item, onClose }: { item: Item; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const type = item.Type === 'Series' ? 'Series' : 'Movie';
  const [name, setName] = useState(item.Name);
  const [year, setYear] = useState(item.ProductionYear ? String(item.ProductionYear) : '');
  const [idText, setIdText] = useState('');
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState<number | null>(null);
  const [newArt, setNewArt] = useState(true);
  const ids = item.ProviderIds ?? {};
  const current = Object.entries(ids).filter(([k, v]) => v && PROVIDERS[k]);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    setSearching(true);
    setErr(null);
    try {
      const providerIds = parseId(idText) ?? undefined;
      if (idText.trim() && !providerIds) throw new Error('That ID wasn’t recognised. Use an IMDb ID (tt0133093) or a TMDB number or link.');
      setResults(await api.meta.search(type, item.Id, { name: name.trim(), year: year ? Number(year) : undefined, providerIds }));
    } catch (x) {
      setErr((x as Error).message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };
  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (r: MatchResult, i: number) => {
    setApplying(i);
    try {
      await api.meta.apply(item.Id, r, newArt);
      forgetTitleIndex();
      toast(`Matched to ${r.Name}${r.ProductionYear ? ` (${r.ProductionYear})` : ''}. Updating info and artwork…`);
      onClose();
      // The server downloads the new info in the background; refresh the tiles as it lands.
      for (const wait of [2500, 6000, 12000]) setTimeout(async () => publishItem(await api.item(item.Id)), wait);
    } catch (x) {
      toast(`Couldn’t rematch: ${(x as Error).message}`);
      setApplying(null);
    }
  };

  const isCurrent = (r: MatchResult) => Object.entries(r.ProviderIds ?? {}).some(([k, v]) => v && ids[k] === v);

  return (
    <Modal title="Fix match" sub={label(item)} onClose={onClose} busy={applying !== null} wide>
      <div className="match-body">
        <p className="muted small">
          {current.length ? (
            <>
              Currently matched to{' '}
              {current.map(([k, v], n) => {
                const p = PROVIDERS[k];
                const href = p.url?.(v, type);
                return (
                  <span key={k}>
                    {n > 0 && ', '}
                    {href ? <a href={href} target="_blank" rel="noreferrer">{p.name} {v}</a> : `${p.name} ${v}`}
                  </span>
                );
              })}
              . Pick the right title below; its info and artwork replace the current ones.
            </>
          ) : (
            'This title isn’t matched to anything online yet. Search for it and pick the right one.'
          )}
        </p>

        <form className="match-search" onSubmit={search}>
          <div className="field">
            <label htmlFor="fm-name">Title</label>
            <input id="fm-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fm-year">Year</label>
            <input id="fm-year" className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
          <div className="field">
            <label htmlFor="fm-id">or an ID</label>
            <input id="fm-id" className="input" placeholder="tt0133093 or TMDB 603" value={idText} onChange={(e) => setIdText(e.target.value)} />
          </div>
          <button className="btn primary" disabled={searching || (!name.trim() && !idText.trim())}>{searching ? 'Searching…' : 'Search'}</button>
        </form>
        <label className="check-row small">
          <input type="checkbox" className="check" checked={newArt} onChange={(e) => setNewArt(e.target.checked)} />
          Replace artwork with the new match’s (artwork you uploaded is replaced too)
        </label>

        {err && <p className="error small">{err}</p>}
        {results && results.length === 0 && !err && <p className="muted">No matches. Try a shorter title, drop the year, or paste the IMDb or TMDB ID.</p>}
        <ul className="match-list">
          {results?.map((r, i) => (
            <li key={`${r.SearchProviderName}-${Object.values(r.ProviderIds ?? {}).join('-')}-${i}`}>
              <div className="match-poster">{r.ImageUrl ? <img src={r.ImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon.film />}</div>
              <div className="match-text">
                <strong>
                  {r.Name}
                  {r.ProductionYear ? <span className="muted"> ({r.ProductionYear})</span> : null}
                  {isCurrent(r) && <span className="chip-tag ember">Current</span>}
                </strong>
                <span className="hint">
                  {[r.SearchProviderName, ...Object.entries(r.ProviderIds ?? {}).filter(([k, v]) => v && PROVIDERS[k]).map(([k, v]) => `${PROVIDERS[k].name} ${v}`)].filter(Boolean).join(' · ')}
                </span>
                {r.Overview && <span className="match-overview">{r.Overview}</span>}
              </div>
              <button className="btn sm" onClick={() => apply(r, i)} disabled={applying !== null}>
                {applying === i ? 'Matching…' : 'Use this'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
