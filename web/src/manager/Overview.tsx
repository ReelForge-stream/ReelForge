import { useState } from 'react';
import { Link } from 'react-router-dom';
import { bytes } from '../lib/api';
import { useApi, useAsync, useToast } from '../lib/ui';

export default function ManagerOverview() {
  const api = useApi();
  const toast = useToast();
  const ov = useAsync(() => api.mm.overview(), []);
  const [busy, setBusy] = useState(false);

  if (ov.error) return <div className="err-box">Media Manager isn’t responding: {ov.error}</div>;
  if (!ov.data) return <p className="muted">Checking your server…</p>;
  const { Encoder: enc, Jellyfin: jf, Queue: q, Holding: h } = ov.data;
  const gpuOk = enc.Working.includes('hevc_nvenc');
  const streamingOnGpu = jf.HardwareAcceleration === 'nvenc';

  const enable = async () => {
    setBusy(true);
    try {
      await api.mm.enableStreamingGpu();
      toast('Streaming now uses the GPU');
      ov.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="summary-band">
        <div>
          <div className="k" style={{ color: 'var(--coolant)' }}>{bytes(q.SavedBytes)}</div>
          <div className="v">saved by conversions so far</div>
        </div>
        <div>
          <div className="k">{q.Running + q.Queued}</div>
          <div className="v">{q.Running ? `in the queue, ${q.Running} converting now` : q.Queued ? 'waiting to convert' : 'conversions in the queue'}</div>
        </div>
        <div>
          <div className="k">{bytes(h.Bytes)}</div>
          <div className="v">
            in {h.Count} removed {h.Count === 1 ? 'file' : 'files'}, deleted for good after {h.Days} days
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>
          <span className={`status-dot ${gpuOk ? 'ok' : 'warn'}`} />
          Graphics card
        </h3>
        <p className="muted" style={{ marginTop: 6 }}>
          {enc.Summary}
          {enc.DriverVersion ? ` · driver ${enc.DriverVersion}` : ''}
        </p>
        {gpuOk && !enc.HevcNvenc10Bit && (
          <p className="muted small" style={{ marginTop: 6 }}>This card can’t encode 10-bit HEVC, so 10-bit files convert on the CPU.</p>
        )}
      </div>

      <div className="panel">
        <h3>
          <span className={`status-dot ${streamingOnGpu ? 'ok' : 'warn'}`} />
          Streaming to phones and remote devices
        </h3>
        <p className="muted measure" style={{ marginTop: 6 }}>
          {streamingOnGpu
            ? 'Video is converted on the GPU when a device can’t play a file directly. This is what keeps remote playback from buffering.'
            : 'Video is converted on the CPU when a device can’t play a file directly, which is the most common cause of buffering. Switch it to the GPU.'}
        </p>
        {!streamingOnGpu && gpuOk && (
          <button className="btn primary" style={{ marginTop: 16 }} disabled={busy} onClick={enable}>
            {busy ? 'Switching…' : 'Use the GPU for streaming'}
          </button>
        )}
      </div>

      <div className="panel">
        <h3>Find space</h3>
        <p className="muted measure" style={{ marginTop: 6 }}>
          Check for duplicate copies of the same movie or episode, or for files that would be much smaller re-encoded. Nothing is removed until you choose it.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <Link className="btn" to="/manager/duplicates">Find duplicates</Link>
          <Link className="btn" to="/manager/space">Scan for space savings</Link>
        </div>
      </div>
    </>
  );
}
