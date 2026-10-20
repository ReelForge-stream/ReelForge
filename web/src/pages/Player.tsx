import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
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

  // Auto-hide the top bar while watching.
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), 2500);
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('touchstart', wake);
    };
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
        if (isDemo) {
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

  const onEnded = async () => {
    if (item?.Type === 'Episode' && item.SeriesId && item.SeasonId) {
      const eps = await api.episodes(item.SeriesId, item.SeasonId);
      const next = eps.find((e) => (e.IndexNumber ?? 0) > (item.IndexNumber ?? 0));
      if (next) return nav(`/play/${next.Id}`, { replace: true });
    }
    nav(-1);
  };

  const title = item ? (item.Type === 'Episode' ? `${item.SeriesName} ${epCode(item)} · ${item.Name}` : item.Name) : '';

  return (
    <div className={`player${idle && !error ? ' idle' : ''}`}>
      <video ref={video} controls playsInline crossOrigin="anonymous" onEnded={onEnded}>
        {subs.map((s) => (
          <track key={s.Index} kind="subtitles" src={api.subtitleUrl(s.DeliveryUrl!)} srcLang={s.Language ?? 'und'} label={s.DisplayTitle ?? s.Language ?? 'Subtitles'} />
        ))}
      </video>
      <div className="top">
        <button className="btn ghost sm" onClick={() => nav(-1)} aria-label="Back">
          <Icon.back />
        </button>
        <div>
          <h2>{title}</h2>
          {method && <span className="muted small">{method}</span>}
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}
