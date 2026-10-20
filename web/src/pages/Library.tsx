import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Item } from '../lib/types';
import { Card, useApi, useAsync } from '../lib/ui';

const SORTS = [
  { id: 'SortName', label: 'A–Z', order: 'Ascending' },
  { id: 'DateCreated,SortName', label: 'Recently added', order: 'Descending' },
  { id: 'ProductionYear,SortName', label: 'Newest', order: 'Descending' },
  { id: 'CommunityRating,SortName', label: 'Top rated', order: 'Descending' },
];
const PAGE = 120;

export default function Library() {
  const { id = '' } = useParams();
  const api = useApi();
  const [sort, setSort] = useState(SORTS[0]);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  const view = useAsync(() => api.views().then((v) => v.find((x) => x.Id === id)), [id]);
  const types = view.data?.CollectionType === 'tvshows' ? 'Series' : view.data?.CollectionType === 'movies' ? 'Movie' : 'Movie,Series,Video';

  useEffect(() => {
    if (!view.data) return;
    let live = true;
    setBusy(true);
    api.items({ parentId: id, types, sortBy: sort.id, sortOrder: sort.order, start: 0, limit: PAGE }).then((r) => {
      if (!live) return;
      setItems(r.Items);
      setTotal(r.TotalRecordCount);
      setBusy(false);
    });
    return () => {
      live = false;
    };
  }, [api, id, sort, types, view.data]);

  const more = async () => {
    setBusy(true);
    const r = await api.items({ parentId: id, types, sortBy: sort.id, sortOrder: sort.order, start: items.length, limit: PAGE });
    setItems((x) => x.concat(r.Items));
    setBusy(false);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{view.data?.Name ?? ' '}</h1>
          {total > 0 && <p className="muted">{total.toLocaleString()} {types === 'Series' ? 'shows' : 'titles'}</p>}
        </div>
        <div className="chips" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <button key={s.id} className="chip" aria-pressed={sort.id === s.id} onClick={() => setSort(s)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid">{items.map((i) => <Card key={i.Id} item={i} />)}</div>

      {busy && items.length === 0 && <p className="muted">Loading…</p>}
      {items.length < total && (
        <div style={{ marginTop: 32 }}>
          <button className="btn" disabled={busy} onClick={more}>
            {busy ? 'Loading…' : `Show more (${(total - items.length).toLocaleString()} left)`}
          </button>
        </div>
      )}
    </div>
  );
}
