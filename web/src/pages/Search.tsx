import { useEffect, useState } from 'react';
import type { Item } from '../lib/types';
import { Card, useApi } from '../lib/ui';

export default function Search() {
  const api = useApi();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Item[] | null>(null);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.items({ search: term.trim(), types: 'Movie,Series,Episode', limit: 60, sortBy: 'SortName' }).then((r) => live && setResults(r.Items));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, term]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Search</h1>
      </div>
      <input
        className="input"
        style={{ width: 'min(560px, 100%)', height: 52, fontSize: '1.1rem' }}
        placeholder="Movies, shows or episodes"
        aria-label="Search"
        autoFocus
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <div style={{ marginTop: 32 }}>
        {results && results.length === 0 && <p className="muted">Nothing matches “{term}”.</p>}
        {results && results.length > 0 && <div className="grid">{results.map((i) => <Card key={i.Id} item={i} shape={i.Type === 'Episode' ? 'thumb' : 'poster'} />)}</div>}
      </div>
    </div>
  );
}
