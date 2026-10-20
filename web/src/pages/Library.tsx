import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Item } from '../lib/types';
import { Tile, useApi, useAsync } from '../lib/ui';

const SORTS = [
  { id: 'DateCreated,SortName', label: 'Recently added', order: 'Descending' },
  { id: 'SortName', label: 'A–Z', order: 'Ascending' },
  { id: 'ProductionYear,SortName', label: 'Newest', order: 'Descending' },
  { id: 'CommunityRating,SortName', label: 'Top rated', order: 'Descending' },
  { id: 'Random', label: 'Surprise me', order: 'Ascending' },
];
const PAGE = 60;

/** Figma: Browse Page (148:8104): title with filter dropdowns, then a grid of 16:9 tiles. */
export default function Library() {
  const { id = '' } = useParams();
  const api = useApi();
  const [sort, setSort] = useState(SORTS[0].id);
  const [genre, setGenre] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  const view = useAsync(() => api.views().then((v) => v.find((x) => x.Id === id)), [id]);
  const genres = useAsync(() => api.genres(id).catch(() => []), [id]);
  const types = view.data?.CollectionType === 'tvshows' ? 'Series' : view.data?.CollectionType === 'movies' ? 'Movie' : 'Movie,Series,Video';
  const s = SORTS.find((x) => x.id === sort)!;

  useEffect(() => {
    if (!view.data) return;
    let live = true;
    setBusy(true);
    api.items({ parentId: id, types, sortBy: s.id, sortOrder: s.order, genre: genre || undefined, start: 0, limit: PAGE }).then((r) => {
      if (!live) return;
      setItems(r.Items);
      setTotal(r.TotalRecordCount);
      setBusy(false);
    });
    return () => {
      live = false;
    };
  }, [api, id, s, types, genre, view.data]);

  const more = async () => {
    setBusy(true);
    const r = await api.items({ parentId: id, types, sortBy: s.id, sortOrder: s.order, genre: genre || undefined, start: items.length, limit: PAGE });
    setItems((x) => x.concat(r.Items));
    setBusy(false);
  };

  return (
    <div className="browse">
      <div className="browse-head">
        <h1>{view.data?.Name ?? ' '}</h1>
        <div className="browse-filters">
          <label className="filter">
            <span>Genre</span>
            <select className="select" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">All genres</option>
              {genres.data?.map((g) => <option key={g.Id} value={g.Name}>{g.Name}</option>)}
            </select>
          </label>
          <label className="filter">
            <span>Sort by</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {total > 0 && <p className="browse-count">{total.toLocaleString()} {types === 'Series' ? 'shows' : 'titles'}{genre ? ` in ${genre}` : ''}</p>}

      <div className="tile-grid">{items.map((i) => <Tile key={i.Id} item={i} />)}</div>

      {busy && items.length === 0 && <p className="muted">Loading…</p>}
      {!busy && view.data && items.length === 0 && <p className="muted">Nothing here{genre ? ` in ${genre}` : ''} yet.</p>}
      {items.length < total && (
        <div className="browse-more">
          <button className="btn" disabled={busy} onClick={more}>
            {busy ? 'Loading…' : `Show more (${(total - items.length).toLocaleString()} left)`}
          </button>
        </div>
      )}
    </div>
  );
}
