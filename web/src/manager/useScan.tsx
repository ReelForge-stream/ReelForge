import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanStatus } from '../lib/api';
import { timeAgo } from '../settings/common';
import { useApi } from '../lib/ui';

/**
 * Runs a Media Manager scan on the server in the background and follows its progress.
 * Coming back to a page within a few minutes shows the last result straight away.
 */
export function useScan<T>(kind: 'duplicates' | 'spacesaver', mediaKind?: string) {
  const api = useApi();
  const [status, setStatus] = useState<ScanStatus<T> | null>(null);
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const fresh = useRef(false);

  useEffect(() => {
    let live = true;
    let timer = 0;
    setError(null);
    const follow = async (id: string) => {
      try {
        const s = await api.mm.scan<T>(id);
        if (!live) return;
        setStatus(s);
        if (s.State === 'Running') timer = window.setTimeout(() => follow(id), 600);
        else if (s.State === 'Done') setData(s.Result ?? undefined);
        else if (s.State === 'Failed') setError(s.Error ?? 'The scan failed.');
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    api.mm
      .startScan<T>(kind, { mediaKind, fresh: fresh.current })
      .then((s) => {
        fresh.current = false;
        if (!live) return;
        setStatus(s);
        follow(s.Id);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, kind, mediaKind, runs]);

  /** Scan again from scratch (keeps showing the old result until the new one is ready). */
  const rescan = useCallback(() => {
    fresh.current = true;
    setRuns((n) => n + 1);
  }, []);
  const cancel = useCallback(() => {
    if (status?.State === 'Running') api.mm.cancelScan(status.Id).catch(() => undefined);
  }, [api, status]);

  return { data, error, status, running: status?.State === 'Running', rescan, cancel };
}

/** A "checked 3 min ago · Check again" line for the top of a results page. */
export function ScanFreshness({ status, running, onRescan, label }: { status: ScanStatus<unknown> | null; running: boolean; onRescan: () => void; label: string }) {
  if (!status?.FinishedUtc || running) return null;
  return (
    <p className="scan-fresh">
      {label} {timeAgo(status.FinishedUtc)}
      <button className="link-btn" onClick={onRescan}>Check again</button>
    </p>
  );
}
