import { useState } from 'react';
import { bytes } from '../lib/api';
import { encoderLabel, installScript, looksLocalOnly, uninstallScript } from '../lib/agentScript';
import type { AgentInfo } from '../lib/types';
import { Confirm, Icon, useApi, useAsync, usePoll, useToast } from '../lib/ui';
import { timeAgo, Toggle } from '../settings/common';

/** Media Manager → Agents: other PCs that convert files on their graphics cards for this server. */
export default function Agents() {
  const api = useApi();
  const toast = useToast();
  const data = useAsync(() => api.mm.agents(), []);
  usePoll(() => api.mm.agents().then(data.setData).catch(() => undefined), 3000);
  const [removing, setRemoving] = useState<AgentInfo | null>(null);

  if (data.error) return <div className="err-box">Couldn’t load agents: {data.error}</div>;
  if (!data.data) return <p className="muted">Looking for agents…</p>;
  const d = data.data;
  const online = d.Agents.filter((a) => a.Online);
  const converting = d.Agents.reduce((n, a) => n + a.Jobs.length, 0);

  const change = async (a: AgentInfo, c: { Enabled?: boolean; AllowCpu?: boolean; MaxJobs?: number }, msg: string) => {
    try {
      await api.mm.updateAgent(a.Id, c);
      toast(msg);
      data.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <div className="summary-band">
        <div>
          <div className="k">{d.Agents.length}</div>
          <div className="v">{d.Agents.length === 1 ? 'PC paired' : 'PCs paired'}</div>
        </div>
        <div>
          <div className="k" style={{ color: online.length ? 'var(--coolant)' : undefined }}>{online.length}</div>
          <div className="v">online now</div>
        </div>
        <div>
          <div className="k">{converting}</div>
          <div className="v">{converting === 1 ? 'file converting right now' : 'files converting right now'}</div>
        </div>
      </div>

      <div className="panel">
        <Toggle
          id="convert-on-server"
          label="Also convert on this server"
          desc="Off: only agents convert, and this server’s graphics card stays free for streaming."
          checked={d.ConvertOnServer}
          onChange={async (on) => {
            await api.mm.convertOnServer(on);
            toast(on ? 'This server converts too' : 'Only agents will convert');
            data.reload();
          }}
        />
      </div>

      {d.Agents.length > 0 && (
        <div className="agent-list">
          {d.Agents.map((a) => (
            <AgentCard
              key={a.Id}
              a={a}
              serverVersion={d.ServerVersion}
              onToggle={() => change(a, { Enabled: !a.Enabled }, a.Enabled ? `${a.Name} paused` : `${a.Name} will take files again`)}
              onCpu={(v) => change(a, { AllowCpu: v }, v ? `${a.Name} may use its processor` : `${a.Name} uses its graphics card only`)}
              onMaxJobs={(n) => change(a, { MaxJobs: n }, `${a.Name} converts ${n === 1 ? 'one file' : `${n} files`} at a time`)}
              onRemove={() => setRemoving(a)}
            />
          ))}
        </div>
      )}

      <AddPc pairingKey={d.PairingKey} version={d.ServerVersion} first={d.Agents.length === 0} onNewKey={async () => {
        await api.mm.newAgentKey();
        toast('New pairing key made. PCs already paired keep working.');
        data.reload();
      }} />

      {removing && (
        <Confirm
          title={`Remove ${removing.Name}?`}
          confirm="Remove"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api.mm.removeAgent(removing.Id).catch(() => undefined);
            toast(`${removing.Name} removed. Run the uninstall script on it to take the agent off that PC.`);
            setRemoving(null);
            data.reload();
          }}
        >
          It stops getting files straight away; anything it was converting goes back in the queue. The program stays on that PC until you run the uninstall script (below) on it.
        </Confirm>
      )}
    </>
  );
}

function AgentCard({ a, serverVersion, onToggle, onCpu, onMaxJobs, onRemove }: { a: AgentInfo; serverVersion: string; onToggle: () => void; onCpu: (v: boolean) => void; onMaxJobs: (n: number) => void; onRemove: () => void }) {
  const gpuEncoders = a.Encoders.filter((e) => /nvenc|amf/.test(e));
  const outdated = a.Version && a.Version !== serverVersion;
  const state = !a.Online ? 'offline' : !a.Enabled ? 'paused' : a.Jobs.length ? 'busy' : gpuEncoders.length || a.AllowCpu ? 'ready' : 'nogpu';
  const label = { offline: `Offline · last seen ${timeAgo(a.LastSeenUtc)}`, paused: 'Paused', busy: a.Jobs.length > 1 ? `Converting ${a.Jobs.length} files` : 'Converting', ready: 'Ready for files', nogpu: 'No usable graphics card' }[state];
  return (
    <article className={`agent-card ${state}`}>
      <header className="agent-head">
        <span className="agent-icon" aria-hidden="true"><Icon.laptop /></span>
        <div className="agent-title">
          <strong>{a.Name}</strong>
          <span className={`agent-state ${state}`}><span className={`status-dot ${state === 'ready' || state === 'busy' ? 'ok' : state === 'nogpu' ? 'warn' : ''}`} />{label}</span>
        </div>
        <div className="agent-actions">
          <button className="btn sm" onClick={onToggle}>{a.Enabled ? 'Pause' : 'Resume'}</button>
          <button className="btn sm ghost" onClick={onRemove}>Remove</button>
        </div>
      </header>

      {a.Jobs.map((j) => (
        <div key={j.Id} className="agent-job">
          <div className="agent-job-line">
            <span>{j.Title}</span>
            <span className="hint">
              {j.Status === 'Verifying' ? 'Checking the result…' : `${Math.round(j.Progress * 100)}%${j.Speed ? ` · ${j.Speed.toFixed(1)}× real time` : ''}`}
              {j.Encoder ? ` · ${encoderLabel(j.Encoder)}` : ''}
            </span>
          </div>
          <div className="bar"><span style={{ width: `${Math.max(2, j.Progress * 100)}%` }} /></div>
        </div>
      ))}

      <dl className="agent-facts">
        <div>
          <dt>Graphics</dt>
          <dd>{a.Gpus.length ? a.Gpus.join(', ') : '—'}</dd>
        </div>
        <div>
          <dt>Can convert to</dt>
          <dd className="chip-row">
            {a.Encoders.length ? a.Encoders.map((e) => <span key={e} className={`chip-tag ${/nvenc|amf/.test(e) ? 'ember' : ''}`}>{encoderLabel(e)}{a.TenBitHevc.includes(e) ? ' · 10-bit' : ''}</span>) : <span className="hint">Nothing yet: update the graphics driver on that PC</span>}
          </dd>
        </div>
        <div>
          <dt>Done so far</dt>
          <dd>{a.FilesConverted} {a.FilesConverted === 1 ? 'file' : 'files'}{a.BytesSaved ? `, ${bytes(a.BytesSaved)} saved` : ''}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>
            {a.Version ? `v${a.Version}` : '—'}
            {outdated && <span className="chip-tag ember" title="It updates itself when idle; or run the install script again">server is v{serverVersion}</span>}
            {a.Address ? <span className="hint"> · {a.Address}</span> : null}
          </dd>
        </div>
      </dl>
      {a.LastError && <p className="hint agent-error">Last problem: {a.LastError}</p>}
      <div className="agent-settings">
        <label className="agent-max">
          <span>Files at once</span>
          <select className="select" value={a.MaxJobs} onChange={(e) => onMaxJobs(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}{n === 1 ? ' (default)' : ''}</option>)}
          </select>
          <span className="hint">More than one helps on fast cards (RTX 30/40, Radeon RX 6000/7000). GeForce cards allow up to 8 encodes at once, but past 2–3 each one slows down.</span>
        </label>
      <label className="agent-cpu">
        <input type="checkbox" checked={a.AllowCpu} onChange={(e) => onCpu(e.target.checked)} />
        Use its processor when the graphics card can’t do a file (much slower)
      </label>
      </div>
    </article>
  );
}

function AddPc({ pairingKey, version, first, onNewKey }: { pairingKey: string; version: string; first: boolean; onNewKey: () => void }) {
  const toast = useToast();
  const [server, setServer] = useState(() => window.location.origin);
  const [open, setOpen] = useState(first);
  const [confirmKey, setConfirmKey] = useState(false);
  const script = installScript(server, pairingKey, version);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast('Couldn’t copy; select the text and copy it instead');
    }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([script.replace(/\n/g, '\r\n')], { type: 'text/plain' }));
    a.download = 'Install-ReelForgeAgent.ps1';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="panel add-pc">
      <button className="add-pc-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <h3><Icon.plus /> Add a PC</h3>
        <span className="hint">Windows 10/11 with an NVIDIA (GTX 10-series or newer) or AMD Radeon (RX 5000 or newer) card</span>
        <Icon.chevronDown />
      </button>
      {open && (
        <div className="add-pc-body">
          <ol className="add-steps">
            <li>
              <strong>Check the address the other PCs use to reach this server.</strong>
              <input className="input" value={server} onChange={(e) => setServer(e.target.value)} aria-label="Server address for agents" spellCheck={false} />
              {looksLocalOnly(server) && <p className="hint warn-text">“localhost” only works on this computer: use its network address instead, e.g. http://192.168.1.10:8096.</p>}
            </li>
            <li>
              <strong>Run this script on each PC, from Apex RMM.</strong>
              <span className="hint">
                In Apex RMM: Scripts → New script → PowerShell, paste it in and save it as “Install ReelForge Agent”. Then run it on the PCs you want (Apex runs scripts as SYSTEM, which is what it needs). Without Apex: open PowerShell as Administrator on that PC and paste it in. Running it again later updates the agent.
              </span>
              <div className="script-box">
                <pre tabIndex={0} aria-label="Install script">{script}</pre>
                <div className="script-actions">
                  <button className="btn primary sm" onClick={() => copy(script, 'Install script')}>Copy script</button>
                  <button className="btn sm" onClick={download}>Download .ps1</button>
                </div>
              </div>
            </li>
            <li>
              <strong>That’s it.</strong>
              <span className="hint">Each PC appears above within a minute and starts taking files from the Conversions queue. It reads each file from this server and sends the smaller copy back; this server checks it and swaps it in exactly like its own conversions. A wired network connection makes it much quicker.</span>
            </li>
          </ol>
          <div className="key-row">
            <span>Pairing key <code>{pairingKey}</code></span>
            <button className="btn sm ghost" onClick={() => setConfirmKey(true)}>Make a new key</button>
          </div>
          <details className="uninstall">
            <summary>Uninstall script</summary>
            <div className="script-box">
              <pre tabIndex={0}>{uninstallScript()}</pre>
              <div className="script-actions">
                <button className="btn sm" onClick={() => copy(uninstallScript(), 'Uninstall script')}>Copy</button>
              </div>
            </div>
          </details>
        </div>
      )}
      {confirmKey && (
        <Confirm title="Make a new pairing key?" confirm="Make new key" onCancel={() => setConfirmKey(false)} onConfirm={() => { setConfirmKey(false); onNewKey(); }}>
          PCs already paired keep working. Copies of the old install script stop working, so update the script saved in Apex RMM.
        </Confirm>
      )}
    </section>
  );
}
