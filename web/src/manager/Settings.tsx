import { useEffect, useState } from 'react';
import type { QualityPreset, Settings, TargetCodec } from '../lib/types';
import { useApi, useAsync, useToast } from '../lib/ui';

const hours = [-1, ...Array.from({ length: 24 }, (_, i) => i)];
const hourLabel = (h: number) => (h < 0 ? 'Any time' : new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }));

export default function ManagerSettings() {
  const api = useApi();
  const toast = useToast();
  const loaded = useAsync(() => api.mm.settings(), []);
  const enc = useAsync(() => api.mm.overview().then((o) => o.Encoder), []);
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data) setS(loaded.data);
  }, [loaded.data]);

  if (loaded.error) return <div className="err-box">Couldn’t load settings: {loaded.error}</div>;
  if (!s) return <p className="muted">Loading…</p>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const av1Gpu = enc.data?.Working.includes('av1_nvenc');
  const dirty = JSON.stringify(s) !== JSON.stringify(loaded.data);

  const save = async () => {
    setBusy(true);
    try {
      loaded.setData(await api.mm.saveSettings(s));
      toast('Settings saved');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-grid">
      <section>
        <h2 style={{ marginBottom: 16 }}>Conversions</h2>
        <div className="settings-grid">
          <div className="field">
            <label htmlFor="codec">Convert to</label>
            <select id="codec" className="select" value={s.TargetCodec} onChange={(e) => set('TargetCodec', e.target.value as TargetCodec)}>
              <option value="Hevc">HEVC (H.265) — plays on nearly every TV, phone and browser</option>
              <option value="Av1">AV1 — about 20% smaller, needs newer devices{av1Gpu ? '' : ' (CPU only on this card)'}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="preset">Quality</label>
            <select id="preset" className="select" value={s.Preset} onChange={(e) => set('Preset', e.target.value as QualityPreset)}>
              <option value="Balanced">Balanced — looks the same as the original for most viewing</option>
              <option value="MaxSavings">Smallest files — fine for TV shows and casual watching</option>
              <option value="HighQuality">Highest quality — keeps more grain and detail, saves less</option>
            </select>
          </div>
          <Toggle
            label="Include HDR files"
            desc="Keeps 10-bit colour and HDR tags. Dolby Vision files are always left alone."
            checked={s.IncludeHdr}
            onChange={(v) => set('IncludeHdr', v)}
          />
          <Toggle
            label="Wait while someone is watching"
            desc="New conversions don’t start during playback, so streaming always gets the GPU first."
            checked={s.PauseWhileStreaming}
            onChange={(v) => set('PauseWhileStreaming', v)}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="ws">Start conversions after</label>
              <select id="ws" className="select" value={s.WindowStartHour} onChange={(e) => set('WindowStartHour', Number(e.target.value))}>
                {hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="we">Stop starting new ones at</label>
              <select id="we" className="select" value={s.WindowEndHour} onChange={(e) => set('WindowEndHour', Number(e.target.value))}>
                {hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="conc">Files at once</label>
            <select id="conc" className="select" value={s.MaxConcurrentJobs} onChange={(e) => set('MaxConcurrentJobs', Number(e.target.value))}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 16, marginTop: 16 }}>Removed files</h2>
        <div className="field">
          <label htmlFor="days">Keep removed and replaced files for</label>
          <select id="days" className="select" value={s.HoldingDays} onChange={(e) => set('HoldingDays', Number(e.target.value))}>
            {[0, 3, 7, 14, 30, 60].map((d) => (
              <option key={d} value={d}>{d === 0 ? 'Don’t keep them — delete immediately' : `${d} days`}</option>
            ))}
          </select>
        </div>
      </section>

      <div>
        <button className="btn primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div className="setting">
      <label htmlFor={id}>
        <div>{label}</div>
        <div className="desc">{desc}</div>
      </label>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}
