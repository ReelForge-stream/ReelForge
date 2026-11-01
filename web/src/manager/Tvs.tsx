import { useState } from 'react';
import type { TvInfo } from '../lib/types';
import { Confirm, Icon, useApi, useAsync, usePoll, useToast } from '../lib/ui';
import { timeAgo } from '../settings/common';

/**
 * Media Manager → TVs: the Roku TVs running ReelForge. Each one checks in when the app opens. With the TV's
 * developer password saved here, the server installs new versions of the app on it by itself.
 */
export default function Tvs() {
  const api = useApi();
  const toast = useToast();
  const data = useAsync(() => api.mm.tvs(), []);
  usePoll(() => api.mm.tvs().then(data.setData).catch(() => undefined), 5000);
  const [removing, setRemoving] = useState<TvInfo | null>(null);

  if (data.error) return <div className="err-box">Couldn’t load TVs: {data.error}</div>;
  if (!data.data) return <p className="muted">Looking for TVs…</p>;
  const d = data.data;
  const auto = d.Tvs.filter((t) => t.AutoUpdate).length;
  const behind = d.Tvs.filter((t) => !t.UpToDate).length;

  const updateNow = async (t: TvInfo) => {
    try {
      await api.mm.updateTv(t.Id);
      toast(`Updating ${t.Name}. ReelForge closes and opens again on that TV.`);
      data.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <div className="summary-band">
        <div>
          <div className="k">{d.Tvs.length}</div>
          <div className="v">{d.Tvs.length === 1 ? 'TV with ReelForge' : 'TVs with ReelForge'}</div>
        </div>
        <div>
          <div className="k" style={{ color: auto ? 'var(--coolant)' : undefined }}>{auto}</div>
          <div className="v">update by themselves</div>
        </div>
        <div>
          <div className="k" style={{ color: behind ? 'var(--ember)' : undefined }}>{behind}</div>
          <div className="v">{behind === 1 ? 'needs an update' : 'need an update'} (app {d.ServerVersion})</div>
        </div>
      </div>

      <div className="panel">
        <p className="hint" style={{ margin: 0 }}>
          A Roku TV shows up here the first time ReelForge opens on it. Save the TV’s <strong>developer password</strong> (the one you set when you
          turned on developer mode, user <code>rokudev</code>) and this server installs every new version of the app on that TV by itself, the next
          time the app opens. The password is checked against the TV, kept encrypted on this server, and only ever sent to that same TV on your home network.
        </p>
      </div>

      {d.Tvs.length === 0 ? (
        <div className="panel empty-panel">
          <p>No TVs yet. Install the ReelForge app on a Roku (see the Roku guide in the release notes) and open it once.</p>
        </div>
      ) : (
        <div className="agent-list">
          {d.Tvs.map((t) => (
            <TvCard key={t.Id} t={t} version={d.ServerVersion} onUpdate={() => updateNow(t)} onRemove={() => setRemoving(t)} onSaved={data.reload} />
          ))}
        </div>
      )}

      {removing && (
        <Confirm
          title={`Remove ${removing.Name}?`}
          confirm="Remove"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api.mm.removeTv(removing.Id).catch(() => undefined);
            toast(`${removing.Name} removed. It comes back if ReelForge opens on it again.`);
            setRemoving(null);
            data.reload();
          }}
        >
          This forgets the TV and its saved password. The app stays on the TV.
        </Confirm>
      )}
    </>
  );
}

function TvCard({ t, version, onUpdate, onRemove, onSaved }: { t: TvInfo; version: string; onUpdate: () => void; onRemove: () => void; onSaved: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const state = t.Updating ? 'busy' : !t.UpToDate ? 'nogpu' : 'ready';
  const label = t.Updating ? (t.Status ?? 'Updating…') : t.UpToDate ? 'Up to date' : `Has ${t.AppVersion ? `v${t.AppVersion}` : 'an older version'}, ${version} is out`;

  const save = async (pw: string) => {
    setSaving(true);
    setProblem(null);
    try {
      const r = await api.mm.setTvPassword(t.Id, pw);
      toast(r?.Message ?? 'Saved');
      setEditing(false);
      setPassword('');
      onSaved();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`agent-card ${state}`}>
      <header className="agent-head">
        <span className="agent-icon" aria-hidden="true"><Icon.tv /></span>
        <div className="agent-title">
          <strong>{t.Name}</strong>
          <span className={`agent-state ${state}`}><span className={`status-dot ${state === 'ready' ? 'ok' : state === 'nogpu' ? 'warn' : ''}`} />{label}</span>
        </div>
        <div className="agent-actions">
          {t.AutoUpdate && !t.UpToDate && !t.Updating && <button className="btn sm" onClick={onUpdate}>Update now</button>}
          <button className="btn sm ghost" onClick={onRemove}>Remove</button>
        </div>
      </header>

      <dl className="agent-facts">
        <div>
          <dt>Model</dt>
          <dd>{t.Model ?? '—'}{t.Ip ? <span className="hint"> · {t.Ip}</span> : null}</dd>
        </div>
        <div>
          <dt>App</dt>
          <dd>{t.AppVersion ? `v${t.AppVersion}` : '—'}</dd>
        </div>
        <div>
          <dt>Last opened</dt>
          <dd>{timeAgo(t.LastSeenUtc)}{t.UserName ? <span className="hint"> · {t.UserName}</span> : null}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd>{t.AutoUpdate ? <span className="chip-tag ember">Automatic</span> : <span className="hint">By hand (no password saved)</span>}</dd>
        </div>
      </dl>
      {t.Status && !t.Updating && <p className={`hint${t.StatusIsError ? ' agent-error' : ''}`}>{t.Status} · {timeAgo(t.StatusUtc)}</p>}

      {editing ? (
        <form
          className="tv-password"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void save(password);
          }}
        >
          <label>
            <span>Developer password for {t.Name}</span>
            <input className="input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <div className="tv-password-actions">
            <button className="btn primary sm" type="submit" disabled={!password || saving}>{saving ? 'Checking with the TV…' : 'Save'}</button>
            <button className="btn sm ghost" type="button" onClick={() => { setEditing(false); setProblem(null); }}>Cancel</button>
          </div>
          {problem && <p className="hint agent-error">{problem}</p>}
        </form>
      ) : (
        <div className="agent-settings">
          <button className="btn sm" onClick={() => setEditing(true)}>{t.AutoUpdate ? 'Change password' : 'Turn on automatic updates'}</button>
          {t.AutoUpdate && <button className="btn sm ghost" onClick={() => void save('')}>Turn off</button>}
        </div>
      )}
    </article>
  );
}
