import { useEffect, useRef, useState } from 'react';
import type { ScanStatus } from '../lib/api';

/**
 * Progress for a library scan: which step it's on, a bar, "1,240 of 3,512 files" and a time
 * estimate once there's enough to go on. Steps without a known size show a moving bar.
 */
export function ScanProgress({ title, steps, status, onCancel, compact }: { title: string; steps: string[]; status: ScanStatus<unknown> | null; onCancel?: () => void; compact?: boolean }) {
  const phase = status?.Phase ?? 'Starting';
  const done = status?.Done ?? 0;
  const total = status?.Total ?? 0;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : null;
  const stepIndex = Math.max(0, steps.indexOf(phase));
  const eta = useEta(phase, done, total);

  return (
    <div className={`scan-card${compact ? ' compact' : ''}`} role="status" aria-live="polite">
      <div className="scan-top">
        <span className="spinner" aria-hidden="true" />
        <div className="scan-titles">
          <strong>{title}</strong>
          <span className="muted small">
            Step {stepIndex + 1} of {steps.length}: {phase}
          </span>
        </div>
        {onCancel && status?.State === 'Running' && (
          <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
        )}
      </div>
      <div
        className={`scan-bar${pct == null ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct == null ? undefined : Math.round(pct)}
        aria-label={phase}
      >
        <span style={pct == null ? undefined : { width: `${pct}%` }} />
      </div>
      <div className="scan-meta">
        <span>{total > 0 ? `${done.toLocaleString()} of ${total.toLocaleString()} ${phase.startsWith('Estimating') ? 'files estimated' : 'files'}` : phase.startsWith('Listing') ? 'Asking the library what’s there…' : 'Almost there…'}</span>
        <span>{pct != null ? `${Math.round(pct)}%${eta ? ` · ${eta}` : ''}` : ''}</span>
      </div>
      <ol className="scan-steps" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}>
            {s}
          </li>
        ))}
      </ol>
      {!compact && phase === 'Reading files' && total > 300 && (
        <p className="hint">Files on your NAS are checked one by one, so big libraries take a minute the first time. You can leave this page; the scan keeps going.</p>
      )}
    </div>
  );
}

/** Time left, from the recent pace (smoothed, and only once the pace is steady). */
function useEta(phase: string, done: number, total: number): string | null {
  const samples = useRef<{ t: number; d: number }[]>([]);
  const last = useRef(phase);
  const [eta, setEta] = useState<string | null>(null);
  useEffect(() => {
    if (last.current !== phase) {
      last.current = phase;
      samples.current = [];
      setEta(null);
    }
    const now = Date.now();
    samples.current.push({ t: now, d: done });
    samples.current = samples.current.filter((x) => now - x.t < 15000);
    const first = samples.current[0];
    if (!total || done >= total || !first || now - first.t < 2500 || done === first.d) return setEta(null);
    const rate = (done - first.d) / ((now - first.t) / 1000);
    const secs = (total - done) / rate;
    setEta(secs < 10 ? 'a few seconds left' : secs < 90 ? `about ${Math.round(secs / 5) * 5} s left` : `about ${Math.round(secs / 60)} min left`);
  }, [phase, done, total]);
  return eta;
}
