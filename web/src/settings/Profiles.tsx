import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { defaultServer, userImage } from '../lib/api';
import type { AdminUser, UserPolicy } from '../lib/types';
import { Avatar, Icon, useApi, useAsync, useToast } from '../lib/ui';
import { Confirm, SaveBar, Section, Toggle, timeAgo } from './common';

export default function Profiles() {
  const api = useApi();
  const users = useAsync(() => api.admin.users(), []);
  const libs = useAsync(() => api.admin.libraries(), []);
  const ratings = useAsync(() => api.admin.ratings().catch(() => []), []);
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const adding = params.has('add');

  if (users.error) return <div className="err-box">Couldn’t load profiles: {users.error}</div>;
  const list = (users.data ?? []).slice().sort((a, b) => Number(b.Policy.IsAdministrator) - Number(a.Policy.IsAdministrator) || a.Name.localeCompare(b.Name));

  return (
    <div className="set-stack">
      <Section
        title="Profiles"
        desc="Everyone in the house gets their own profile with their own watch history, My List and limits. Profiles marked “Shown” appear on the Who’s watching? screen."
        aside={!adding && <button className="btn primary" onClick={() => setParams({ add: '1' })}>Add profile</button>}
      >
        {adding && (
          <NewProfile
            onDone={(id) => {
              setParams({});
              users.reload();
              if (id) setOpen(id);
            }}
          />
        )}
        {!users.data && <p className="muted">Loading…</p>}
        <ul className="user-list">
          {list.map((u) => (
            <li key={u.Id}>
              <button className={`user-row${open === u.Id ? ' open' : ''}`} onClick={() => setOpen(open === u.Id ? null : u.Id)} aria-expanded={open === u.Id}>
                <Avatar user={u} url={userImage(api.session.server || defaultServer(), u, 96)} size={44} />
                <span className="user-main">
                  <strong>{u.Name}{u.Id === api.userId && <span className="muted"> (you)</span>}</strong>
                  <span className="hint">Last watched {timeAgo(u.LastActivityDate)}</span>
                </span>
                <span className="chips">
                  {u.Policy.IsAdministrator && <span className="chip-tag ember">Admin</span>}
                  {u.Policy.IsDisabled && <span className="chip-tag danger">Can’t sign in</span>}
                  <span className="chip-tag">{u.Policy.IsHidden ? 'Hidden' : 'Shown'}</span>
                  <span className="chip-tag">{u.HasPassword ? 'Password' : 'No password'}</span>
                </span>
                <span className={`user-chev${open === u.Id ? ' up' : ''}`} aria-hidden="true"><Icon.chevronDown /></span>
              </button>
              {open === u.Id && (
                <ProfileEditor
                  key={u.Id}
                  user={u}
                  isMe={u.Id === api.userId}
                  libraries={(libs.data ?? []).map((l) => ({ id: l.ItemId, name: l.Name }))}
                  ratings={ratings.data ?? []}
                  onChange={users.reload}
                  onDeleted={() => {
                    setOpen(null);
                    users.reload();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function NewProfile({ onDone }: { onDone: (id?: string) => void }) {
  const api = useApi();
  const toast = useToast();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api.admin.newUser(name.trim(), pw);
      // New profiles show on "Who's watching?" (the server hides them by default).
      if (u?.Policy) await api.admin.setPolicy(u.Id, { ...u.Policy, IsHidden: false });
      toast(`${name.trim()} added`);
      onDone(u?.Id);
    } catch (x) {
      toast(`Couldn’t add the profile: ${(x as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <form className="lib-card new" onSubmit={create}>
      <h3>New profile</h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="np-name">Name</label>
          <input ref={input} id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </div>
        <div className="field">
          <label htmlFor="np-pw">Password (optional)</label>
          <input id="np-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
      </div>
      <p className="hint">Without a password, anyone at home can pick this profile. Kids’ profiles usually don’t need one; set a maturity limit instead.</p>
      <div className="row-actions">
        <button type="button" className="btn ghost sm" onClick={() => onDone()}>Cancel</button>
        <button className="btn primary sm" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add profile'}</button>
      </div>
    </form>
  );
}

type Rating = { Name: string; Value?: number; RatingScore?: { score: number; subScore?: number } };

function ProfileEditor({ user, isMe, libraries, ratings, onChange, onDeleted }: { user: AdminUser; isMe: boolean; libraries: { id: string; name: string }[]; ratings: Rating[]; onChange: () => void; onDeleted: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [policy, setPolicy] = useState<UserPolicy>(user.Policy);
  const [name, setName] = useState(user.Name);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  // One option per maturity level, labelled with the ratings that share it ("PG-13, TV-14").
  const levels = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const r of ratings) {
      const score = r.RatingScore?.score ?? r.Value;
      if (score == null) continue;
      m.set(score, [...(m.get(score) ?? []), r.Name]);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([score, names]) => ({ score, label: names.slice(0, 4).join(', ') }));
  }, [ratings]);

  // After a save the list reloads; take the server's copy as the new starting point.
  useEffect(() => setPolicy(user.Policy), [user.Policy]);
  const policyDirty = JSON.stringify(policy) !== JSON.stringify(user.Policy);
  const set = <K extends keyof UserPolicy>(k: K, v: UserPolicy[K]) => setPolicy((p) => ({ ...p, [k]: v }));

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      onChange();
    } catch (e) {
      toast(`Couldn’t save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const folderOn = (id: string) => policy.EnableAllFolders || policy.EnabledFolders.includes(id);
  const toggleFolder = (id: string, on: boolean) => {
    const current = policy.EnableAllFolders ? libraries.map((l) => l.id) : policy.EnabledFolders;
    const nextList = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    setPolicy((p) => ({ ...p, EnableAllFolders: nextList.length === libraries.length, EnabledFolders: nextList.length === libraries.length ? [] : nextList }));
  };

  return (
    <div className="user-editor">
      <div className="ue-grid">
        <div className="ue-col">
          <h4>Name and picture</h4>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(() => api.admin.renameUser(user, name.trim()), 'Name saved'); }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Profile name" maxLength={40} />
            <button className="btn sm" disabled={busy || !name.trim() || name.trim() === user.Name}>Rename</button>
          </form>
          <div className="row-actions">
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) run(() => api.admin.setUserImage(user.Id, f), 'Picture updated');
                e.target.value = '';
              }}
            />
            <button className="btn sm" onClick={() => file.current?.click()} disabled={busy}>Upload picture</button>
            {user.PrimaryImageTag && <button className="btn ghost sm" onClick={() => run(() => api.admin.removeUserImage(user.Id), 'Picture removed')} disabled={busy}>Remove picture</button>}
          </div>

          <h4>Password</h4>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.admin.setPassword(user.Id, pw); setPw(''); }, 'Password saved'); }}>
            <input className="input" type="password" autoComplete="new-password" placeholder={user.HasPassword ? 'New password' : 'Set a password'} value={pw} onChange={(e) => setPw(e.target.value)} aria-label="New password" />
            <button className="btn sm" disabled={busy || !pw}>Save</button>
          </form>
          {user.HasPassword && !isMe && (
            <button className="btn ghost sm" onClick={() => run(() => api.admin.setPassword(user.Id, ''), 'Password removed')} disabled={busy}>Remove password</button>
          )}
        </div>

        <div className="ue-col">
          <h4>Access</h4>
          <Toggle id={`hid-${user.Id}`} label="Show on Who’s watching?" desc="Off: they sign in by typing their name instead." checked={!policy.IsHidden} onChange={(v) => set('IsHidden', !v)} />
          <Toggle id={`adm-${user.Id}`} label="Administrator" desc="Can change server settings, profiles and libraries, and use the Media Manager." checked={policy.IsAdministrator} onChange={(v) => set('IsAdministrator', v)} disabled={isMe} />
          <Toggle id={`rem-${user.Id}`} label="Can watch away from home" desc="Allows streaming over the internet, not just on your network." checked={policy.EnableRemoteAccess} onChange={(v) => set('EnableRemoteAccess', v)} />
          <Toggle id={`dis-${user.Id}`} label="Block sign-in" desc="Keeps the profile and its history but stops it being used." checked={policy.IsDisabled} onChange={(v) => set('IsDisabled', v)} disabled={isMe} />

          <h4>Maturity limit</h4>
          <select className="select" aria-label="Maturity limit" value={policy.MaxParentalRating ?? ''} onChange={(e) => set('MaxParentalRating', e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">No limit</option>
            {levels.map((l) => <option key={l.score} value={l.score}>Up to {l.label}</option>)}
          </select>
          <label className="check-row">
            <input type="checkbox" className="check" checked={(policy.BlockUnratedItems ?? []).includes('Movie')} onChange={(e) => set('BlockUnratedItems', e.target.checked ? ['Movie', 'Series', 'Trailer', 'Book', 'ChannelContent', 'LiveTvChannel', 'LiveTvProgram', 'Music', 'Other'] : [])} />
            Also hide titles with no rating
          </label>

          <h4>Libraries they can see</h4>
          <div className="check-list">
            {libraries.map((l) => (
              <label key={l.id} className="check-row">
                <input type="checkbox" className="check" checked={folderOn(l.id)} onChange={(e) => toggleFolder(l.id, e.target.checked)} />
                {l.name}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="ue-foot">
        {!isMe ? <button className="btn danger sm" onClick={() => setDeleting(true)}>Delete profile</button> : <span />}
        <SaveBar
          dirty={policyDirty}
          busy={busy}
          note={`Unsaved changes to ${user.Name}’s access.`}
          onReset={() => setPolicy(user.Policy)}
          onSave={() => run(() => api.admin.setPolicy(user.Id, policy), 'Access saved')}
        />
      </div>

      {deleting && (
        <Confirm
          title={`Delete ${user.Name}?`}
          body="Their watch history, My List and settings are deleted. Your media files aren’t affected."
          action="Delete profile"
          danger
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              await api.admin.deleteUser(user.Id);
              toast(`${user.Name} deleted`);
              onDeleted();
            } catch (e) {
              toast((e as Error).message);
            }
            setDeleting(false);
          }}
        />
      )}
    </div>
  );
}
