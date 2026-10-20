import type { ActiveSession, ScheduledTask } from '../lib/types';
import { Art, epCode, useApi, useAsync, usePoll, useToast } from '../lib/ui';
import { Section, timeAgo } from './common';

const TICKS = 10_000_000;
const TASK_NAMES: Record<string, string> = {
  PluginUpdates: 'Check for ReelForge updates',
  RefreshLibrary: 'Scan all libraries',
  DeleteTranscodeFiles: 'Clean up streaming leftovers',
  RefreshTrickplayImages: 'Make seek-bar preview pictures',
  RefreshChapterImages: 'Make chapter pictures',
  KeyframeExtraction: 'Index keyframes for faster seeking',
};

export default function Activity() {
  const api = useApi();
  const toast = useToast();
  const sessions = useAsync(() => api.admin.sessions(), []);
  const tasks = useAsync(() => api.admin.tasks(), []);
  const log = useAsync(() => api.admin.activity(25), []);
  usePoll(() => {
    api.admin.sessions().then(sessions.setData).catch(() => undefined);
    api.admin.tasks().then(tasks.setData).catch(() => undefined);
  }, 4000);
  usePoll(() => api.admin.activity(25).then(log.setData).catch(() => undefined), 15000);

  const playing = (sessions.data ?? []).filter((s) => s.NowPlayingItem);
  const idle = (sessions.data ?? []).filter((s) => !s.NowPlayingItem && s.UserName);
  const groups = new Map<string, ScheduledTask[]>();
  for (const t of tasks.data ?? []) groups.set(t.Category, [...(groups.get(t.Category) ?? []), t]);

  const runTask = async (t: ScheduledTask) => {
    try {
      if (t.State === 'Running') await api.admin.stopTask(t.Id);
      else await api.admin.runTask(t.Id);
      toast(t.State === 'Running' ? `Stopping ${t.Name}` : `Started ${t.Name}`);
      setTimeout(tasks.reload, 600);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="set-stack">
      <Section title="Watching now" desc={playing.length ? undefined : 'Nobody is watching right now.'}>
        <div className="now-list">
          {playing.map((s) => <NowPlaying key={s.Id} s={s} onStop={async () => { await api.admin.stopSession(s.Id).catch(() => undefined); toast('Playback stopped'); sessions.reload(); }} />)}
        </div>
        {idle.length > 0 && (
          <p className="hint">Also connected: {[...new Set(idle.map((s) => `${s.UserName} on ${s.DeviceName}`))].join(' · ')}</p>
        )}
      </Section>

      <Section title="Background tasks" desc="ReelForge runs these on a schedule. Run one now if you don’t want to wait.">
        {[...groups.entries()].map(([cat, ts]) => (
          <div key={cat} className="task-group">
            <h3>{cat === 'Application' ? 'Updates' : cat}</h3>
            {ts.map((t) => (
              <div key={t.Id} className="task-row">
                <div>
                  <div>{TASK_NAMES[t.Key] ?? t.Name}</div>
                  <div className="hint">
                    {t.State === 'Running'
                      ? `Running${t.CurrentProgressPercentage ? ` · ${Math.round(t.CurrentProgressPercentage)}%` : ''}`
                      : t.LastExecutionResult
                        ? `Last ran ${timeAgo(t.LastExecutionResult.EndTimeUtc)}${t.LastExecutionResult.Status !== 'Completed' ? ` · ${t.LastExecutionResult.Status.toLowerCase()}` : ''}`
                        : 'Hasn’t run yet'}
                  </div>
                  {t.State === 'Running' && <div className="bar"><span style={{ width: `${t.CurrentProgressPercentage ?? 2}%` }} /></div>}
                </div>
                <button className="btn sm" onClick={() => runTask(t)}>{t.State === 'Running' ? 'Stop' : 'Run now'}</button>
              </div>
            ))}
          </div>
        ))}
      </Section>

      <Section title="Recent activity">
        <ul className="log-list">
          {log.data?.map((e) => (
            <li key={e.Id} className={e.Severity === 'Error' || e.Severity === 'Warning' ? 'warn' : ''}>
              <span>{e.Name}</span>
              {e.ShortOverview && <span className="hint">{e.ShortOverview}</span>}
              <time className="hint" dateTime={e.Date}>{timeAgo(e.Date)}</time>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function NowPlaying({ s, onStop }: { s: ActiveSession; onStop: () => void }) {
  const it = s.NowPlayingItem!;
  const tx = s.TranscodingInfo;
  const pos = s.PlayState?.PositionTicks ?? 0;
  const pct = it.RunTimeTicks ? (pos / it.RunTimeTicks) * 100 : 0;
  const method = s.PlayState?.PlayMethod;
  const how =
    method === 'Transcode'
      ? `Converting${tx?.HardwareAccelerationType && tx.HardwareAccelerationType !== 'none' ? ` on the graphics card (${tx.HardwareAccelerationType.toUpperCase()})` : ' on the processor'}${tx?.Height ? ` to ${tx.Height}p` : ''}${tx?.VideoCodec ? ` ${tx.VideoCodec.toUpperCase()}` : ''}${tx?.Bitrate ? ` · ${(tx.Bitrate / 1e6).toFixed(1)} Mbps` : ''}`
      : method === 'DirectStream'
        ? 'Direct stream (repackaged, not re-encoded)'
        : 'Direct play (original file)';
  return (
    <article className="now-card">
      <div className="now-art"><Art item={it} kind="Thumb" width={320} /></div>
      <div className="now-text">
        <strong>{it.Type === 'Episode' ? `${it.SeriesName} · ${epCode(it)} ${it.Name}` : it.Name}</strong>
        <span className="hint">{s.UserName} · {s.DeviceName} ({s.Client}){s.RemoteEndPoint ? ` · ${s.RemoteEndPoint}` : ''}</span>
        <span className="hint">{s.PlayState?.IsPaused ? 'Paused · ' : ''}{how}</span>
        <div className="bar"><span style={{ width: `${pct}%` }} /></div>
        <span className="hint">{clock(pos / TICKS)} of {clock((it.RunTimeTicks ?? 0) / TICKS)}</span>
      </div>
      <button className="btn ghost sm" onClick={onStop}>Stop</button>
    </article>
  );
}

function clock(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
