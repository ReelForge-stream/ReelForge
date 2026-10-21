import { formatBytes } from '../lib/device';
import { jobStatus, saveFile, unwatch } from '../lib/download';
import { Icon, useApi, useAsync, usePoll, useToast } from '../lib/ui';

/** Your converted downloads: progress while the server works, then a button to save each one. Kept for a day. */
export default function Downloads() {
  const api = useApi();
  const toast = useToast();
  const jobs = useAsync(() => api.downloads.list(), []);
  const working = (jobs.data ?? []).some((j) => j.State === 'Waiting' || j.State === 'Converting');
  usePoll(() => api.downloads.list().then(jobs.setData).catch(() => undefined), 2000, working);

  const remove = async (id: string, ready: boolean) => {
    unwatch(id);
    await api.downloads.remove(id).catch(() => undefined);
    toast(ready ? 'Removed from the server' : 'Conversion cancelled');
    jobs.reload();
  };

  const until = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="page downloads-page">
      <div className="page-head">
        <h1>Downloads</h1>
        <p className="muted measure">
          Titles converted to play on your phone, tablet or computer. Each one stays on the server for a day so you can save it again. Original files download straight away and don’t appear here.
        </p>
      </div>
      {jobs.data && jobs.data.length === 0 && (
        <p className="muted">Nothing here yet. To download something, right-click (or press and hold) a movie or episode and choose Download.</p>
      )}
      <ul className="dl-list">
        {jobs.data?.map((j) => (
          <li key={j.Id} className="dl-item">
            <div className="dl-item-text">
              <strong>{j.Title}</strong>
              <span className="hint">
                {j.Label} · {j.State === 'Ready' ? formatBytes(j.SizeBytes) : `about ${formatBytes(j.EstimatedBytes)}`}
                {j.State === 'Ready' ? ` · on the server until ${until(j.ExpiresUtc)}` : ''}
              </span>
              {(j.State === 'Waiting' || j.State === 'Converting') && <div className="bar"><span style={{ width: `${Math.max(2, j.Progress * 100)}%` }} /></div>}
              {j.State !== 'Ready' && <span className={j.State === 'Failed' ? 'dl-failed' : 'hint'}>{jobStatus(j)}</span>}
            </div>
            <div className="dl-item-actions">
              {j.State === 'Ready' && (
                <button className="btn primary sm" onClick={() => saveFile(api.downloads.fileUrl(j.Id), j.FileName)}>
                  <Icon.download />
                  Save
                </button>
              )}
              <button className="btn ghost sm" onClick={() => remove(j.Id, j.State === 'Ready' || j.State === 'Failed')}>
                {j.State === 'Ready' || j.State === 'Failed' ? 'Remove' : 'Cancel'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
