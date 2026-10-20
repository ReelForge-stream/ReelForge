import { useEffect, useMemo, useState } from 'react';
import { bytes } from '../lib/api';
import type { DupGroup } from '../lib/types';
import { Confirm, useApi, useAsync, useToast } from '../lib/ui';

type Filter = 'All' | 'Movie' | 'Episode';

export default function Duplicates() {
  const api = useApi();
  const toast = useToast();
  const groups = useAsync(() => api.mm.duplicates(), []);
  const settings = useAsync(() => api.mm.settings(), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('All');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pre-select every copy except the recommended keeper. Different editions are never pre-selected.
  useEffect(() => {
    if (!groups.data) return;
    const pre = new Set<string>();
    for (const g of groups.data) if (!g.LooksLikeEditions) for (const f of g.Files) if (!f.Keep) pre.add(f.MediaSourceId);
    setSelected(pre);
  }, [groups.data]);

  const visible = useMemo(() => (groups.data ?? []).filter((g) => filter === 'All' || g.Kind === filter), [groups.data, filter]);
  const allFiles = (groups.data ?? []).flatMap((g) => g.Files);
  const chosen = allFiles.filter((f) => selected.has(f.MediaSourceId));
  const chosenBytes = chosen.reduce((a, f) => a + f.SizeBytes, 0);
  const days = settings.data?.HoldingDays ?? 14;

  const toggle = (g: DupGroup, id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else {
      // Never let every copy of a title be selected.
      const others = g.Files.filter((f) => f.MediaSourceId !== id);
      if (others.every((f) => next.has(f.MediaSourceId))) {
        toast('Keep at least one copy of every title');
        return;
      }
      next.add(id);
    }
    setSelected(next);
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.mm.removeDuplicates(chosen.map((f) => ({ ItemId: f.ItemId, MediaSourceId: f.MediaSourceId })));
      toast(r.Errors.length ? `Removed ${r.Removed}; ${r.Errors.length} couldn’t be removed` : `Removed ${r.Removed} ${r.Removed === 1 ? 'file' : 'files'}`);
      setConfirming(false);
      groups.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (groups.error) return <div className="err-box">Couldn’t check for duplicates: {groups.error}</div>;
  if (!groups.data) return <p className="muted">Comparing every movie and episode in your libraries…</p>;
  if (groups.data.length === 0)
    return (
      <div className="empty">
        <h2>No duplicates</h2>
        <p className="muted">Every movie and episode has exactly one copy on disk.</p>
      </div>
    );

  const reclaimable = groups.data.reduce((a, g) => a + g.ReclaimableBytes, 0);
  const counts = { All: groups.data.length, Movie: groups.data.filter((g) => g.Kind === 'Movie').length, Episode: groups.data.filter((g) => g.Kind === 'Episode').length };

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <div className="figure">{bytes(reclaimable)}</div>
        <p className="figure-label">
          can be freed from {groups.data.length} titles stored more than once. The best copy of each is kept; you can change any choice below.
        </p>
      </div>

      <div className="toolbar">
        <div className="chips" role="group" aria-label="Show">
          {(['All', 'Movie', 'Episode'] as Filter[]).map((f) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'All' ? 'All' : f === 'Movie' ? 'Movies' : 'Episodes'} ({counts[f]})
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">
            {chosen.length} selected · {bytes(chosenBytes)}
          </span>
          <button className="btn danger" disabled={!chosen.length} onClick={() => setConfirming(true)}>
            Remove selected
          </button>
        </div>
      </div>

      {visible.map((g) => (
        <section key={g.Key} className="group">
          <div className="group-head">
            <h3>{g.Title}</h3>
            {g.LooksLikeEditions ? (
              <span className="note">Different editions — nothing selected</span>
            ) : (
              <span className="muted small">{bytes(g.ReclaimableBytes)} reclaimable</span>
            )}
          </div>
          {g.Files.map((f) => {
            const id = `f-${f.MediaSourceId}`;
            return (
              <div key={f.MediaSourceId} className="file-row">
                <input id={id} type="checkbox" className="check" checked={selected.has(f.MediaSourceId)} onChange={() => toggle(g, f.MediaSourceId)} />
                <label htmlFor={id} style={{ cursor: 'pointer', minWidth: 0 }}>
                  <div className="name">
                    {f.Summary}
                    {f.Keep && !g.LooksLikeEditions && <span className="keep-tag">Best copy</span>}
                    {f.Edition && <span className="edition-tag">{f.Edition}</span>}
                  </div>
                  <div className="path">{f.Path}</div>
                </label>
                <div className="size">{bytes(f.SizeBytes)}</div>
              </div>
            );
          })}
        </section>
      ))}

      {confirming && (
        <Confirm
          title={`Remove ${chosen.length} ${chosen.length === 1 ? 'file' : 'files'}?`}
          confirm={`Remove ${bytes(chosenBytes)}`}
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        >
          {days > 0 ? (
            <p>
              They move to Removed files and stay there for {days} days, so you can put any of them back. Their own subtitle and artwork files go with them. Disk space is freed when they’re deleted for good.
            </p>
          ) : (
            <p>Holding is turned off, so these files will be deleted permanently right away.</p>
          )}
        </Confirm>
      )}
    </>
  );
}
