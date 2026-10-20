import { useEffect, useRef, useState, type FormEvent } from 'react';
import { defaultServer, login, publicUsers, userImage } from '../lib/api';
import type { Session, User } from '../lib/types';
import { Avatar, Icon, Logo } from '../lib/ui';

/** Figma: "Who's watching?" page (85:1927) with LargeAvatar tiles (90:2726 / 90:2945). */
export default function Profiles({ onSignedIn, onManual }: { onSignedIn: (s: Session) => void; onManual: () => void }) {
  const server = defaultServer();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<User | null>(null);

  useEffect(() => {
    publicUsers(server)
      .then((u) => {
        setUsers(u);
        // Switching from the profile menu lands straight on that profile.
        let want: string | null = null;
        try {
          want = sessionStorage.getItem('reelforge.switchTo');
          sessionStorage.removeItem('reelforge.switchTo');
        } catch {
          /* ignore */
        }
        const target = u.find((x) => x.Id === want);
        if (target) choose(target);
      })
      .catch(() => {
        setUsers([]);
        setError('Can’t reach the server to list profiles.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(u: User) {
    setError(null);
    if (u.HasPassword) {
      setPick(u);
      return;
    }
    try {
      onSignedIn(await login(server, u.Name, ''));
    } catch {
      setPick(u); // the server says a password is needed after all
    }
  }

  // Every profile is hidden from the sign-in screen: go straight to the username/password form.
  const noneListed = !!users && users.length === 0 && !error;
  useEffect(() => {
    if (noneListed) onManual();
  }, [noneListed, onManual]);
  if (noneListed) return null;

  return (
    <div className="profiles-page">
      <div className="profiles-top">
        <span className="topbar-brand">
          <Logo />
          <span>ReelForge</span>
        </span>
      </div>
      {pick ? (
        <PasswordPrompt user={pick} server={server} onBack={() => setPick(null)} onSignedIn={onSignedIn} />
      ) : (
        <div className="profiles">
          <h1>Who’s watching?</h1>
          <div className="profile-grid" role="list">
            {(users ?? []).map((u) => (
              <button key={u.Id} role="listitem" className="profile-tile" onClick={() => choose(u)}>
                <span className="profile-pic">
                  <Avatar user={u} url={userImage(server, u, 288)} size={144} />
                </span>
                <span className="profile-name">{u.Name}</span>
              </button>
            ))}
            <a className="profile-tile" href="/web/#/dashboard/users/add" role="listitem">
              <span className="profile-pic add" aria-hidden="true">
                <span className="add-circle"><Icon.plus /></span>
              </span>
              <span className="profile-name">Add Profile</span>
            </a>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="profiles-actions">
            <a className="btn-outline" href="/web/#/dashboard/users">Manage Profiles</a>
            <button className="link-btn" onClick={onManual}>Sign in another way</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PasswordPrompt({ user, server, onBack, onSignedIn }: { user: User; server: string; onBack: () => void; onSignedIn: (s: Session) => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await login(server, user.Name, pw));
    } catch {
      setError('That password isn’t right. Try again.');
      setBusy(false);
      setPw('');
      input.current?.focus();
    }
  }

  return (
    <form className="profiles pw-prompt" onSubmit={submit}>
      <span className="profile-pic big">
        <Avatar user={user} url={userImage(server, user, 288)} size={144} />
      </span>
      <h2>Enter the password for {user.Name}</h2>
      <input ref={input} className="input" type="password" autoComplete="current-password" aria-label={`Password for ${user.Name}`} value={pw} onChange={(e) => setPw(e.target.value)} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="profiles-actions">
        <button className="btn primary lg" disabled={busy || !pw}>{busy ? 'Signing in…' : 'Continue'}</button>
        <button type="button" className="btn ghost lg" onClick={onBack}>Back</button>
      </div>
    </form>
  );
}
