import { useState } from 'react';
import { bytes } from '../lib/api';
import type { HeldFile } from '../lib/types';
import { Confirm, useApi, useAsync, useToast } from '../lib/ui';

export default function Holding() {
  const api = useApi();
  const toast = useToast();
  const list = useAsync(() => api.mm.holding(), []);
  const settings = useAsync(() => api.mm.settings(), []);
  const [emptying, setEmptying] = useState(false);
  const [purging, setPurging] = useState<HeldFile | null>(null);
  const [busy, setBusy] = useState(false);
  const days = settings.data?.HoldingDays ?? 14;

  if (list.error) return <div className="err-box">Couldn’t load removed files: {list.error}</div>;
  if (!list.data) return <p className="muted">Loading…</p>;
  const files = list.data;
  const total = files.reduce((a, f) => a + f.SizeBytes, 0);

  if (files.length === 0)
    return (
      <div className="empty">
        <h2>No removed files</h2>
        <p className="muted">Duplicates you remove and originals replaced by conversions wait here for {days} days before they’re deleted for good.</p>
      </div>
    );

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      list.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      setEmptying(false);
      setPurging(null);
    }
  };

  const left = (f: HeldFile) => {
    const ms = new Date(f.HeldAtUtc).getTime() + days * 864e5 - Date.now();
    const d = Math.max(0, Math.ceil(ms / 864e5));
    return d <= 1 ? 'deleted within a day' : `deleted in ${d} days`;
  };

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <div className="figure neutral">{bytes(total)}</div>
        <p className="figure-label measure">
          in {files.length} removed {files.length === 1 ? 'file' : 'files'}. They’re out of your library but still on disk until they’re deleted for good. Put any of them back if you change your mind.
        </p>
      </div>
      <div className="toolbar">
        <span className="muted">Kept for {days} days</span>
        <button className="btn danger sm" onClick={() => setEmptying(true)}>
          Delete all now
        </button>
      </div>

      {files.map((f) => (
        <div key={f.Id} className="file-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
          <div style={{ minWidth: 0 }}>
            <div className="name">{f.Title}</div>
            <div className="path">
              {f.Reason} · {bytes(f.SizeBytes)} · {left(f)}
            </div>
            <div className="path">{f.OriginalPath}</div>
          </div>
          <button className="btn sm" disabled={busy} onClick={() => run(() => api.mm.restore(f.Id), `Put back ${f.Title}`)}>
            Put back
          </button>
          <button className="btn sm ghost" disabled={busy} onClick={() => setPurging(f)}>
            Delete now
          </button>
        </div>
      ))}

      {emptying && (
        <Confirm title="Delete all removed files?" confirm={`Delete ${bytes(total)} for good`} danger busy={busy} onCancel={() => setEmptying(false)} onConfirm={() => run(() => api.mm.emptyHolding(), `Deleted ${files.length} files`)}>
          <p>This permanently deletes {files.length} files and frees {bytes(total)}. They can’t be put back afterwards.</p>
        </Confirm>
      )}
      {purging && (
        <Confirm title={`Delete ${purging.Title}?`} confirm="Delete for good" danger busy={busy} onCancel={() => setPurging(null)} onConfirm={() => run(() => api.mm.purge(purging.Id), 'Deleted')}>
          <p>This permanently deletes {bytes(purging.SizeBytes)}. It can’t be put back afterwards.</p>
        </Confirm>
      )}
    </>
  );
}
