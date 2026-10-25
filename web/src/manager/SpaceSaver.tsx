import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bytes } from '../lib/api';
import { Confirm, useApi, useAsync, useToast } from '../lib/ui';
import { ScanProgress } from './ScanProgress';
import { ScanFreshness, useScan } from './useScan';
import { groupBySeason, seasonLabel, type ShowGroup } from '../lib/seasons';
import type { Estimate, SpaceSaverResult } from '../lib/types';

const SAVER_STEPS = ['Listing your library', 'Reading files', 'Estimating savings', 'Checking the graphics card'];

type Kind = '' | 'Movie' | 'Episode';
const PRESET_NAME = { MaxSavings: 'Smallest files', Balanced: 'Balanced', HighQuality: 'Highest quality' } as const;

export default function SpaceSaver() {
  const api = useApi();
  const nav = useNavigate();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('');
  const scan = useScan<SpaceSaverResult>('spacesaver', kind || undefined);
  const settings = useAsync(() => api.mm.settings(), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // What the confirm dialog is about to convert: the selection, or one season/show picked with its own button.
  const [confirming, setConfirming] = useState<{ files: Estimate[]; what?: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(new Set());
  }, [scan.data]);

  const r = scan.data;
  const cands = useMemo(() => r?.Candidates ?? [], [r]);
  const groups = useMemo(() => groupBySeason(cands), [cands]);
  if (scan.error) return <div className="err-box">Couldn’t scan the library: {scan.error} <button className="link-btn" onClick={scan.rescan}>Try again</button></div>;
  const chosen = cands.filter((c) => selected.has(c.MediaSourceId));
  const chosenSave = chosen.reduce((a, c) => a + c.SavingsBytes, 0);
  const gpu = r?.Encoder.Working.includes(settings.data?.TargetCodec === 'Av1' ? 'av1_nvenc' : 'hevc_nvenc');
  const days = settings.data?.HoldingDays ?? 14;

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };
  /** Tick or untick a whole season or show at once. */
  const toggleMany = (list: Estimate[]) => {
    const n = new Set(selected);
    const allIn = list.every((c) => n.has(c.MediaSourceId));
    for (const c of list) {
      if (allIn) n.delete(c.MediaSourceId);
      else n.add(c.MediaSourceId);
    }
    setSelected(n);
  };
  const flip = (key: string) => {
    const n = new Set(open);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    setOpen(n);
  };

  const queue = async () => {
    if (!confirming) return;
    setBusy(true);
    try {
      const jobs = await api.mm.queue(confirming.files.map((c) => ({ ItemId: c.ItemId, MediaSourceId: c.MediaSourceId })));
      toast(`Queued ${jobs.length} ${jobs.length === 1 ? 'conversion' : 'conversions'}`);
      nav('/manager/queue');
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <div className="figure">{r ? bytes(r.TotalSavingsBytes) : '…'}</div>
        <p className="figure-label measure">
          {r
            ? `could be freed by re-encoding ${cands.length} of ${r.FilesScanned.toLocaleString()} files (${bytes(r.TotalCandidateBytes)} today) to ${settings.data?.TargetCodec === 'Av1' ? 'AV1' : 'HEVC'} at “${PRESET_NAME[settings.data?.Preset ?? 'Balanced']}” quality. Estimates are approximate; grainy or busy footage ends up larger.`
            : 'Measuring every file against what it would take up re-encoded…'}
        </p>
        {r && (
          <p className="small" style={{ marginTop: 10, color: gpu ? 'var(--coolant)' : 'var(--ember)' }}>
            {r.Encoder.Summary}
          </p>
        )}
      </div>

      <div className="toolbar">
        <div className="chips" role="group" aria-label="Show">
          {([['', 'Everything'], ['Movie', 'Movies'], ['Episode', 'Episodes']] as [Kind, string][]).map(([k, label]) => (
            <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">
            {chosen.length} selected{chosen.length ? ` · saves about ${bytes(chosenSave)}` : ''}
          </span>
          <button className="btn primary" disabled={!chosen.length} onClick={() => setConfirming({ files: chosen })}>
            Convert selected
          </button>
        </div>
      </div>

      {scan.running && <ScanProgress title={r ? 'Checking again' : 'Finding files that can shrink'} steps={SAVER_STEPS} status={scan.status} onCancel={scan.cancel} compact={!!r} />}
      {!scan.running && scan.status?.State === 'Cancelled' && !r && (
        <div className="empty">
          <h2>Scan stopped</h2>
          <button className="btn" onClick={scan.rescan}>Scan again</button>
        </div>
      )}
      {!scan.running && r && <ScanFreshness status={scan.status} running={scan.running} onRescan={scan.rescan} label="Scanned" />}

      {r && cands.length === 0 && (
        <div className="empty">
          <h2>Nothing worth converting</h2>
          <p className="muted">Every file is already efficiently encoded, or would shrink by less than 15%. Try the “Smallest files” preset in Settings for a deeper pass.</p>
        </div>
      )}

      {groups.movies.length > 0 && (
        <>
          {groups.shows.length > 0 && <h3 className="saver-heading">Movies</h3>}
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <TriCheck label="Select all movies" list={groups.movies} selected={selected} onChange={() => toggleMany(groups.movies)} />
                </th>
                <th>Title</th>
                <th className="hide-sm">Now</th>
                <th className="num hide-sm">Size</th>
                <th className="num">After</th>
                <th className="num">Saves</th>
              </tr>
            </thead>
            <tbody>
              {groups.movies.map((c) => (
                <FileRow key={c.MediaSourceId} c={c} title={c.Title} checked={selected.has(c.MediaSourceId)} onToggle={() => toggle(c.MediaSourceId)} />
              ))}
            </tbody>
          </table>
        </>
      )}

      {groups.shows.length > 0 && (
        <>
          {groups.movies.length > 0 && <h3 className="saver-heading">TV shows</h3>}
          <table className="table saver-shows">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <TriCheck label="Select every episode" list={groups.shows.flatMap((g) => g.episodes)} selected={selected} onChange={() => toggleMany(groups.shows.flatMap((g) => g.episodes))} />
                </th>
                <th>Show</th>
                <th className="num hide-sm">Size</th>
                <th className="num">After</th>
                <th className="num">Saves</th>
                <th className="hide-sm" style={{ width: 1 }} />
              </tr>
            </thead>
            <tbody>
              {groups.shows.map((g) => (
                <ShowRows
                  key={g.key}
                  g={g}
                  open={open}
                  selected={selected}
                  onFlip={flip}
                  onToggle={toggle}
                  onToggleMany={toggleMany}
                  onConvert={(files, what) => setConfirming({ files, what })}
                />
              ))}
            </tbody>
          </table>
        </>
      )}

      {r && Object.keys(r.SkippedByReason).length > 0 && (
        <details style={{ marginTop: 36 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Why {Object.values(r.SkippedByReason).reduce((a, b) => a + b, 0).toLocaleString()} files were left out
          </summary>
          <div className="people" style={{ marginTop: 14, maxWidth: 560 }}>
            {Object.entries(r.SkippedByReason)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, n]) => (
                <div key={reason}>
                  <span>{reason}</span>
                  <span className="muted">{n.toLocaleString()}</span>
                </div>
              ))}
          </div>
        </details>
      )}

      {confirming && (
        <Confirm
          title={confirming.what ? `Convert ${confirming.what}?` : `Convert ${confirming.files.length} ${confirming.files.length === 1 ? 'file' : 'files'}?`}
          confirm="Start converting"
          busy={busy}
          onConfirm={queue}
          onCancel={() => setConfirming(null)}
        >
          {confirming.what && (
            <p style={{ marginBottom: 10 }}>
              {confirming.files.length} {confirming.files.length === 1 ? 'episode' : 'episodes'} · {bytes(confirming.files.reduce((a, c) => a + c.SizeBytes, 0))} now, saves about {bytes(confirming.files.reduce((a, c) => a + c.SavingsBytes, 0))}.
            </p>
          )}
          <p>
            They convert one at a time in the background{gpu ? ' on the graphics card' : ' on the CPU (slow)'}
            {settings.data?.PauseWhileStreaming ? ', and wait whenever someone is watching' : ''}. Every audio track, subtitle and chapter is kept, and each result is checked before it replaces the original.
          </p>
          <p style={{ marginTop: 10 }}>
            {days > 0
              ? `Originals go to Removed files for ${days} days, so space is fully freed after that (or sooner if you empty it).`
              : 'Holding is off, so originals are deleted as soon as each converted copy passes its check.'}
          </p>
        </Confirm>
      )}
    </>
  );
}

/** A checkbox that shows "some" when only part of a season or show is ticked. */
function TriCheck({ list, selected, label, onChange }: { list: Estimate[]; selected: Set<string>; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const n = list.filter((c) => selected.has(c.MediaSourceId)).length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = n > 0 && n < list.length;
  }, [n, list.length]);
  return <input ref={ref} type="checkbox" className="check" aria-label={label} checked={list.length > 0 && n === list.length} onChange={onChange} onClick={(e) => e.stopPropagation()} />;
}

function FileRow({ c, title, checked, onToggle, indent }: { c: Estimate; title: string; checked: boolean; onToggle: () => void; indent?: boolean }) {
  return (
    <tr onClick={onToggle} style={{ cursor: 'pointer' }} className={indent ? 'saver-episode' : undefined}>
      <td>
        <input type="checkbox" className="check" aria-label={`Select ${c.Title}`} checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} />
      </td>
      <td>
        {title}
        {indent && <div className="muted small">{c.Summary}</div>}
      </td>
      {!indent && <td className="muted hide-sm">{c.Summary}</td>}
      <td className="num hide-sm">{bytes(c.SizeBytes)}</td>
      <td className="num">{bytes(c.EstimatedBytes)}</td>
      <td className="num saving">
        {bytes(c.SavingsBytes)} <span className="muted small pct">({Math.round(c.SavingsFraction * 100)}%)</span>
      </td>
      {indent && <td className="hide-sm" />}
    </tr>
  );
}

/** "Severance S01E03 · Who Is Alive?" → "E3 · Who Is Alive?" inside its season. */
function episodeTitle(c: Estimate): string {
  const name = c.Title.replace(/^.*?\bS\d+E\d+(?:-E\d+)?\s*(?:·\s*)?/i, '');
  const num = c.EpisodeNumber != null ? `E${c.EpisodeNumber}` : '';
  return [num, name].filter(Boolean).join(' · ') || c.Title;
}

function ShowRows({ g, open, selected, onFlip, onToggle, onToggleMany, onConvert }: {
  g: ShowGroup;
  open: Set<string>;
  selected: Set<string>;
  onFlip: (key: string) => void;
  onToggle: (id: string) => void;
  onToggleMany: (list: Estimate[]) => void;
  onConvert: (files: Estimate[], what: string) => void;
}) {
  const showOpen = open.has(g.key);
  const seasonsText = g.seasons.length === 1 ? seasonLabel(g.seasons[0].number) : `${g.seasons.length} seasons`;
  return (
    <>
      <tr className="saver-show" onClick={() => onFlip(g.key)} aria-expanded={showOpen}>
        <td>
          <TriCheck list={g.episodes} selected={selected} label={`Select all of ${g.name}`} onChange={() => onToggleMany(g.episodes)} />
        </td>
        <td>
          <button className="saver-expand" aria-expanded={showOpen} aria-label={`${showOpen ? 'Hide' : 'Show'} seasons of ${g.name}`} onClick={(e) => { e.stopPropagation(); onFlip(g.key); }}>
            <span className="chev" aria-hidden="true">›</span>
          </button>
          <strong>{g.name}</strong>
          <span className="muted small"> · {g.episodes.length} {g.episodes.length === 1 ? 'episode' : 'episodes'}, {seasonsText}</span>
        </td>
        <td className="num hide-sm">{bytes(g.size)}</td>
        <td className="num">{bytes(g.after)}</td>
        <td className="num saving">{bytes(g.saves)}</td>
        <td className="hide-sm">
          <button className="btn sm ghost nowrap" onClick={(e) => { e.stopPropagation(); onConvert(g.episodes, `all of ${g.name}`); }}>Convert show</button>
        </td>
      </tr>
      {showOpen &&
        g.seasons.map((s) => {
          const seasonOpen = open.has(s.key);
          const label = seasonLabel(s.number);
          return (
            <Fragment key={s.key}>
              <tr className="saver-season" onClick={() => onFlip(s.key)} aria-expanded={seasonOpen}>
                <td>
                  <TriCheck list={s.episodes} selected={selected} label={`Select ${g.name} ${label}`} onChange={() => onToggleMany(s.episodes)} />
                </td>
                <td>
                  <button className="saver-expand" aria-expanded={seasonOpen} aria-label={`${seasonOpen ? 'Hide' : 'Show'} episodes of ${label}`} onClick={(e) => { e.stopPropagation(); onFlip(s.key); }}>
                    <span className="chev" aria-hidden="true">›</span>
                  </button>
                  {label}
                  <span className="muted small"> · {s.episodes.length} {s.episodes.length === 1 ? 'episode' : 'episodes'}</span>
                  <button className="btn sm ghost show-sm saver-season-btn" onClick={(e) => { e.stopPropagation(); onConvert(s.episodes, `${g.name} ${label}`); }}>Convert season</button>
                </td>
                <td className="num hide-sm">{bytes(s.size)}</td>
                <td className="num">{bytes(s.after)}</td>
                <td className="num saving">{bytes(s.saves)}</td>
                <td className="hide-sm">
                  <button className="btn sm nowrap" onClick={(e) => { e.stopPropagation(); onConvert(s.episodes, `${g.name} ${label}`); }}>Convert season</button>
                </td>
              </tr>
              {seasonOpen && s.episodes.map((c) => <FileRow key={c.MediaSourceId} c={c} title={episodeTitle(c)} checked={selected.has(c.MediaSourceId)} onToggle={() => onToggle(c.MediaSourceId)} indent />)}
            </Fragment>
          );
        })}
    </>
  );
}

