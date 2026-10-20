import { useEffect, useState, type FormEvent } from 'react';
import { Api, defaultServer, login } from '../lib/api';
import { setup, type FsEntry } from '../lib/setup';
import type { Session } from '../lib/types';
import { Logo } from '../lib/ui';

type LibKind = 'movies' | 'tvshows' | 'homevideos' | 'music';
interface Lib {
  id: number;
  kind: LibKind;
  name: string;
  paths: string[];
}

const KINDS: { kind: LibKind; label: string; example: string }[] = [
  { kind: 'movies', label: 'Movies', example: '\\\\nas\\media\\Movies' },
  { kind: 'tvshows', label: 'TV Shows', example: '\\\\nas\\media\\TV' },
  { kind: 'homevideos', label: 'Home videos', example: 'D:\\Videos' },
  { kind: 'music', label: 'Music', example: '\\\\nas\\media\\Music' },
];
const STEPS = ['Your server', 'Admin account', 'Libraries', 'Finish'];

export default function Setup({ onDone }: { onDone: (s: Session) => void }) {
  const [step, setStep] = useState(0);
  const [serverName, setServerName] = useState('ReelForge');
  const [country, setCountry] = useState('US');
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [libs, setLibs] = useState<Lib[]>([
    { id: 1, kind: 'movies', name: 'Movies', paths: [] },
    { id: 2, kind: 'tvshows', name: 'TV Shows', paths: [] },
  ]);
  const [remote, setRemote] = useState(true);
  const [gpu, setGpu] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setup.defaults().then((d) => {
      if (d.ServerName) setServerName(d.ServerName);
      if (d.MetadataCountryCode) setCountry(d.MetadataCountryCode);
    }).catch(() => undefined);
  }, []);

  const next = (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setStep((s) => s + 1);
  };

  async function finish() {
    setError(null);
    try {
      setProgress('Saving server settings…');
      await setup.saveConfig({ ServerName: serverName.trim() || 'ReelForge', UICulture: 'en-US', MetadataCountryCode: country, PreferredMetadataLanguage: 'en' });
      setProgress('Creating your admin account…');
      await setup.firstUser();
      await setup.saveUser(user.trim(), pw);
      for (const l of libs.filter((x) => x.paths.length)) {
        setProgress(`Adding ${l.name}…`);
        await setup.addLibrary(l.name.trim() || KINDS.find((k) => k.kind === l.kind)!.label, l.kind, l.paths);
      }
      setProgress('Finishing…');
      await setup.remoteAccess(remote);
      await setup.complete();

      setProgress('Signing you in…');
      const session = await login(defaultServer(), user.trim(), pw);
      const api = new Api(session);
      if (gpu) {
        setProgress('Switching streaming to the GPU…');
        await api.mm.enableStreamingGpu().catch(() => undefined); // no NVIDIA card: carry on
      }
      await api.post('/Library/Refresh').catch(() => undefined);
      onDone(session);
    } catch (e) {
      setProgress(null);
      setError(`Setup stopped: ${(e as Error).message}. Check the details and try again.`);
    }
  }

  const pwOk = pw.length >= 8 && pw === pw2;
  const anyFolder = libs.some((l) => l.paths.length);

  return (
    <div className="login setup">
      <div className="setup-card">
        <div className="wordmark">
          <Logo />
          ReelForge
        </div>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="n">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <form onSubmit={next} className="setup-body">
            <h2>Set up your media server</h2>
            <p className="muted">This takes about two minutes. Everything here can be changed later.</p>
            <div className="field">
              <label htmlFor="sn">Server name</label>
              <input id="sn" className="input" value={serverName} onChange={(e) => setServerName(e.target.value)} required />
              <span className="hint">Shown in apps on your TVs and phones.</span>
            </div>
            <div className="field">
              <label htmlFor="cc">Country for ratings and release dates</label>
              <select id="cc" className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                {[['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['MX', 'Mexico']].map(([c, n]) => (
                  <option key={c} value={c}>{n}</option>
                ))}
              </select>
            </div>
            <div className="setup-actions">
              <button className="btn primary lg">Continue</button>
            </div>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={next} className="setup-body">
            <h2>Create the admin account</h2>
            <p className="muted">This account manages the server and the Media Manager. You can add family members afterwards.</p>
            <div className="field">
              <label htmlFor="u">Username</label>
              <input id="u" className="input" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="p">Password</label>
              <input id="p" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
              <span className="hint">At least 8 characters. Use a strong one if you'll watch away from home.</span>
            </div>
            <div className="field">
              <label htmlFor="p2">Confirm password</label>
              <input id="p2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
              {pw2 && pw !== pw2 && <span className="error">The passwords don’t match.</span>}
            </div>
            <div className="setup-actions">
              <button type="button" className="btn ghost lg" onClick={() => setStep(0)}>Back</button>
              <button className="btn primary lg" disabled={!user.trim() || !pwOk}>Continue</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="setup-body">
            <h2>Add your libraries</h2>
            <p className="muted">Point each library at the folders that hold your files. Nothing is moved or renamed.</p>
            <div className="note-box">
              <strong>Files on a NAS?</strong> Use the network path, like <code>\\nas\media\Movies</code>, not a drive letter such as <code>Z:</code>. If a share won’t add, the ReelForge service needs your Windows account: open <em>services.msc</em>, then ReelForge Media Server → Log On.
            </div>
            {libs.map((l) => (
              <LibraryEditor
                key={l.id}
                lib={l}
                onChange={(u) => setLibs((all) => all.map((x) => (x.id === l.id ? u : x)))}
                onRemove={() => setLibs((all) => all.filter((x) => x.id !== l.id))}
              />
            ))}
            <div className="chips" style={{ marginTop: 8 }}>
              {KINDS.filter((k) => !libs.some((l) => l.kind === k.kind)).map((k) => (
                <button key={k.kind} type="button" className="chip" onClick={() => setLibs((all) => [...all, { id: Date.now(), kind: k.kind, name: k.label, paths: [] }])}>
                  Add {k.label}
                </button>
              ))}
            </div>
            <div className="setup-actions">
              <button type="button" className="btn ghost lg" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="btn primary lg" onClick={() => next()}>
                {anyFolder ? 'Continue' : 'Skip for now'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="setup-body">
            <h2>Almost done</h2>
            <div className="settings-grid" style={{ gap: 18, margin: '8px 0 4px' }}>
              <Toggle id="remote" label="Let other devices connect" desc="TVs, phones and computers on your network, and over your VPN when you’re away." checked={remote} onChange={setRemote} />
              <Toggle id="gpu" label="Use the GPU for streaming" desc="Converts video on your NVIDIA card when a device can’t play a file directly, so remote playback doesn’t buffer." checked={gpu} onChange={setGpu} />
            </div>
            <div className="summary-list">
              <div><span className="muted">Server</span><span>{serverName}</span></div>
              <div><span className="muted">Admin</span><span>{user}</span></div>
              {libs.filter((l) => l.paths.length).map((l) => (
                <div key={l.id}><span className="muted">{l.name}</span><span>{l.paths.length} {l.paths.length === 1 ? 'folder' : 'folders'}</span></div>
              ))}
              {!anyFolder && <div><span className="muted">Libraries</span><span>None yet</span></div>}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            {progress && <p className="muted" role="status">{progress}</p>}
            <div className="setup-actions">
              <button type="button" className="btn ghost lg" disabled={!!progress} onClick={() => setStep(2)}>Back</button>
              <button type="button" className="btn primary lg" disabled={!!progress} onClick={finish}>
                {progress ? 'Setting up…' : 'Finish setup'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryEditor({ lib, onChange, onRemove }: { lib: Lib; onChange: (l: Lib) => void; onRemove: () => void }) {
  const [path, setPath] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const kind = KINDS.find((k) => k.kind === lib.kind)!;

  async function add(p: string) {
    const clean = p.trim().replace(/[\\/]+$/, '') || p.trim();
    if (!clean) return;
    setErr(null);
    setChecking(true);
    try {
      await setup.validate(clean);
      if (!lib.paths.includes(clean)) onChange({ ...lib, paths: [...lib.paths, clean] });
      setPath('');
    } catch {
      setErr(
        clean.startsWith('\\\\')
          ? 'The server can’t open that share. Check the path, then make sure the ReelForge service runs as a Windows account that can reach it (services.msc → ReelForge Media Server → Log On).'
          : 'The server can’t find that folder. Check the path and try again.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="lib-editor">
      <div className="lib-head">
        <h3>{lib.name}</h3>
        <button type="button" className="btn ghost sm" onClick={onRemove}>Remove</button>
      </div>
      {lib.paths.map((p) => (
        <div key={p} className="lib-path">
          <code>{p}</code>
          <button type="button" className="btn ghost sm" onClick={() => onChange({ ...lib, paths: lib.paths.filter((x) => x !== p) })}>Remove</button>
        </div>
      ))}
      <form
        className="lib-add"
        onSubmit={(e) => {
          e.preventDefault();
          add(path);
        }}
      >
        <input className="input" placeholder={kind.example} aria-label={`Folder for ${lib.name}`} value={path} onChange={(e) => setPath(e.target.value)} />
        <button type="button" className="btn" onClick={() => setBrowsing(true)}>Browse</button>
        <button className="btn" disabled={!path.trim() || checking}>{checking ? 'Checking…' : 'Add'}</button>
      </form>
      {err && <p className="error small">{err}</p>}
      {browsing && (
        <FolderPicker
          onPick={(p) => {
            setBrowsing(false);
            add(p);
          }}
          onCancel={() => setBrowsing(false)}
        />
      )}
    </section>
  );
}

function FolderPicker({ onPick, onCancel }: { onPick: (path: string) => void; onCancel: () => void }) {
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (cwd ? setup.folders(cwd) : setup.drives())
      .then((r) => setEntries(r))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [cwd]);

  const up = async () => {
    if (!cwd) return;
    const parent = await setup.parent(cwd).catch(() => null);
    setCwd(parent || null);
  };

  return (
    <div className="dialog-back" onClick={onCancel}>
      <div className="dialog picker" role="dialog" aria-modal="true" aria-label="Choose a folder" onClick={(e) => e.stopPropagation()}>
        <h2>Choose a folder</h2>
        <p className="muted small">{cwd ?? 'Drives on the server'}</p>
        <div className="picker-list">
          {cwd && (
            <button type="button" className="picker-row" onClick={up}>
              ↑ Up one level
            </button>
          )}
          {loading && <p className="muted">Loading…</p>}
          {!loading && entries.length === 0 && <p className="muted">No folders here. NAS shares don’t appear in this list; type their path instead.</p>}
          {entries.map((e) => (
            <button key={e.Path} type="button" className="picker-row" onClick={() => setCwd(e.Path)}>
              {e.Name || e.Path}
            </button>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn primary" disabled={!cwd} onClick={() => cwd && onPick(cwd)}>Use this folder</button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ id, label, desc, checked, onChange }: { id: string; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
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
