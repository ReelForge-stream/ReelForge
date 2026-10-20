import { useApi, useAsync } from '../lib/ui';
import { SaveBar, Section, Toggle, useDraft } from './common';

type Net = Record<string, unknown> & {
  EnableRemoteAccess: boolean;
  InternalHttpPort: number;
  PublicHttpPort: number;
  LocalNetworkSubnets: string[];
  KnownProxies: string[];
  AutoDiscovery: boolean;
  BaseUrl: string;
};

const list = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

export default function Network() {
  const api = useApi();
  const net = useAsync(() => api.admin.namedConfig('network') as Promise<Net>, []);
  const info = useAsync(() => api.admin.info(), []);
  const d = useDraft<Net>(net.data, (v) => api.admin.saveNamedConfig('network', v), 'Saved. Restart the server for port changes to take effect.');

  if (net.error) return <div className="err-box">Couldn’t load network settings: {net.error}</div>;
  const n = d.draft;
  if (!n) return <p className="muted">Loading…</p>;
  const portChanged = net.data && n.InternalHttpPort !== net.data.InternalHttpPort;

  return (
    <div className="set-stack">
      <Section title="Reaching your server">
        <dl className="kv">
          <div><dt>On your home network</dt><dd><code>{info.data?.LocalAddress ?? '…'}</code></dd></div>
        </dl>
        <div className="settings-grid">
          <Toggle
            id="remote"
            label="Allow connections from outside your home"
            desc="Needed to watch over the internet, through a VPN like NetBird or Tailscale, or behind a reverse proxy. Each profile can still be limited to home only."
            checked={n.EnableRemoteAccess}
            onChange={(v) => d.set('EnableRemoteAccess', v)}
          />
          <Toggle id="disc" label="Let TVs and phones find this server" desc="Apps on your network list ReelForge automatically." checked={n.AutoDiscovery} onChange={(v) => d.set('AutoDiscovery', v)} />
          <div className="field-row">
            <div className="field">
              <label htmlFor="port">Port</label>
              <input id="port" className="input" type="number" min={1} max={65535} value={n.InternalHttpPort} onChange={(e) => d.set('InternalHttpPort', Number(e.target.value))} />
              <span className="hint">{portChanged ? 'Takes effect after a restart. Update the Windows firewall rule too.' : 'Default 8096. The installer opens this port in the Windows firewall.'}</span>
            </div>
            <div className="field">
              <label htmlFor="pport">Public port</label>
              <input id="pport" className="input" type="number" min={1} max={65535} value={n.PublicHttpPort} onChange={(e) => d.set('PublicHttpPort', Number(e.target.value))} />
              <span className="hint">The port your router forwards, if different.</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Your networks" desc="Viewers on these networks count as “at home”: full quality, and they can use profiles that aren’t allowed away from home.">
        <div className="settings-grid">
          <div className="field">
            <label htmlFor="lan">Home and VPN networks</label>
            <textarea id="lan" className="input area" rows={3} placeholder="10.0.0.0/24, 100.64.0.0/10" value={n.LocalNetworkSubnets.join(', ')} onChange={(e) => d.set('LocalNetworkSubnets', list(e.target.value))} />
            <span className="hint">Leave empty to detect your home network automatically. Add your VPN’s range (NetBird and Tailscale use 100.64.0.0/10) so remote family devices get home treatment.</span>
          </div>
          <div className="field">
            <label htmlFor="proxy">Trusted reverse proxies</label>
            <textarea id="proxy" className="input area" rows={2} placeholder="10.0.0.5" value={n.KnownProxies.join(', ')} onChange={(e) => d.set('KnownProxies', list(e.target.value))} />
            <span className="hint">If you publish ReelForge through Nginx, Caddy or a Cloudflare tunnel, add that machine’s address so viewers’ real addresses are recognised.</span>
          </div>
        </div>
      </Section>

      <SaveBar dirty={d.dirty} busy={d.busy} onSave={d.save} onReset={d.reset} />
    </div>
  );
}
