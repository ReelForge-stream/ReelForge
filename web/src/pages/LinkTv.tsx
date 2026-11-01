import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { defaultServer, userImage } from '../lib/api';
import type { User } from '../lib/types';
import { Avatar, Icon, useApi } from '../lib/ui';

/**
 * "Sign in a TV": opened by scanning the QR code on a TV's sign-in screen (/link?code=123456),
 * or from the profile menu to type the code. Approving signs the TV in as you; admins can pick
 * another profile, e.g. to set up the kids' TV.
 */
export default function LinkTv() {
  const api = useApi();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const code = (params.get('code') ?? '').replace(/\D/g, '').slice(0, 6);
  const [typed, setTyped] = useState('');
  const [profiles, setProfiles] = useState<User[]>([]);
  const [who, setWho] = useState(api.userId);
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'expired' | 'error'>('ask');
  const [error, setError] = useState('');
  const server = api.session.server || defaultServer();
  const me = api.session.user;

  useEffect(() => {
    if (!api.isAdmin) return;
    api.users().then((u) => setProfiles(u.filter((x) => !x.Policy?.IsDisabled))).catch(() => setProfiles([]));
  }, [api]);

  useEffect(() => {
    setState('ask');
    setError('');
  }, [code]);

  const chosen = profiles.find((p) => p.Id === who) ?? me;

  const approve = async () => {
    setState('busy');
    try {
      await api.approveTv(code, who);
      setState('done');
    } catch (e) {
      if ((e as { status?: number }).status === 404) setState('expired');
      else {
        setError((e as Error).message);
        setState('error');
      }
    }
  };

  if (!code) {
    const ok = /^\d{6}$/.test(typed);
    return (
      <div className="page link-tv">
        <div className="link-card">
          <span className="link-icon" aria-hidden="true"><Icon.tv /></span>
          <h1>Sign in a TV</h1>
          <p className="muted">On the TV, open ReelForge. Its sign-in screen shows a QR code to scan with your phone's camera, and a 6-digit code you can type here instead.</p>
          <form
            className="link-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (ok) setParams({ code: typed });
            }}
          >
            <input
              className="input link-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              aria-label="Code shown on the TV"
              value={typed}
              maxLength={7}
              onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
            />
            <button className="btn primary" disabled={!ok}>Continue</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page link-tv">
      <div className="link-card" aria-live="polite">
        <span className={`link-icon${state === 'done' ? ' ok' : ''}`} aria-hidden="true">{state === 'done' ? <Icon.check /> : <Icon.tv />}</span>
        {state === 'done' ? (
          <>
            <h1>Your TV is signed in</h1>
            <p className="muted">It's signed in as <strong>{chosen.Name}</strong> and opens their home screen in a moment. You can put your phone away.</p>
            <button className="btn" onClick={() => nav('/')}>Done</button>
          </>
        ) : state === 'expired' ? (
          <>
            <h1>That code has expired</h1>
            <p className="muted">Codes last a few minutes and work once. The TV shows a new one by itself; scan the new QR code, or type the new code.</p>
            <button className="btn" onClick={() => setParams({})}>Type a code</button>
          </>
        ) : (
          <>
            <h1>Sign in this TV?</h1>
            <p className="link-code" aria-label={`Code ${code.split('').join(' ')}`}>{code.slice(0, 3)} {code.slice(3)}</p>
            <p className="muted">Check it matches the code on the TV, so you know you're signing in the right one.</p>

            {api.isAdmin && profiles.length > 1 ? (
              <div className="link-who" role="radiogroup" aria-label="Sign the TV in as">
                <span className="link-who-label">Sign it in as</span>
                <div className="link-who-list">
                  {profiles.map((p) => (
                    <button key={p.Id} role="radio" aria-checked={who === p.Id} className={`link-who-item${who === p.Id ? ' on' : ''}`} onClick={() => setWho(p.Id)}>
                      <Avatar user={p} url={userImage(server, p, 96)} size={44} />
                      <span>{p.Name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="link-as">
                <Avatar user={me} url={userImage(server, me, 64)} size={32} /> Signs in as <strong>{me.Name}</strong>
              </p>
            )}

            {state === 'error' && <p className="warn-text">Couldn't sign the TV in: {error}</p>}
            <div className="link-actions">
              <button className="btn primary" onClick={approve} disabled={state === 'busy'}>{state === 'busy' ? 'Signing in…' : `Sign in as ${chosen.Name}`}</button>
              <button className="btn ghost" onClick={() => nav('/')}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
