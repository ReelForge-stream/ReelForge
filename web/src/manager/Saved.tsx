import { bytes } from '../lib/api';
import type { SavingsResult } from '../lib/types';
import { useApi, useAsync, usePoll } from '../lib/ui';

/** Every Space Saver conversion, newest first, with what it saved and the running total. Kept forever. */
export default function Saved() {
  const api = useApi();
  const s = useAsync(() => api.mm.savings(), []);
  usePoll(() => api.mm.savings().then(s.setData).catch(() => undefined), 20000);
  if (s.error) return <div className="err-box">Couldn’t load the totals: {s.error}</div>;
  if (!s.data) return <p className="muted">Adding it up…</p>;
  const d: SavingsResult = s.data;
  const pct = d.OriginalBytes ? Math.round((d.TotalSavedBytes / d.OriginalBytes) * 100) : 0;
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <>
      <div className="summary-band">
        <div>
          <div className="k" style={{ color: 'var(--coolant)' }}>{bytes(d.TotalSavedBytes)}</div>
          <div className="v">saved in total{d.Since ? ` since ${date(d.Since)}` : ''}</div>
        </div>
        <div>
          <div className="k">{d.Conversions}</div>
          <div className="v">{d.Conversions === 1 ? 'file converted' : 'files converted'}</div>
        </div>
        <div>
          <div className="k">{pct}%</div>
          <div className="v">{d.Conversions ? `smaller on average (${bytes(d.OriginalBytes)} → ${bytes(d.NewBytes)})` : 'smaller on average'}</div>
        </div>
      </div>
      {d.StillHeldBytes > 0 && (
        <p className="hint saved-note">
          {bytes(d.StillHeldBytes)} of this is still on disk: the originals wait in Removed files until their days are up. Delete them there to free the space now.
        </p>
      )}

      {d.Rows.length === 0 ? (
        <p className="muted">Nothing converted yet. Files you shrink with Space Saver are added here as each one finishes, with a running total.</p>
      ) : (
        <div className="saved-table" role="table" aria-label="Space saved by each conversion">
          <div className="saved-row head" role="row">
            <span role="columnheader">Finished</span>
            <span role="columnheader">Title</span>
            <span role="columnheader">Before → after</span>
            <span role="columnheader">Saved</span>
            <span role="columnheader">Running total</span>
          </div>
          {d.Rows.map((r, i) => (
            <div key={`${r.ItemId}-${r.FinishedUtc}-${i}`} className="saved-row" role="row">
              <span role="cell" className="hint">{date(r.FinishedUtc)}</span>
              <span role="cell" className="saved-title" title={r.Path}>{r.Title}</span>
              <span role="cell">{bytes(r.OriginalBytes)} → {bytes(r.NewBytes)}</span>
              <span role="cell" className="saved-amt">
                {bytes(r.SavedBytes)}
                <span className="hint"> ({r.OriginalBytes ? Math.round((r.SavedBytes / r.OriginalBytes) * 100) : 0}%)</span>
              </span>
              <span role="cell" className="saved-run">{bytes(r.RunningTotalBytes)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
