import { useEffect, useMemo, useRef, useState } from 'react';
import { browserCanPlay, detectPlatform, formatBytes, isMobile, platformName, playability, suggestedOption, type Playability } from './device';
import { Modal } from './metaDialogs';
import type { DownloadJob, DownloadOptions, Item } from './types';
import { Icon, useApi, usePoll, useToast } from './ui';

/** Can this profile download? Admins always can; others when their profile allows it. */
export function useCanDownload(): boolean {
  const api = useApi();
  const p = api.session.user.Policy;
  return !!p?.IsAdministrator || p?.EnableContentDownloading !== false;
}

/** Hand a link to the browser's own downloader (keeps working if this page closes). */
export function saveFile(url: string, name?: string) {
  const a = document.createElement('a');
  a.href = url;
  if (name) a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Conversions the person started; the watcher saves each one when it's ready.
// Remembered for this browser tab, so a refresh doesn't lose them.
const KEY = 'rf-pending-downloads';
const watched = new Set<string>(
  (() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  })(),
);
const listeners = new Set<() => void>();
function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...watched]));
  } catch {
    /* private mode: memory only */
  }
}
function watch(id: string) {
  watched.add(id);
  persist();
  listeners.forEach((l) => l());
}
export function unwatch(id: string) {
  watched.delete(id);
  persist();
}

function clock(sec: number) {
  if (sec < 60) return 'under a minute';
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function jobStatus(j: DownloadJob): string {
  switch (j.State) {
    case 'Waiting':
      return 'Waiting for another download to finish';
    case 'Converting':
      return `Converting · ${Math.floor(j.Progress * 100)}%${j.EtaSeconds != null ? ` · about ${clock(j.EtaSeconds)} left` : ''}`;
    case 'Ready':
      return `Ready · ${formatBytes(j.SizeBytes)}`;
    default:
      return j.Error ?? 'The conversion failed';
  }
}

function describe(o: DownloadOptions): string {
  const res = o.Height >= 2000 ? '4K' : o.Height > 0 ? `${o.Height >= 1000 ? 1080 : o.Height >= 700 ? 720 : o.Height}p` : '';
  const hdr = o.Range !== 'Sdr' ? (o.Range === 'DolbyVision' ? 'Dolby Vision' : 'HDR') : '';
  const ext = (/\.([a-z0-9]+)$/i.exec(o.FileName)?.[1] ?? o.Container).toUpperCase();
  return [res, hdr, o.VideoCodec.toUpperCase().replace('H264', 'H.264').replace('HEVC', 'HEVC'), ext].filter(Boolean).join(' · ');
}

/** Download a movie or episode: as-is when this device can play it, otherwise converted at a size you pick. */
export function DownloadDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const platform = useMemo(() => detectPlatform(navigator.userAgent, navigator.maxTouchPoints), []);
  const device = platformName[platform];
  const [o, setO] = useState<DownloadOptions | null>(null);
  const [fit, setFit] = useState<Playability | null>(null);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState('');
  const [audio, setAudio] = useState(0);
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef(false);
  const jobRef = useRef<DownloadJob | null>(null);
  jobRef.current = job;
  // Closed while still converting: the app keeps watching and downloads it when it's done.
  useEffect(
    () => () => {
      const j = jobRef.current;
      if (j && !saved.current && (j.State === 'Waiting' || j.State === 'Converting')) watch(j.Id);
    },
    [],
  );

  useEffect(() => {
    let live = true;
    api.downloads
      .options(item.Id)
      .then((x) => {
        if (!live) return;
        const p = playability(x, platform, browserCanPlay);
        setO(x);
        setFit(p);
        // Plays here (or on a computer, in VLC): offer the untouched file first. Otherwise suggest a size.
        setChoice(p.verdict === 'yes' || (p.verdict === 'app' && !isMobile(platform)) ? 'original' : suggestedOption(x, platform));
        const def = x.AudioTracks.findIndex((t) => /default/i.test(t.Label));
        setAudio(def >= 0 ? def : 0);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [api, item.Id, platform]);

  // Follow the conversion while the dialog is open; save the file the moment it's ready.
  usePoll(
    () => {
      if (!job) return;
      api.downloads
        .list()
        .then((all) => {
          const j = all.find((x) => x.Id === job.Id);
          if (!j) return;
          setJob(j);
          if (j.State === 'Ready' && !saved.current) {
            saved.current = true;
            saveFile(api.downloads.fileUrl(j.Id), j.FileName);
          }
        })
        .catch(() => undefined);
    },
    1500,
    !!job && (job.State === 'Waiting' || job.State === 'Converting'),
  );

  const start = async () => {
    if (!o) return;
    if (choice === 'original') {
      saveFile(api.downloads.originalUrl(o.ItemId), o.FileName);
      toast(`Downloading ${o.Title}`);
      onClose();
      return;
    }
    setBusy(true);
    try {
      const j = await api.downloads.start(o.ItemId, o.MediaSourceId, choice, audio);
      setJob(j);
      if (j.State === 'Ready') {
        saved.current = true;
        saveFile(api.downloads.fileUrl(j.Id), j.FileName);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    saved.current = true; // don't hand it to the watcher on close
    unwatch(job.Id);
    await api.downloads.remove(job.Id).catch(() => undefined);
    toast('Download cancelled');
    onClose();
  };

  const title = item.Type === 'Episode' ? `${item.SeriesName ?? ''} · ${item.Name}` : item.Name;
  const picked = o?.Options.find((x) => x.Id === choice);
  // Rough conversion time: the graphics card runs ~6x faster than real time, the processor ~1.5x.
  const minutes = o ? Math.max(1, Math.round(o.DurationSeconds / (o.UsesGpu ? 6 : 1.5) / 60)) : 0;

  return (
    <Modal title="Download" sub={title} onClose={onClose} busy={false}>
      <div className="dl-body">
        {error && <p className="err-box">{error}</p>}
        {!o && !error && <p className="muted">Checking the file…</p>}

        {o && fit && !job && (
          <>
            <p className={`dl-verdict ${fit.verdict}`}>
              {fit.verdict === 'yes' && <>This file plays on {device} as it is.</>}
              {fit.verdict === 'app' && <>As it is, this file needs a player app such as VLC on {device} ({fit.problems.join(', ')}). Convert it to open it in the built-in player.</>}
              {fit.verdict === 'no' && <>This file won’t play on {device} as it is ({fit.problems.join(', ')}). Pick a size and the server will convert it so it does.</>}
            </p>

            <div className="dl-options" role="radiogroup" aria-label="What to download">
              <label className={`dl-opt${choice === 'original' ? ' on' : ''}`}>
                <input type="radio" name="dl" checked={choice === 'original'} onChange={() => setChoice('original')} />
                <span className="dl-opt-main">
                  <strong>Original file</strong>
                  <span className="hint">{describe(o)}</span>
                </span>
                <span className="dl-opt-size">{formatBytes(o.SizeBytes)}</span>
                {fit.verdict !== 'yes' && <span className={`chip-tag ${fit.verdict === 'no' ? 'danger' : ''}`}>{fit.verdict === 'no' ? 'Won’t play here' : 'Needs VLC'}</span>}
              </label>
              {o.Options.map((x) => (
                <label key={x.Id} className={`dl-opt${choice === x.Id ? ' on' : ''}`}>
                  <input type="radio" name="dl" checked={choice === x.Id} onChange={() => setChoice(x.Id)} />
                  <span className="dl-opt-main">
                    <strong>{x.Label}</strong>
                    <span className="hint">Converted to MP4 · plays on any phone, tablet or computer</span>
                  </span>
                  <span className="dl-opt-size">about {formatBytes(x.EstimatedBytes)}</span>
                  {fit.verdict !== 'yes' && x.Id === suggestedOption(o, platform) && <span className="chip-tag ember">Suggested</span>}
                </label>
              ))}
            </div>

            {picked && (
              <div className="dl-extra">
                {o.AudioTracks.length > 1 && (
                  <label className="dl-field">
                    <span>Sound</span>
                    <select className="select" value={audio} onChange={(e) => setAudio(Number(e.target.value))}>
                      {o.AudioTracks.map((t) => <option key={t.Index} value={t.Index}>{t.Label}</option>)}
                    </select>
                  </label>
                )}
                <p className="hint">
                  {o.TextSubtitles > 0 ? `${o.TextSubtitles} subtitle track${o.TextSubtitles > 1 ? 's' : ''} included (turn them on in your player). ` : ''}
                  {o.PictureSubtitles > 0 ? 'Picture-based subtitles (from discs) can’t be included. ' : ''}
                  The server converts it first: about {minutes} min on {o.UsesGpu ? 'the graphics card' : 'the processor'}. You can close this; the download starts when it’s ready.
                </p>
              </div>
            )}

            <div className="actions">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={busy || !choice} onClick={start}>
                <Icon.download />
                {choice === 'original' ? `Download (${formatBytes(o.SizeBytes)})` : busy ? 'Starting…' : 'Convert & download'}
              </button>
            </div>
          </>
        )}

        {job && (
          <div className="dl-progress">
            <p>
              <strong>{job.Label}</strong> · {job.State === 'Ready' ? `${formatBytes(job.SizeBytes)}` : `about ${formatBytes(job.EstimatedBytes)}`}
            </p>
            {job.State !== 'Failed' && (
              <div className="bar"><span style={{ width: `${Math.max(job.State === 'Ready' ? 100 : 2, job.Progress * 100)}%` }} /></div>
            )}
            <p className={job.State === 'Failed' ? 'err-box' : 'hint'}>{job.State === 'Ready' ? 'Ready. Your download has started.' : jobStatus(job)}</p>
            <div className="actions">
              {job.State === 'Ready' ? (
                <>
                  <button className="btn ghost" onClick={() => saveFile(api.downloads.fileUrl(job.Id), job.FileName)}>Download again</button>
                  <button className="btn primary" onClick={onClose}>Done</button>
                </>
              ) : job.State === 'Failed' ? (
                <button className="btn primary" onClick={onClose}>Close</button>
              ) : (
                <>
                  <button className="btn ghost" onClick={cancel}>Cancel conversion</button>
                  <button className="btn primary" onClick={onClose}>Keep going in the background</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Lives in the app shell: when a conversion you started finishes after you closed the dialog, the file downloads. */
export function DownloadWatcher() {
  const api = useApi();
  const toast = useToast();
  const [active, setActive] = useState(watched.size > 0);
  useEffect(() => {
    const l = () => setActive(watched.size > 0);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  usePoll(
    () => {
      api.downloads
        .list()
        .then((all) => {
          for (const j of all) {
            if (!watched.has(j.Id)) continue;
            if (j.State === 'Ready') {
              unwatch(j.Id);
              saveFile(api.downloads.fileUrl(j.Id), j.FileName);
              toast(`${j.Title} (${j.Label}) is ready and downloading`);
            } else if (j.State === 'Failed') {
              unwatch(j.Id);
              toast(`Couldn’t convert ${j.Title}: ${j.Error ?? 'the conversion failed'}`);
            }
          }
          setActive(watched.size > 0);
        })
        .catch(() => undefined);
    },
    3000,
    active,
  );
  return null;
}
