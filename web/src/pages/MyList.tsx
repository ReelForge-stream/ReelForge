import type { Item } from '../lib/types';
import { Tile, useApi, useAsync } from '../lib/ui';

/** Your favorites, laid out like the Browse page. Add titles with + in any title's details. */
export default function MyList() {
  const api = useApi();
  const list = useAsync(() => api.items({ types: 'Movie,Series,Episode', favorites: true, sortBy: 'DateCreated,SortName', sortOrder: 'Descending', limit: 300 }).then((r) => r.Items).catch(() => [] as Item[]), []);
  return (
    <div className="browse">
      <div className="browse-head">
        <h1>My List</h1>
      </div>
      {list.data && list.data.length === 0 && (
        <div className="empty">
          <h2>Your list is empty</h2>
          <p className="muted">Open any movie or show and press + to keep it here for later.</p>
        </div>
      )}
      <div className="tile-grid">{list.data?.map((i) => <Tile key={i.Id} item={i} />)}</div>
    </div>
  );
}
