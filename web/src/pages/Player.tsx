import Hls from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isDemo, maxBitrate, type PlaybackReport } from '../lib/api';
import type { Item, MediaSource, MediaStream, TranscodingInfo } from '../lib/types';
import { Icon, epCode, useApi } from '../lib/ui';

const TICKS = 10_000_000;

/** Quality choices. "Original" sends the file untouched whenever this device can play it. */
const QUALITIES = [
  { bps: 400_000_000, label: 'Original', sub: 'Best picture; no conversion when this device can play the file' },
  { bps: 40_000_000, label: '4K', sub: '40 Mbps' },
  { bps: 20_000_000, label: '1080p', sub: '20 Mbps' },
  { bps: 10_000_000, label: '1080p', sub: '10 Mbps' },
  { bps: 4_000_000, label: '720p', sub: '4 Mbps' },
  { bps: 1_500_000, label: '480p', sub: '1.5 Mbps' },
  { bps: 720_000, label: '360p', sub: '720 kbps' },
];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SUB_SIZES = [
  { id: 's', label: 'Small' },
  { id: 'm', label: 'Medium' },
  { id: 'l', label: 'Large' },
];

/** What the server is asked to build: changing any of these restarts the stream at the same spot. */
interface StreamOpts {
  audio?: number; // audio track, when not the file's default
  burn?: number; // a picture-based subtitle the server draws into the video
  bitrate: number;
}

type Panel = null | 'main' | 'subs' | 'audio' | 'quality' | 'speed' | 'info';

function savedBitrate(): number {
  const b = maxBitrate();
  return QUALITIES.some((q) => q.bps === b) ? b : QUALITIES[0].bps;
}
function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export default function Player() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const fromStart = params.get('from') === 'start';
  const api = useApi();
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const [item, setItem] = useState<Item | null>(null);
  const [next, setNext] = useState<Item | null>(null);
  const [source, setSource] = useState<MediaSource | null>(null);
  const [method, setMethod] = useState<'DirectPlay' | 'DirectStream' | 'Transcode' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<StreamOpts>(() => ({ bitrate: savedBitrate() }));
  const [subIndex, setSubIndex] = useState(-1);
  const subChosen = useRef(false);
  const resumeAt = useRef<number | null>(null);
  const sourceId = useRef<string | undefined>(undefined); // the server applies track choices only to a named version of the file
  const [reloading, setReloading] = useState(false);

  const [idle, setIdle] = useState(false);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [subSize, setSubSize] = useState(() => load('reelforge.subSize', 'm'));
  const [panel, setPanel] = useState<Panel>(null);
  const [lingered, setLingered] = useState(false); // paused for a while: show the "You're watching" screen

  // ---------- controls auto-hide ----------
  const wakeTimer = useRef(0);
  const wake = useCallback(() => {
    setIdle(false);
    setLingered(false);
    clearTimeout(wakeTimer.current);
    wakeTimer.current = window.setTimeout(() => setIdle(true), 3000);
  }, []);
  useEffect(() => {
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      clearTimeout(wakeTimer.current);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
    };
  }, [wake]);
  useEffect(() => {
    if (!paused || panel || (error && !isDemo)) return;
    const t = window.setTimeout(() => setLingered(true), 6000);
    return () => clearTimeout(t);
  }, [paused, panel, error, time]);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // ---------- the title ----------
  useEffect(() => {
    let live = true;
    setItem(null);
    setSource(null);
    setError(null);
    setSubIndex(-1);
    subChosen.current = false;
    sourceId.current = undefined;
    setOpts((o) => ({ bitrate: o.bitrate }));
    api
      .item(id)
      .then((it) => {
        if (!live) return;
        setItem(it);
        setDuration((it.RunTimeTicks ?? 0) / TICKS);
        if (isDemo) setTime(((it.UserData?.PlayedPercentage ?? 0) / 100) * ((it.RunTimeTicks ?? 0) / TICKS));
        if (it.Type === 'Episode' && it.SeriesId && it.SeasonId) {
          api
            .episodes(it.SeriesId, it.SeasonId)
            .then((eps) => live && setNext(eps.find((e) => (e.IndexNumber ?? 0) > (it.IndexNumber ?? 0)) ?? null))
            .catch(() => undefined);
        } else setNext(null);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [api, id]);

  // ---------- the stream (rebuilt when audio, burned-in subtitles or quality change) ----------
  useEffect(() => {
    if (!item || item.Id !== id) return;
    const v = video.current!;
    let hls: Hls | null = null;
    let report: PlaybackReport | null = null;
    let timer = 0;
    let disposed = false;

    (async () => {
      try {
        const startSec = resumeAt.current ?? (fromStart ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0) / TICKS);
        resumeAt.current = null;
        const info = await api.playbackInfo(id, {
          mediaSourceId: sourceId.current,
          startTicks: Math.round(startSec * TICKS),
          audioIndex: opts.audio,
          subtitleIndex: opts.burn,
          maxBitrate: opts.bitrate,
          forceStream: opts.audio != null || opts.burn != null,
        });
        if (disposed) return;
        const src = info.MediaSources[0];
        if (!src) throw new Error('The server didn’t offer a playable version of this file.');
        setSource(src);
        sourceId.current = src.Id;
        if (!subChosen.current) {
          // Start with the subtitle the profile's preferences pick (usually forced subtitles, or none).
          const d = src.MediaStreams?.find((s) => s.Type === 'Subtitle' && s.Index === src.DefaultSubtitleStreamIndex);
          if (d && d.DeliveryMethod === 'External') setSubIndex(d.Index);
        }
        if (isDemo) {
          setMethod('DirectPlay');
          setError('Playback isn’t available in demo mode. Connect ReelForge to your server to watch.');
          setReloading(false);
          return;
        }

        const { url, hls: useHls } = api.streamUrl(id, src, info.PlaySessionId);
        const playMethod = src.SupportsDirectPlay ? 'DirectPlay' : useHls && /VideoCodec=copy|videocodec=copy/i.test(src.TranscodingUrl ?? '') ? 'DirectStream' : useHls ? 'Transcode' : 'DirectStream';
        setMethod(playMethod);
        setError(null);

        if (useHls && Hls.isSupported()) {
          hls = new Hls({ startPosition: startSec, maxBufferLength: 60, backBufferLength: 30 });
          hls.loadSource(url);
          hls.attachMedia(v);
          hls.on(Hls.Events.ERROR, (_e, d) => {
            if (d.fatal) setError(`Playback stopped: ${d.details}. Try again, or pick a lower quality in playback settings.`);
          });
        } else {
          v.src = url; // direct play, or Safari's native HLS
          v.addEventListener('loadedmetadata', () => { if (startSec > 0) v.currentTime = startSec; }, { once: true });
        }
        v.playbackRate = speed;
        v.addEventListener('playing', () => setReloading(false), { once: true });
        await v.play().catch(() => setReloading(false));

        report = {
          ItemId: id,
          MediaSourceId: src.Id,
          PlaySessionId: info.PlaySessionId,
          PositionTicks: Math.round(startSec * TICKS),
          CanSeek: true,
          PlayMethod: playMethod,
          AudioStreamIndex: opts.audio ?? src.DefaultAudioStreamIndex,
          SubtitleStreamIndex: opts.burn,
        };
        api.reportStart(report);
        timer = window.setInterval(() => {
          if (!report) return;
          report.PositionTicks = Math.round(v.currentTime * TICKS);
          report.IsPaused = v.paused;
          api.reportProgress(report);
        }, 10_000);
      } catch (e) {
        setError((e as Error).message);
        setReloading(false);
      }
    })();

    return () => {
      disposed = true;
      clearInterval(timer);
      if (report) {
        report.PositionTicks = Math.round(v.currentTime * TICKS);
        api.reportStop(report);
        if (hls) api.stopEncoding(report.PlaySessionId);
      }
      hls?.destroy();
      v.removeAttribute('src');
      v.load();
    };
    // speed is applied separately; it must not restart the stream
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, item, fromStart, opts]);

  // ---------- tracks ----------
  const { audioTracks, subTracks, textSubs, videoStream } = useMemo(() => {
    const streams = source?.MediaStreams ?? [];
    const subTracks = streams.filter((s) => s.Type === 'Subtitle');
    return {
      audioTracks: streams.filter((s) => s.Type === 'Audio'),
      subTracks,
      textSubs: subTracks.filter((s) => s.DeliveryMethod === 'External' && s.DeliveryUrl),
      videoStream: streams.find((s) => s.Type === 'Video'),
    };
  }, [source]);
  const currentAudio = opts.audio ?? source?.DefaultAudioStreamIndex ?? audioTracks[0]?.Index;

  // Show only the chosen text subtitle; the rest stay loaded but hidden.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const apply = () => {
      for (let i = 0; i < v.textTracks.length; i++) {
        const want = textSubs[i] && textSubs[i].Index === subIndex && opts.burn == null;
        v.textTracks[i].mode = want ? 'showing' : 'disabled';
      }
    };
    apply();
    v.textTracks.addEventListener('addtrack', apply);
    return () => v.textTracks.removeEventListener('addtrack', apply);
  }, [subIndex, textSubs, opts.burn]);

  const restartWith = (o: StreamOpts) => {
    resumeAt.current = video.current?.currentTime || time;
    setReloading(true);
    setOpts(o);
  };
  const chooseSub = (index: number) => {
    subChosen.current = true;
    setSubIndex(index);
    const st = subTracks.find((s) => s.Index === index);
    const needsBurn = !!st && st.DeliveryMethod !== 'External';
    if (needsBurn) restartWith({ ...opts, burn: index });
    else if (opts.burn != null) restartWith({ ...opts, burn: undefined });
    setPanel(null);
  };
  const chooseAudio = (index: number) => {
    setPanel(null);
    if (index === currentAudio) return;
    restartWith({ ...opts, audio: index === source?.DefaultAudioStreamIndex ? undefined : index });
  };
  const chooseQuality = (bps: number) => {
    setPanel(null);
    if (bps === opts.bitrate) return;
    save('reelforge.maxBitrate', String(bps));
    restartWith({ ...opts, bitrate: bps });
  };
  const chooseSpeed = (x: number) => {
    setSpeed(x);
    if (video.current) video.current.playbackRate = x;
    setPanel(null);
  };
  const chooseSubSize = (s: string) => {
    setSubSize(s);
    save('reelforge.subSize', s);
  };

  // ---------- transport ----------
  const toggle = () => {
    const el = video.current;
    if (!el || (error && !isDemo)) return;
    if (panel) return setPanel(null);
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  };
  const seekTo = (sec: number) => {
    const el = video.current;
    if (!el || !duration) return;
    el.currentTime = Math.max(0, Math.min(duration - 0.5, sec));
    setTime(el.currentTime);
  };
  const skip = (d: number) => seekTo((video.current?.currentTime ?? time) + d);
  const setVol = (x: number) => {
    const el = video.current;
    if (!el) return;
    el.volume = x;
    el.muted = x === 0;
  };
  const toggleMute = () => {
    const el = video.current;
    if (el) el.muted = !el.muted;
  };
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => undefined);

  // Keyboard: Space/K play-pause, arrows skip 10s, F full screen, M mute, C subtitles, Esc closes menus then goes back.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      wake();
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft') skip(-10);
      else if (e.key === 'ArrowRight') skip(10);
      else if (e.key === 'f') toggleFull();
      else if (e.key === 'm') toggleMute();
      else if (e.key === 'c' && subTracks.length) setPanel((p) => (p === 'subs' ? null : 'subs'));
      else if (e.key === 'Escape') {
        if (panel) setPanel(null);
        else if (!document.fullscreenElement) nav(-1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ---------- seek bar (Figma VideoPlayer 135:5016) ----------
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: RPointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const shown = drag ?? time;
  const pct = duration ? (shown / duration) * 100 : 0;

  const isEp = item?.Type === 'Episode';
  const heading = item ? (isEp ? item.SeriesName ?? item.Name : item.Name) : '';
  const sub = item && isEp ? `${epCode(item).replace(/^S0?(\d+)E0?(\d+)$/, 'S$1:E$2')} “${item.Name}”` : '';
  const showChrome = !idle || paused || !!error || !!panel;

  const subLabel = subIndex < 0 ? 'Off' : trackName(subTracks.find((s) => s.Index === subIndex));
  const audioLabel = trackName(audioTracks.find((s) => s.Index === currentAudio));
  const quality = QUALITIES.find((q) => q.bps === opts.bitrate) ?? QUALITIES[0];
  // Only offer qualities below what the file already is.
  const srcBitrate = source?.Bitrate ?? videoStream?.BitRate ?? 0;
  const qualities = QUALITIES.filter((q, n) => n === 0 || !srcBitrate || q.bps < srcBitrate);

  return (
    <div ref={root} className={`player subs-${subSize}${showChrome ? '' : ' idle'}${lingered ? ' lingered' : ''}`}>
      <video
        ref={video}
        playsInline
        crossOrigin="anonymous"
        onEnded={() => (next ? nav(`/play/${next.Id}`, { replace: true }) : nav(-1))}
        onClick={toggle}
        onDoubleClick={toggleFull}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          setBuffered(b.length ? b.end(b.length - 1) : 0);
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
      >
        {textSubs.map((s) => (
          <track key={`${source?.Id}-${s.Index}`} kind="subtitles" src={api.subtitleUrl(vtt(s.DeliveryUrl!))} srcLang={s.Language ?? 'und'} label={trackName(s)} />
        ))}
      </video>

      <button className="player-back" onClick={() => nav(-1)} aria-label="Back">
        <Icon.back />
      </button>

      {reloading && (
        <div className="player-loading" role="status">
          <span className="spinner" aria-hidden="true" />
          Switching…
        </div>
      )}

      {lingered && item && (
        <div className="player-paused" aria-live="polite">
          <p className="pp-kicker">You’re watching</p>
          <h1>{heading}</h1>
          {isEp && <p className="pp-sub">{sub}</p>}
          {item.Overview && <p className="pp-overview">{item.Overview}</p>}
        </div>
      )}

      {error && !lingered && <p className="player-notice" role="alert">{error}</p>}

      {panel && (
        <div className="pc-panel" role="dialog" aria-label="Playback settings" onPointerDown={(e) => e.stopPropagation()}>
          {panel === 'main' && (
            <>
              <h2 className="pc-panel-title">Playback settings</h2>
              <Row label="Subtitles" value={subLabel} onClick={() => setPanel('subs')} disabled={!subTracks.length} />
              <Row label="Audio" value={audioLabel} onClick={() => setPanel('audio')} disabled={audioTracks.length < 2} />
              <Row label="Quality" value={quality.bps === QUALITIES[0].bps ? 'Original' : `${quality.label} · ${quality.sub}`} onClick={() => setPanel('quality')} />
              <Row label="Speed" value={speed === 1 ? 'Normal' : `${speed}×`} onClick={() => setPanel('speed')} />
              <Row label="Playback info" value={methodLabel(method)} onClick={() => setPanel('info')} />
            </>
          )}
          {panel === 'subs' && (
            <Sub title="Subtitles" onBack={() => setPanel('main')}>
              <Choice on={subIndex < 0} onClick={() => chooseSub(-1)}>Off</Choice>
              {subTracks.map((s) => (
                <Choice key={s.Index} on={subIndex === s.Index} onClick={() => chooseSub(s.Index)} note={s.DeliveryMethod !== 'External' ? 'Drawn into the picture by the server' : undefined}>
                  {trackName(s)}
                </Choice>
              ))}
              <div className="pc-sizes" role="group" aria-label="Subtitle size">
                <span>Size</span>
                {SUB_SIZES.map((z) => (
                  <button key={z.id} className={subSize === z.id ? 'on' : ''} aria-pressed={subSize === z.id} onClick={() => chooseSubSize(z.id)}>
                    {z.label}
                  </button>
                ))}
              </div>
            </Sub>
          )}
          {panel === 'audio' && (
            <Sub title="Audio" onBack={() => setPanel('main')}>
              {audioTracks.map((s) => (
                <Choice key={s.Index} on={currentAudio === s.Index} onClick={() => chooseAudio(s.Index)}>
                  {trackName(s)}
                </Choice>
              ))}
            </Sub>
          )}
          {panel === 'quality' && (
            <Sub title="Quality" onBack={() => setPanel('main')}>
              {qualities.map((q) => (
                <Choice key={q.bps} on={opts.bitrate === q.bps} onClick={() => chooseQuality(q.bps)} note={q.bps === QUALITIES[0].bps ? q.sub : undefined}>
                  {q.bps === QUALITIES[0].bps ? 'Original' : `${q.label} · ${q.sub}`}
                </Choice>
              ))}
              <p className="pc-note">Lower quality uses less internet when you’re away from home. The server converts on the fly using its graphics card when it can.</p>
            </Sub>
          )}
          {panel === 'speed' && (
            <Sub title="Speed" onBack={() => setPanel('main')}>
              {SPEEDS.map((x) => (
                <Choice key={x} on={speed === x} onClick={() => chooseSpeed(x)}>
                  {x === 1 ? 'Normal' : `${x}×`}
                </Choice>
              ))}
            </Sub>
          )}
          {panel === 'info' && (
            <Sub title="Playback info" onBack={() => setPanel('main')}>
              <PlaybackInfo source={source} method={method} video={videoStream} audio={audioTracks.find((s) => s.Index === currentAudio)} el={video.current} buffered={buffered - time} />
            </Sub>
          )}
        </div>
      )}

      <div className="player-controls" onPointerMove={wake}>
        <div className="seek">
          <div
            ref={track}
            className="seek-track"
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(shown)}
            aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
            onPointerDown={(e) => {
              if (!duration) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(at(e));
            }}
            onPointerMove={(e) => {
              if (!duration) return;
              setHover(at(e));
              if (drag != null) setDrag(at(e));
            }}
            onPointerUp={(e) => {
              if (drag == null) return;
              seekTo(at(e));
              setDrag(null);
            }}
            onPointerLeave={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
              if (e.key === 'ArrowLeft') skip(-10);
              if (e.key === 'ArrowRight') skip(10);
            }}
          >
            <span className="seek-buffer" style={{ width: `${duration ? Math.min(100, (buffered / duration) * 100) : 0}%` }} />
            <span className="seek-fill" style={{ width: `${pct}%` }} />
            <span className="seek-knob" style={{ left: `${pct}%` }} />
            {hover != null && <span className="seek-hover" style={{ left: `${(hover / duration) * 100}%` }}>{clock(hover)}</span>}
          </div>
          <span className="seek-left" title="Time remaining">{clock(Math.max(0, duration - shown))}</span>
        </div>

        <div className="pc-row">
          <div className="pc-group">
            <button className="pc-btn" onClick={toggle} aria-label={paused ? 'Play' : 'Pause'}>{paused ? <Icon.play /> : <Icon.pause />}</button>
            <button className="pc-btn" onClick={() => skip(-10)} aria-label="Back 10 seconds"><Icon.back10 /></button>
            <button className="pc-btn" onClick={() => skip(10)} aria-label="Forward 10 seconds"><Icon.fwd10 /></button>
            <div className="pc-volume">
              <button className="pc-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted || volume === 0 ? <Icon.mute /> : <Icon.volume />}</button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setVol(Number(e.target.value))} aria-label="Volume" style={{ ['--v' as string]: `${(muted ? 0 : volume) * 100}%` }} />
            </div>
          </div>

          <div className="pc-title">
            <strong>{heading}</strong>
            {isEp && <span>{sub}</span>}
          </div>

          <div className="pc-group">
            {next && (
              <button className="pc-btn" onClick={() => nav(`/play/${next.Id}`, { replace: true })} aria-label={`Next episode: ${next.Name}`} title={`Next episode: ${next.Name}`}>
                <Icon.next />
              </button>
            )}
            {isEp && item?.SeriesId && (
              <button className="pc-btn" onClick={() => nav(`/item/${item.SeriesId}`)} aria-label="Episodes" title="Episodes">
                <Icon.episodes />
              </button>
            )}
            <button
              className={`pc-btn${subIndex >= 0 ? ' on' : ''}`}
              onClick={() => setPanel((p) => (p === 'subs' ? null : 'subs'))}
              aria-label="Subtitles"
              title="Subtitles (C)"
              aria-expanded={panel === 'subs'}
              disabled={!subTracks.length}
            >
              <Icon.subtitles />
            </button>
            <button className="pc-btn" onClick={() => setPanel((p) => (p ? null : 'main'))} aria-label="Playback settings" title="Playback settings" aria-expanded={!!panel && panel !== 'subs'}>
              <Icon.settings />
            </button>
            <button className="pc-btn" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? <Icon.exitFullscreen /> : <Icon.fullscreen />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, onClick, disabled }: { label: string; value: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="pc-row-btn" onClick={onClick} disabled={disabled}>
      <span>{label}</span>
      <span className="pc-row-value">{disabled && label !== 'Playback info' ? (label === 'Subtitles' ? 'None in this file' : value) : value}</span>
      {!disabled && <span className="pc-chev" aria-hidden="true"><Icon.back /></span>}
    </button>
  );
}

function Sub({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <>
      <button className="pc-panel-back" onClick={onBack}>
        <Icon.back />
        {title}
      </button>
      <div className="pc-choices">{children}</div>
    </>
  );
}

function Choice({ on, onClick, note, children }: { on: boolean; onClick: () => void; note?: string; children: ReactNode }) {
  return (
    <button className={`pc-choice${on ? ' on' : ''}`} role="menuitemradio" aria-checked={on} onClick={onClick}>
      <span className="pc-check" aria-hidden="true">{on && <Icon.check />}</span>
      <span>
        {children}
        {note && <small>{note}</small>}
      </span>
    </button>
  );
}

/** What's actually playing: the file, and what the server sends after any conversion. */
function PlaybackInfo({ source, method, video, audio, el, buffered }: { source: MediaSource | null; method: string | null; video?: MediaStream; audio?: MediaStream; el: HTMLVideoElement | null; buffered: number }) {
  const api = useApi();
  const [tx, setTx] = useState<TranscodingInfo | undefined>();
  useEffect(() => {
    let live = true;
    const poll = () => api.mySession().then((s) => live && setTx(s?.TranscodingInfo)).catch(() => undefined);
    poll();
    const t = window.setInterval(poll, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api]);
  const q = el?.getVideoPlaybackQuality?.();
  const rows: [string, string][] = [
    ['Playing as', methodLabel(method)],
    ['File', [source?.Container?.toUpperCase(), source?.Size ? `${(source.Size / 1e9).toFixed(1)} GB` : null, source?.Bitrate ? mbps(source.Bitrate) : null].filter(Boolean).join(' · ')],
    ['Video', video ? [video.Width && video.Height ? `${video.Width}×${video.Height}` : null, video.Codec?.toUpperCase(), video.VideoRangeType && video.VideoRangeType !== 'SDR' ? video.VideoRangeType : null, video.RealFrameRate ? `${Math.round(video.RealFrameRate * 100) / 100} fps` : null].filter(Boolean).join(' · ') : '—'],
    ['Audio', audio ? trackName(audio) : '—'],
  ];
  if (tx && method === 'Transcode') {
    rows.push(['Sending', [tx.Width && tx.Height ? `${tx.Width}×${tx.Height}` : null, tx.IsVideoDirect ? 'video untouched' : tx.VideoCodec?.toUpperCase(), tx.IsAudioDirect ? 'audio untouched' : tx.AudioCodec?.toUpperCase(), tx.Bitrate ? mbps(tx.Bitrate) : null].filter(Boolean).join(' · ')]);
    rows.push(['Converted by', tx.HardwareAccelerationType && tx.HardwareAccelerationType !== 'none' ? `Graphics card (${tx.HardwareAccelerationType.toUpperCase()})` : 'Processor (CPU)']);
    if (tx.TranscodeReasons?.length) rows.push(['Why', tx.TranscodeReasons.map(reason).join('; ')]);
    if (tx.Framerate) rows.push(['Conversion speed', `${Math.round(tx.Framerate)} fps`]);
  }
  rows.push(['Buffered ahead', `${Math.max(0, Math.round(buffered))} s`]);
  if (q) rows.push(['Dropped frames', `${q.droppedVideoFrames} of ${q.totalVideoFrames}`]);
  return (
    <dl className="pc-info">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

const REASONS: Record<string, string> = {
  ContainerNotSupported: 'this browser can’t open the file type',
  VideoCodecNotSupported: 'this browser can’t decode the video',
  AudioCodecNotSupported: 'this browser can’t play the audio format',
  SubtitleCodecNotSupported: 'subtitles are being drawn into the picture',
  ContainerBitrateExceedsLimit: 'the file is above the quality you picked',
  VideoBitrateNotSupported: 'the video is above the quality you picked',
  AudioChannelsNotSupported: 'too many audio channels for this device',
  VideoRangeTypeNotSupported: 'HDR is being converted for this screen',
  VideoBitDepthNotSupported: '10-bit video isn’t supported here',
  VideoProfileNotSupported: 'the video profile isn’t supported here',
  VideoLevelNotSupported: 'the video level isn’t supported here',
  DirectPlayError: 'direct play failed',
};
function reason(r: string): string {
  return REASONS[r] ?? r.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function methodLabel(m: string | null): string {
  if (m === 'DirectPlay') return 'Direct play (original file)';
  if (m === 'DirectStream') return 'Direct stream (repackaged, not re-encoded)';
  if (m === 'Transcode') return 'Converting for this device';
  return '…';
}

function mbps(bps: number): string {
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mbps` : `${Math.round(bps / 1e3)} kbps`;
}

const LANG: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German', ita: 'Italian', por: 'Portuguese', jpn: 'Japanese',
  kor: 'Korean', chi: 'Chinese', zho: 'Chinese', rus: 'Russian', dut: 'Dutch', nld: 'Dutch', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish',
  fin: 'Finnish', pol: 'Polish', tur: 'Turkish', ara: 'Arabic', hin: 'Hindi', heb: 'Hebrew', gre: 'Greek', ell: 'Greek', cze: 'Czech', ces: 'Czech',
  hun: 'Hungarian', tha: 'Thai', vie: 'Vietnamese', ukr: 'Ukrainian', und: '',
};

/** A friendly name for an audio or subtitle track, e.g. "English · Dolby Digital+ 5.1" or "Spanish (Forced)". */
function trackName(s?: MediaStream): string {
  if (!s) return '—';
  const lang = s.Language ? LANG[s.Language.toLowerCase()] ?? s.Language.toUpperCase() : '';
  if (s.Type === 'Audio') {
    const codec = ({ eac3: 'Dolby Digital+', ac3: 'Dolby Digital', truehd: 'Dolby TrueHD', dts: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3' } as Record<string, string>)[s.Codec ?? ''] ?? s.Codec?.toUpperCase();
    const ch = s.ChannelLayout ? s.ChannelLayout.replace('(side)', '').replace('stereo', 'Stereo').replace('mono', 'Mono') : s.Channels ? `${s.Channels} ch` : '';
    const title = s.Title && lang && s.Title.toLowerCase() !== lang.toLowerCase() && !/^(stereo|surround|mono|5\.1|7\.1)/i.test(s.Title) ? ` (${s.Title})` : '';
    return [lang || s.Title || 'Unknown language', [codec, ch].filter(Boolean).join(' ')].filter(Boolean).join(' · ') + title;
  }
  const extra = [s.IsForced ? 'Forced' : null, s.Title && !/^(forced|full)$/i.test(s.Title) && s.Title.toLowerCase() !== lang.toLowerCase() ? s.Title : null].filter(Boolean).join(', ');
  return `${lang || 'Unknown language'}${extra ? ` (${extra})` : ''}`;
}

/** Always ask for subtitles as WebVTT, the format browsers draw. */
function vtt(url: string): string {
  return url.replace(/Stream\.\w+(\?|$)/, 'Stream.vtt$1');
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
