import { useApi, useAsync } from '../lib/ui';
import { SaveBar, Section, Toggle, useDraft } from './common';

type Encoding = Record<string, unknown> & {
  HardwareAccelerationType: string;
  EnableHardwareEncoding: boolean;
  HardwareDecodingCodecs: string[];
  EnableDecodingColorDepth10Hevc: boolean;
  EnableDecodingColorDepth10Vp9: boolean;
  AllowHevcEncoding: boolean;
  AllowAv1Encoding: boolean;
  EnableTonemapping: boolean;
  EnableThrottling: boolean;
  EnableSegmentDeletion: boolean;
  EncoderPreset: string;
};
type Config = Record<string, unknown> & { RemoteClientBitrateLimit: number };

const ACCEL = [
  { id: 'none', label: 'None (processor only)' },
  { id: 'nvenc', label: 'NVIDIA (NVENC)' },
  { id: 'qsv', label: 'Intel Quick Sync' },
  { id: 'amf', label: 'AMD (AMF)' },
  { id: 'vaapi', label: 'VA-API (Linux)' },
];
const DECODE = [
  { id: 'h264', label: 'H.264' },
  { id: 'hevc', label: 'HEVC (H.265)' },
  { id: 'av1', label: 'AV1' },
  { id: 'vp9', label: 'VP9' },
  { id: 'mpeg2video', label: 'MPEG-2 (DVDs)' },
  { id: 'vc1', label: 'VC-1 (older Blu-rays)' },
  { id: 'vp8', label: 'VP8' },
];
const LIMITS = [0, 60, 40, 20, 12, 8, 4, 2].map((m) => ({ bps: m * 1_000_000, label: m ? `${m} Mbps${m >= 20 ? ' (4K)' : m >= 8 ? ' (1080p)' : ' (720p)'}` : 'No limit' }));

export default function Playback() {
  const api = useApi();
  const enc = useAsync(() => api.admin.namedConfig('encoding') as Promise<Encoding>, []);
  const cfg = useAsync(() => api.admin.config() as Promise<Config>, []);
  const gpu = useAsync(() => api.mm.overview().then((o) => o.Encoder).catch(() => undefined), []);
  const e = useDraft<Encoding>(enc.data, (v) => api.admin.saveNamedConfig('encoding', v));
  const c = useDraft<Config>(cfg.data, (v) => api.admin.saveConfig(v));

  if (enc.error) return <div className="err-box">Couldn’t load playback settings: {enc.error}</div>;
  const d = e.draft;
  const nvidia = gpu.data?.Working?.some((x) => x.includes('nvenc'));
  const usingGpu = d && d.HardwareAccelerationType !== 'none';
  const dirty = e.dirty || c.dirty;

  return (
    <div className="set-stack">
      <Section
        title="Converting while streaming"
        desc="When a TV, phone or browser can’t play a file as it is, or a viewer picks a lower quality, the server converts it on the fly. A graphics card does this many times faster than the processor and handles several viewers at once."
      >
        {!d ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="settings-grid">
            {nvidia && d.HardwareAccelerationType !== 'nvenc' && (
              <div className="set-banner">
                <span>An NVIDIA graphics card is available but streaming isn’t using it.</span>
                <button className="btn primary sm" onClick={() => e.set('HardwareAccelerationType', 'nvenc')}>Use the graphics card</button>
              </div>
            )}
            <div className="field">
              <label htmlFor="accel">Graphics card</label>
              <select id="accel" className="select" value={d.HardwareAccelerationType} onChange={(x) => e.set('HardwareAccelerationType', x.target.value)}>
                {ACCEL.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              {gpu.data && <span className="hint">{nvidia ? 'Detected: NVIDIA card with NVENC.' : 'No supported graphics card was detected; the processor will be used.'}</span>}
            </div>
            {usingGpu && (
              <>
                <div className="field">
                  <label>Let the card decode</label>
                  <div className="check-grid">
                    {DECODE.map((x) => (
                      <label key={x.id} className="check-row">
                        <input
                          type="checkbox"
                          className="check"
                          checked={d.HardwareDecodingCodecs.includes(x.id)}
                          onChange={(ev) => e.set('HardwareDecodingCodecs', ev.target.checked ? [...d.HardwareDecodingCodecs, x.id] : d.HardwareDecodingCodecs.filter((y) => y !== x.id))}
                        />
                        {x.label}
                      </label>
                    ))}
                  </div>
                  <span className="hint">RTX and Quadro RTX cards handle all of these except VP8; AV1 decoding needs an RTX 30-series or newer.</span>
                </div>
                <Toggle id="hdr10" label="Decode 10-bit HEVC on the card" desc="Needed for 4K HDR files. On for any card from the last several years." checked={d.EnableDecodingColorDepth10Hevc} onChange={(v) => e.set('EnableDecodingColorDepth10Hevc', v)} />
                <Toggle id="vp910" label="Decode 10-bit VP9 on the card" checked={d.EnableDecodingColorDepth10Vp9} onChange={(v) => e.set('EnableDecodingColorDepth10Vp9', v)} />
                <Toggle id="hwenc" label="Encode on the card" desc="Turn off only if converted video looks wrong." checked={d.EnableHardwareEncoding} onChange={(v) => e.set('EnableHardwareEncoding', v)} />
              </>
            )}
            <Toggle id="hevcenc" label="Send HEVC to devices that support it" desc="Same picture at about half the bandwidth of H.264. Good for watching away from home." checked={d.AllowHevcEncoding} onChange={(v) => e.set('AllowHevcEncoding', v)} />
            <Toggle id="av1enc" label="Send AV1 to devices that support it" desc="Smaller still, but needs an RTX 40-series or RTX Ada card to convert quickly." checked={d.AllowAv1Encoding} onChange={(v) => e.set('AllowAv1Encoding', v)} />
            <Toggle id="tonemap" label="Convert HDR for regular screens" desc="Keeps colours natural when an HDR movie plays on a screen without HDR, instead of looking washed out." checked={d.EnableTonemapping} onChange={(v) => e.set('EnableTonemapping', v)} />
            <Toggle id="throttle" label="Pace conversions" desc="Converts only a few minutes ahead of the viewer, which frees the card for other streams and conversions." checked={d.EnableThrottling} onChange={(v) => e.set('EnableThrottling', v)} />
            <Toggle id="segdel" label="Tidy up while streaming" desc="Deletes converted pieces already watched, so long movies don’t fill the disk." checked={d.EnableSegmentDeletion} onChange={(v) => e.set('EnableSegmentDeletion', v)} />
          </div>
        )}
      </Section>

      <Section title="Watching away from home" desc="Caps the quality sent over the internet, so a slow upload connection doesn’t make everyone buffer. Viewers on your home network always get full quality.">
        {c.draft ? (
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="remote">Highest quality away from home</label>
            <select id="remote" className="select" value={c.draft.RemoteClientBitrateLimit} onChange={(x) => c.set('RemoteClientBitrateLimit', Number(x.target.value))}>
              {LIMITS.map((l) => <option key={l.bps} value={l.bps}>{l.label}</option>)}
            </select>
            <span className="hint">Pick a little under your internet upload speed. Each viewer in the player can still choose lower.</span>
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Section>

      <SaveBar
        dirty={dirty}
        busy={e.busy || c.busy}
        onSave={async () => {
          if (e.dirty) await e.save();
          if (c.dirty) await c.save();
        }}
        onReset={() => {
          e.reset();
          c.reset();
        }}
        note="Changes apply to the next video someone starts."
      />
    </div>
  );
}
