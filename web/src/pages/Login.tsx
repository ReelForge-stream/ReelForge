import { useState, type FormEvent } from 'react';
import { defaultServer, login } from '../lib/api';
import type { Session } from '../lib/types';
import { Logo } from '../lib/ui';

export default function Login({ onSignedIn, onBack }: { onSignedIn: (s: Session) => void; onBack?: () => void }) {
  const [server, setServer] = useState(defaultServer());
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sameOrigin = server === location.origin;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await login(server.replace(/\/+$/, ''), user.trim(), pw));
    } catch (err) {
      setError(err instanceof TypeError ? 'Can’t reach that server. Check the address and that it’s running.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="wordmark"><Logo />ReelForge</div>
        <p className="muted">Sign in with your media server account.</p>
        {!sameOrigin && (
          <div className="field">
            <label htmlFor="server">Server address</label>
            <input id="server" className="input" value={server} onChange={(e) => setServer(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="user">Username</label>
          <input id="user" className="input" autoComplete="username" autoFocus value={user} onChange={(e) => setUser(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary lg" disabled={busy || !user}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {onBack && <button type="button" className="btn ghost" onClick={onBack}>Back to profiles</button>}
      </form>
    </div>
  );
}
