import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bytes } from '../lib/api';
import { Confirm, useApi, useAsync, useToast } from '../lib/ui';
import { ScanProgress } from './ScanProgress';
import { ScanFreshness, useScan } from './useScan';
import type { SpaceSaverResult } from '../lib/types';

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
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(new Set());
  }, [scan.data]);

  if (scan.error) return <div className="err-box">Couldn’t scan the library: {scan.error} <button className="link-btn" onClick={scan.rescan}>Try again</button></div>;
  const r = scan.data;
  const cands = r?.Candidates ?? [];
  const chosen = cands.filter((c) => selected.has(c.MediaSourceId));
  const chosenSave = chosen.reduce((a, c) => a + c.SavingsBytes, 0);
  const allOn = cands.length > 0 && chosen.length === cands.length;
  const gpu = r?.Encoder.Working.includes(settings.data?.TargetCodec === 'Av1' ? 'av1_nvenc' : 'hevc_nvenc');
  const days = settings.data?.HoldingDays ?? 14;

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  const queue = async () => {
    setBusy(true);
    try {
      const jobs = await api.mm.queue(chosen.map((c) => ({ ItemId: c.ItemId, MediaSourceId: c.MediaSourceId })));
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
          <button className="btn primary" disabled={!chosen.length} onClick={() => setConfirming(true)}>
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

      {cands.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  className="check"
                  aria-label="Select all"
                  checked={allOn}
                  onChange={() => setSelected(allOn ? new Set() : new Set(cands.map((c) => c.MediaSourceId)))}
                />
              </th>
              <th>Title</th>
              <th className="hide-sm">Now</th>
              <th className="num hide-sm">Size</th>
              <th className="num">After</th>
              <th className="num">Saves</th>
            </tr>
          </thead>
          <tbody>
            {cands.map((c) => (
              <tr key={c.MediaSourceId} onClick={() => toggle(c.MediaSourceId)} style={{ cursor: 'pointer' }}>
                <td>
                  <input type="checkbox" className="check" aria-label={`Select ${c.Title}`} checked={selected.has(c.MediaSourceId)} onChange={() => toggle(c.MediaSourceId)} onClick={(e) => e.stopPropagation()} />
                </td>
                <td>{c.Title}</td>
                <td className="muted hide-sm">{c.Summary}</td>
                <td className="num hide-sm">{bytes(c.SizeBytes)}</td>
                <td className="num">{bytes(c.EstimatedBytes)}</td>
                <td className="num saving">
                  {bytes(c.SavingsBytes)} <span className="muted small">({Math.round(c.SavingsFraction * 100)}%)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          title={`Convert ${chosen.length} ${chosen.length === 1 ? 'file' : 'files'}?`}
          confirm="Start converting"
          busy={busy}
          onConfirm={queue}
          onCancel={() => setConfirming(false)}
        >
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
