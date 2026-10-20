import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isDemo, type PlaybackReport } from '../lib/api';
import type { Item, MediaStream } from '../lib/types';
import { Icon, epCode, useApi } from '../lib/ui';

const TICKS = 10_000_000;

export default function Player() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const fromStart = params.get('from') === 'start';
  const api = useApi();
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [subs, setSubs] = useState<MediaStream[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [idle, setIdle] = useState(false);
  const [method, setMethod] = useState<string>('');
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [subOn, setSubOn] = useState(-1);
  const [subsOpen, setSubsOpen] = useState(false);
  const [lingered, setLingered] = useState(false); // paused for a while: show the "You're watching" screen
  const [next, setNext] = useState<Item | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Controls hide after a few seconds of no movement while playing.
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
    if (!paused || (error && !isDemo)) return;
    const t = window.setTimeout(() => setLingered(true), 6000);
    return () => clearTimeout(t);
  }, [paused, error, time]);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  useEffect(() => {
    let hls: Hls | null = null;
    let report: PlaybackReport | null = null;
    let timer = 0;
    let disposed = false;
    const v = video.current!;

    (async () => {
      try {
        const it = await api.item(id);
        if (disposed) return;
        setItem(it);
        setDuration((it.RunTimeTicks ?? 0) / TICKS);
        if (it.Type === 'Episode' && it.SeriesId && it.SeasonId) {
          api.episodes(it.SeriesId, it.SeasonId).then((eps) => !disposed && setNext(eps.find((e) => (e.IndexNumber ?? 0) > (it.IndexNumber ?? 0)) ?? null)).catch(() => undefined);
        }
        if (isDemo) {
          setTime(((it.UserData?.PlayedPercentage ?? 0) / 100) * ((it.RunTimeTicks ?? 0) / TICKS));
          setError('Playback isn’t available in demo mode. Connect ReelForge to your server to watch.');
          return;
        }

        const info = await api.playbackInfo(id, undefined, 0);
        const src = info.MediaSources[0];
        if (!src) throw new Error('The server didn’t offer a playable version of this file.');
        const { url, hls: useHls } = api.streamUrl(id, src, info.PlaySessionId);
        const playMethod = src.SupportsDirectPlay ? 'DirectPlay' : useHls ? 'Transcode' : 'DirectStream';
        setMethod(playMethod === 'DirectPlay' ? 'Direct play' : playMethod === 'Transcode' ? 'Converting for this device' : 'Direct stream');
        setSubs((src.MediaStreams ?? []).filter((s) => s.Type === 'Subtitle' && s.DeliveryMethod === 'External' && s.DeliveryUrl));

        const startSec = fromStart ? 0 : (it.UserData?.PlaybackPositionTicks ?? 0) / TICKS;
        if (useHls && Hls.isSupported()) {
          hls = new Hls({ startPosition: startSec, maxBufferLength: 60, backBufferLength: 30 });
          hls.loadSource(url);
          hls.attachMedia(v);
          hls.on(Hls.Events.ERROR, (_e, d) => {
            if (d.fatal) setError(`Playback stopped: ${d.details}. Try again, or lower the quality.`);
          });
        } else {
          v.src = url; // direct play, or Safari's native HLS
          v.addEventListener('loadedmetadata', () => { if (startSec > 0) v.currentTime = startSec; }, { once: true });
        }
        await v.play().catch(() => undefined);

        report = { ItemId: id, MediaSourceId: src.Id, PlaySessionId: info.PlaySessionId, PositionTicks: Math.round(startSec * TICKS), CanSeek: true, PlayMethod: playMethod };
        api.reportStart(report);
        timer = window.setInterval(() => {
          if (!report) return;
          report.PositionTicks = Math.round(v.currentTime * TICKS);
          report.IsPaused = v.paused;
          api.reportProgress(report);
        }, 10_000);
      } catch (e) {
        setError((e as Error).message);
      }
    })();

    return () => {
      disposed = true;
      clearInterval(timer);
      if (report) {
        report.PositionTicks = Math.round(v.currentTime * TICKS);
        api.reportStop(report);
      }
      hls?.destroy();
      v.removeAttribute('src');
      v.load();
    };
  }, [api, id, fromStart]);

  const onEnded = () => (next ? nav(`/play/${next.Id}`, { replace: true }) : nav(-1));

  const v = () => video.current;
  const toggle = () => {
    const el = v();
    if (!el || error) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  };
  const seekTo = (sec: number) => {
    const el = v();
    if (!el || !duration) return;
    el.currentTime = Math.max(0, Math.min(duration - 0.5, sec));
    setTime(el.currentTime);
  };
  const skip = (d: number) => seekTo((v()?.currentTime ?? time) + d);
  const setVol = (x: number) => {
    const el = v();
    if (!el) return;
    el.volume = x;
    el.muted = x === 0;
  };
  const toggleMute = () => {
    const el = v();
    if (el) el.muted = !el.muted;
  };
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => undefined);
  const chooseSub = (n: number) => {
    const el = v();
    if (el) for (let i = 0; i < el.textTracks.length; i++) el.textTracks[i].mode = i === n ? 'showing' : 'disabled';
    setSubOn(n);
    setSubsOpen(false);
  };

  // Keyboard: Space/K play-pause, arrows skip 10s, F full screen, M mute, Esc back.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      wake();
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') skip(-10);
      else if (e.key === 'ArrowRight') skip(10);
      else if (e.key === 'f') toggleFull();
      else if (e.key === 'm') toggleMute();
      else if (e.key === 'Escape' && !document.fullscreenElement) nav(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // Seek bar (Figma VideoPlayer 135:5016): drag or click anywhere on the track.
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
  const showChrome = !idle || paused || !!error || subsOpen;

  return (
    <div ref={root} className={`player${showChrome ? '' : ' idle'}${lingered ? ' lingered' : ''}`}>
      <video
        ref={video}
        playsInline
        crossOrigin="anonymous"
        onEnded={onEnded}
        onClick={toggle}
        onDoubleClick={toggleFull}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          setBuffered(b.length ? b.end(b.length - 1) : 0);
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
      >
        {subs.map((s) => (
          <track key={s.Index} kind="subtitles" src={api.subtitleUrl(s.DeliveryUrl!)} srcLang={s.Language ?? 'und'} label={s.DisplayTitle ?? s.Language ?? 'Subtitles'} />
        ))}
      </video>

      <button className="player-back" onClick={() => nav(-1)} aria-label="Back">
        <Icon.back />
      </button>
      {method && <span className="player-method">{method}</span>}

      {lingered && item && (
        <div className="player-paused" aria-live="polite">
          <p className="pp-kicker">You’re watching</p>
          <h1>{heading}</h1>
          {isEp && <p className="pp-sub">{sub}</p>}
          {item.Overview && <p className="pp-overview">{item.Overview}</p>}
        </div>
      )}

      {error && !lingered && <p className="player-notice" role="alert">{error}</p>}

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
            {subs.length > 0 && (
              <div className="pc-menu-wrap">
                <button className={`pc-btn${subOn >= 0 ? ' on' : ''}`} onClick={() => setSubsOpen((o) => !o)} aria-label="Subtitles" aria-expanded={subsOpen}>
                  <Icon.subtitles />
                </button>
                {subsOpen && (
                  <div className="pc-menu" role="menu">
                    <p>Subtitles</p>
                    <button role="menuitemradio" aria-checked={subOn < 0} onClick={() => chooseSub(-1)}>Off</button>
                    {subs.map((s, n) => (
                      <button key={s.Index} role="menuitemradio" aria-checked={subOn === n} onClick={() => chooseSub(n)}>
                        {s.DisplayTitle ?? s.Language ?? `Track ${n + 1}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="pc-btn" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? <Icon.exitFullscreen /> : <Icon.fullscreen />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
