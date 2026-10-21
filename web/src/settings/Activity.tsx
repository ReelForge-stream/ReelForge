import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActiveSession, ScheduledTask, WatchRecord } from '../lib/types';
import { Art, epCode, Icon, useApi, useAsync, usePoll, useToast } from '../lib/ui';
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

      <WatchHistory />

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
        <span className="now-who">
          <strong>{s.UserName}</strong>
          <span className="now-dev"><DeviceIcon device={s.DeviceName} client={s.Client} />{s.DeviceName}</span>
          <span className="hint">{s.Client}{s.RemoteEndPoint ? ` · ${isLocal(s.RemoteEndPoint) ? 'at home' : `away from home (${s.RemoteEndPoint})`}` : ''}</span>
        </span>
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

// ---------- who's watching (top bar) ----------

/** Admins see at a glance when someone is watching; it links to the full Activity page. */
export function WatchingBadge() {
  const api = useApi();
  const [list, setList] = useState<ActiveSession[]>([]);
  const load = () => {
    if (document.visibilityState !== 'visible') return;
    api.admin.sessions().then((s) => setList(s.filter((x) => x.NowPlayingItem))).catch(() => undefined);
  };
  useAsync(async () => load(), []);
  usePoll(load, 15000);
  if (!list.length) return null;
  const who = list.map((s) => `${s.UserName}: ${s.NowPlayingItem?.Type === 'Episode' ? s.NowPlayingItem.SeriesName : s.NowPlayingItem?.Name} on ${s.DeviceName}`).join('\n');
  return (
    <Link to="/server/activity" className="watching-badge" title={who} aria-label={`${list.length} watching now. ${who}`}>
      <span className="live-dot" aria-hidden="true" />
      {list.length} watching
    </Link>
  );
}

// ---------- watch history ----------

const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
];

export function deviceKind(device: string, client: string): 'tv' | 'phone' | 'computer' | 'browser' {
  const s = `${device} ${client}`;
  if (/\btv\b|chromecast|google tv|roku|shield|fire ?tv|tizen|webos|samsung tv|lg tv|apple tv|living room|bedroom|android tv/i.test(s)) return 'tv';
  if (/iphone|ipad|android|phone|pixel|galaxy|tablet|mobile/i.test(s)) return 'phone';
  if (/chrome|firefox|safari|edge|opera|browser|web/i.test(s)) return 'browser';
  return 'computer';
}

function DeviceIcon({ device, client }: { device: string; client: string }) {
  const k = deviceKind(device, client);
  return <span className="dev-icon" aria-hidden="true">{k === 'tv' ? <Icon.tv /> : k === 'phone' ? <Icon.phone /> : k === 'browser' ? <Icon.globe /> : <Icon.laptop />}</span>;
}

function isLocal(ip: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|fe80:|fc|fd)/i.test(ip);
}

function duration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

function how(r: WatchRecord): { text: string; tone: '' | 'ember' } | null {
  if (r.PlayMethod === 'Transcode') return { text: r.ConvertedHeight ? `Converted to ${r.ConvertedHeight}p` : 'Converted', tone: 'ember' };
  if (r.PlayMethod === 'DirectStream') return { text: 'Repackaged', tone: '' };
  if (r.PlayMethod === 'DirectPlay') return { text: 'Original quality', tone: '' };
  return null;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function Thumb({ r }: { r: WatchRecord }) {
  const api = useApi();
  const [step, setStep] = useState(0);
  // Episodes: their own still. Movies: wide backdrop, then poster. Gone from the library: a blank tile.
  const urls = r.ItemType === 'Episode' ? [`/Items/${r.ItemId}/Images/Primary?fillWidth=192&quality=80`] : [`/Items/${r.ItemId}/Images/Backdrop/0?fillWidth=192&quality=80`, `/Items/${r.ItemId}/Images/Primary?fillWidth=192&quality=80`];
  return (
    <span className="hist-thumb">
      {step < urls.length && r.ItemId !== '00000000-0000-0000-0000-000000000000' && (
        <img src={`${api.session.server}${urls[step]}`} alt="" loading="lazy" onError={() => setStep((n) => n + 1)} />
      )}
    </span>
  );
}

function WatchHistory() {
  const api = useApi();
  const [days, setDays] = useState(30);
  const [user, setUser] = useState('');
  const hist = useAsync(() => api.admin.history(days, user || undefined), [days, user]);
  usePoll(() => api.admin.history(days, user || undefined).then(hist.setData).catch(() => undefined), 30000);
  const records = hist.data?.Records ?? [];

  // Totals per person and per device for the period.
  const { people, devices } = useMemo(() => {
    const p = new Map<string, { name: string; seconds: number; titles: Set<string>; devices: Map<string, number> }>();
    const d = new Map<string, { name: string; client: string; seconds: number; plays: number; last: string; people: Set<string> }>();
    for (const r of records) {
      const sec = r.WatchedSeconds ?? 0;
      const pe = p.get(r.UserId) ?? { name: r.UserName, seconds: 0, titles: new Set(), devices: new Map() };
      pe.seconds += sec;
      pe.titles.add(r.SeriesId ?? r.ItemId);
      pe.devices.set(r.DeviceName, (pe.devices.get(r.DeviceName) ?? 0) + Math.max(sec, 1));
      p.set(r.UserId, pe);
      const de = d.get(r.DeviceName) ?? { name: r.DeviceName, client: r.Client, seconds: 0, plays: 0, last: r.StartedUtc, people: new Set() };
      de.seconds += sec;
      de.plays += 1;
      de.client ||= r.Client;
      if (r.StartedUtc > de.last) de.last = r.StartedUtc;
      de.people.add(r.UserName);
      d.set(r.DeviceName, de);
    }
    return { people: [...p.values()].sort((a, b) => b.seconds - a.seconds || b.titles.size - a.titles.size), devices: [...d.values()].sort((a, b) => b.last.localeCompare(a.last)) };
  }, [records]);

  const byDay = useMemo(() => {
    const groups: { label: string; items: WatchRecord[] }[] = [];
    for (const r of records) {
      const label = dayLabel(new Date(r.StartedUtc));
      if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
      groups.at(-1)!.items.push(r);
    }
    return groups;
  }, [records]);

  const since = hist.data?.TrackingSince;
  return (
    <Section
      title="Watch history"
      desc={<>Who watched what, on which device, for how long, and whether the server had to convert it.</>}
      aside={
        <div className="hist-filters">
          <select className="select" aria-label="Person" value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Everyone</option>
            {hist.data?.Users.map((u) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
          </select>
          <div className="chip-row" role="group" aria-label="Period">
            {PERIODS.map((p) => <button key={p.days} className="chip" aria-pressed={days === p.days} onClick={() => setDays(p.days)}>{p.label}</button>)}
          </div>
        </div>
      }
    >
      {hist.error && <p className="err-box">{hist.error}</p>}
      {hist.data && records.length === 0 && <p className="muted">Nothing watched {days === 1 ? 'today' : `in the last ${days} days`}.</p>}

      {people.length > 0 && (
        <div className="hist-people">
          {people.map((p) => {
            const top = [...p.devices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
            return (
              <div key={p.name} className="hist-person">
                <strong>{p.name}</strong>
                <span className="hist-big">{p.seconds ? duration(p.seconds) : '—'}</span>
                <span className="hint">{p.titles.size} title{p.titles.size === 1 ? '' : 's'}{top ? ` · mostly on ${top}` : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {devices.length > 0 && (
        <details className="hist-devices">
          <summary>Devices ({devices.length})</summary>
          <ul>
            {devices.map((d) => (
              <li key={d.name}>
                <DeviceIcon device={d.name} client={d.client} />
                <span>
                  <strong>{d.name}</strong>
                  <span className="hint">{d.client ? `${d.client} · ` : ''}{[...d.people].join(', ')}</span>
                </span>
                <span className="hint">{d.plays} play{d.plays === 1 ? '' : 's'}{d.seconds ? ` · ${duration(d.seconds)}` : ''} · last {timeAgo(d.last)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {byDay.map((g) => (
        <div key={g.label} className="hist-day">
          <h3>{g.label}</h3>
          <ul className="hist-list">
            {g.items.map((r, i) => {
              const h = how(r);
              const pct = r.RunTimeTicks && r.PositionTicks ? Math.min(100, Math.round((r.PositionTicks / r.RunTimeTicks) * 100)) : null;
              return (
                <li key={`${r.StartedUtc}-${i}`} className="hist-row">
                  <Thumb r={r} />
                  <span className="hist-main">
                    <strong>{r.Title}</strong>
                    <span className="hint">
                      {r.UserName} · {new Date(r.StartedUtc).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {!r.EndedUtc ? ' · watching now' : r.WatchedSeconds ? ` · watched ${duration(r.WatchedSeconds)}` : ''}
                      {r.Finished ? ' · finished' : pct != null && r.EndedUtc ? ` · stopped at ${pct}%` : ''}
                    </span>
                  </span>
                  <span className="hist-dev">
                    <DeviceIcon device={r.DeviceName} client={r.Client} />
                    <span>
                      {r.DeviceName}
                      {r.Client && <span className="hint">{r.Client}</span>}
                    </span>
                  </span>
                  {h ? <span className={`chip-tag ${h.tone}`}>{h.text}</span> : <span />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {since && <p className="hint">Detailed history (time watched, quality) started {new Date(since).toLocaleDateString()}. Earlier entries come from the server log.</p>}
    </Section>
  );
}
