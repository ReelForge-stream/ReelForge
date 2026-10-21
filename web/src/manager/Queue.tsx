import { Link } from 'react-router-dom';
import { bytes, duration } from '../lib/api';
import type { Job } from '../lib/types';
import { useApi, useAsync, usePoll, useToast } from '../lib/ui';

export default function Queue() {
  const api = useApi();
  const toast = useToast();
  const q = useAsync(() => api.mm.jobs(), []);
  const active = !!q.data?.Jobs.some((j) => ['Running', 'Verifying', 'Queued'].includes(j.Status));
  usePoll(() => api.mm.jobs().then(q.setData).catch(() => undefined), 2000, active);

  if (q.error) return <div className="err-box">Couldn’t load conversions: {q.error}</div>;
  if (!q.data) return <p className="muted">Loading…</p>;
  const { Jobs: jobs, Paused: paused, Waiting: waiting } = q.data;

  if (jobs.length === 0)
    return (
      <div className="empty">
        <h2>No conversions</h2>
        <p className="muted">
          Pick files in <Link to="/manager/space" style={{ color: 'var(--ember)' }}>Space Saver</Link> and they’ll show up here while they convert.
        </p>
      </div>
    );

  const finished = jobs.filter((j) => ['Done', 'Failed', 'Cancelled'].includes(j.Status));
  const pending = jobs.filter((j) => !finished.includes(j));

  const togglePause = async () => {
    await api.mm.pause(!paused);
    toast(paused ? 'Conversions resumed' : 'Conversions paused');
    q.reload();
  };

  return (
    <>
      <div className="toolbar">
        <span className="muted">{waiting ?? (pending.length ? `${pending.length} to go` : 'All done')}</span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {pending.length > 0 && (
            <button className="btn sm" onClick={togglePause}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
          {finished.length > 0 && (
            <button className="btn sm ghost" onClick={() => api.mm.clearFinished().then(q.reload)}>
              Clear finished
            </button>
          )}
        </div>
      </div>
      {jobs.map((j) => <JobRow key={j.Id} job={j} onCancel={() => api.mm.cancelJob(j.Id).then(q.reload)} />)}
      {finished.length > 0 && <p className="hint">Finished, failed and cancelled conversions leave this list 45 minutes after they end.</p>}
    </>
  );
}

function JobRow({ job: j, onCancel }: { job: Job; onCancel: () => void }) {
  const running = j.Status === 'Running' || j.Status === 'Verifying';
  let meta: string;
  switch (j.Status) {
    case 'Running':
      meta = `${Math.round(j.Progress * 100)}%${j.Speed ? ` · ${j.Speed.toFixed(1)}× real time` : ''}${j.EtaSeconds ? ` · about ${duration(j.EtaSeconds)} left` : ''}${j.Encoder ? ` · ${j.Encoder.includes('nvenc') ? 'GPU' : 'CPU'}` : ''}`;
      break;
    case 'Verifying':
      meta = 'Checking the new file matches the original…';
      break;
    case 'Queued':
      meta = `Waiting · ${bytes(j.OriginalBytes)} now, about ${bytes(j.EstimatedBytes)} after`;
      break;
    case 'Done':
      meta = `${bytes(j.OriginalBytes)} → ${bytes(j.ResultBytes ?? 0)} · ${j.Message ?? ''}`;
      break;
    default:
      meta = j.Message ?? j.Status;
  }

  return (
    <div className={`job${j.Status === 'Failed' ? ' failed' : ''}`}>
      <div>
        <div style={{ fontWeight: 600 }}>{j.Title}</div>
        <div className="meta">{j.Status === 'Done' ? <span className="saving">{meta}</span> : meta}</div>
      </div>
      {(running || j.Status === 'Queued') && (
        <button className="btn sm ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
      {(running || j.Status === 'Done') && (
        <div className={`bar${j.Status === 'Done' ? ' done' : ''}`} role="progressbar" aria-valuenow={Math.round(j.Progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${j.Title} progress`}>
          <span style={{ width: `${j.Progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}
