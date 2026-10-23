import { useState } from 'react';
import type { VirtualFolder } from '../lib/types';
import { Icon, useApi, useAsync, usePoll, useToast } from '../lib/ui';
import { PathAdder } from '../pages/Setup';
import { Confirm, Section, timeAgo } from './common';

const KINDS: { kind: string; label: string; example: string }[] = [
  { kind: 'movies', label: 'Movies', example: '\\\\10.0.0.201\\plexdata\\Movies' },
  { kind: 'tvshows', label: 'TV Shows', example: '\\\\10.0.0.201\\plexdata\\TV' },
  { kind: 'homevideos', label: 'Home videos & photos', example: 'D:\\Videos' },
  { kind: 'music', label: 'Music', example: '\\\\10.0.0.201\\plexdata\\Music' },
  { kind: 'mixed', label: 'Mixed movies and shows', example: 'D:\\Media' },
];
const kindLabel = (k?: string) => KINDS.find((x) => x.kind === k)?.label ?? 'Other';

export default function Libraries() {
  const api = useApi();
  const toast = useToast();
  const libs = useAsync(() => api.admin.libraries(), []);
  const tasks = useAsync(() => api.admin.tasks(), []);
  const [adding, setAdding] = useState(false);
  const schedule = useAsync(() => api.mm.libraryScan().catch(() => null), []);
  const setEvery = async (m: number) => {
    try {
      await api.mm.setLibraryScan(m);
      schedule.setData({ ...(schedule.data ?? { Running: false }), Minutes: m });
      toast(m ? `Libraries will be checked every ${m < 60 ? `${m} minutes` : m === 60 ? 'hour' : `${m / 60} hours`}` : 'Automatic checks turned down to twice a day');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const scan = tasks.data?.find((t) => t.Key === 'RefreshLibrary');
  const scanning = scan?.State === 'Running' || (libs.data ?? []).some((l) => l.RefreshStatus === 'Active');
  usePoll(
    () => {
      api.admin.tasks().then(tasks.setData).catch(() => undefined);
      api.admin.libraries().then(libs.setData).catch(() => undefined);
    },
    2000,
    scanning,
  );

  const scanAll = async () => {
    try {
      await api.admin.scanAll();
      toast('Scanning all libraries for new and changed files');
      setTimeout(() => tasks.reload(), 800);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (libs.error) return <div className="err-box">Couldn’t load libraries: {libs.error}</div>;

  return (
    <div className="set-stack">
      <Section
        title="Libraries"
        desc="Each library is a set of folders ReelForge watches. It checks them for new, changed and removed files on a schedule; scan now if you don’t want to wait."
        aside={
          <div className="row-actions">
            <button className="btn" onClick={scanAll} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan now'}</button>
            <button className="btn primary" onClick={() => setAdding(true)}>Add library</button>
          </div>
        }
      >
        {scanning && (
          <div className="scan-progress" role="status">
            <span>Scanning{scan?.CurrentProgressPercentage ? ` · ${Math.round(scan.CurrentProgressPercentage)}%` : '…'}</span>
            <div className="bar"><span style={{ width: `${scan?.CurrentProgressPercentage ?? 3}%` }} /></div>
          </div>
        )}
        <div className="scan-schedule">
          <label htmlFor="scan-every">Check for changes</label>
          <select id="scan-every" className="select" value={schedule.data?.Minutes ?? 5} disabled={!schedule.data} onChange={(e) => setEvery(Number(e.target.value))}>
            {[5, 10, 15, 30, 60, 360].map((m) => (
              <option key={m} value={m}>Every {m < 60 ? `${m} minutes` : m === 60 ? 'hour' : `${m / 60} hours`}{m === 5 ? ' (recommended)' : ''}</option>
            ))}
            <option value={0}>Twice a day (Jellyfin default)</option>
          </select>
          {!scanning && scan?.LastExecutionResult && <span className="hint">Last checked {timeAgo(scan.LastExecutionResult.EndTimeUtc)}.</span>}
        </div>
        {adding && <NewLibrary onDone={() => { setAdding(false); libs.reload(); }} onCancel={() => setAdding(false)} />}
        {!libs.data ? <p className="muted">Loading…</p> : libs.data.length === 0 && !adding ? <p className="muted">No libraries yet. Add one to get started.</p> : null}
        <div className="lib-cards">
          {libs.data?.map((l) => <LibraryCard key={l.ItemId} lib={l} onChange={libs.reload} />)}
        </div>
      </Section>
    </div>
  );
}

function LibraryCard({ lib, onChange }: { lib: VirtualFolder; onChange: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(lib.Name);
  const [removing, setRemoving] = useState(false);
  const [dropPath, setDropPath] = useState<string | null>(null);
  const example = KINDS.find((k) => k.kind === lib.CollectionType)?.example ?? 'D:\\Media';

  const rename = async () => {
    const n = name.trim();
    if (!n || n === lib.Name) return setRenaming(false);
    try {
      await api.admin.renameLibrary(lib.Name, n);
      toast('Library renamed');
      setRenaming(false);
      onChange();
    } catch (e) {
      toast((e as { status?: number }).status === 409 ? `There’s already a library or folder called “${n}”. Pick another name.` : (e as Error).message);
    }
  };

  return (
    <article className="lib-card">
      <div className="lib-card-head">
        {renaming ? (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); rename(); }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Library name" autoFocus />
            <button className="btn primary sm">Save</button>
            <button type="button" className="btn ghost sm" onClick={() => { setName(lib.Name); setRenaming(false); }}>Cancel</button>
          </form>
        ) : (
          <div>
            <h3>{lib.Name}</h3>
            <p className="hint">{kindLabel(lib.CollectionType) !== lib.Name ? kindLabel(lib.CollectionType) : ''}{lib.RefreshStatus === 'Active' ? ` · scanning ${lib.RefreshProgress ? `${Math.round(lib.RefreshProgress)}%` : ''}` : ''}</p>
          </div>
        )}
        {!renaming && (
          <div className="row-actions">
            <button
              className="btn sm"
              onClick={async () => {
                await api.admin.refreshLibrary(lib.ItemId).catch((e) => toast((e as Error).message));
                toast(`Scanning ${lib.Name}`);
                setTimeout(onChange, 800);
              }}
            >
              Scan
            </button>
            <button className="btn ghost sm" onClick={() => setRenaming(true)}>Rename</button>
            <button className="btn danger sm" onClick={() => setRemoving(true)}>Remove</button>
          </div>
        )}
      </div>

      <ul className="lib-folders">
        {lib.Locations.map((p) => (
          <li key={p}>
            <Icon.folder />
            <code>{p}</code>
            <button className="btn ghost sm" onClick={() => setDropPath(p)} aria-label={`Stop watching ${p}`}>Remove</button>
          </li>
        ))}
      </ul>
      <PathAdder
        placeholder={example}
        label={`Add a folder to ${lib.Name}`}
        addLabel="Add folder"
        onAdd={async (p) => {
          if (lib.Locations.includes(p)) return;
          await api.admin.addFolder(lib.Name, p);
          toast('Folder added. Scanning it now.');
          onChange();
        }}
      />

      {removing && (
        <Confirm
          title={`Remove “${lib.Name}”?`}
          body="ReelForge stops showing this library and forgets watch history for it. Your files stay exactly where they are; nothing on your drives or NAS is deleted."
          action="Remove library"
          danger
          onCancel={() => setRemoving(false)}
          onConfirm={async () => {
            try {
              await api.admin.removeLibrary(lib.Name);
              toast('Library removed');
              onChange();
            } catch (e) {
              toast((e as Error).message);
            }
            setRemoving(false);
          }}
        />
      )}
      {dropPath && (
        <Confirm
          title="Stop watching this folder?"
          body={<>Titles from <code>{dropPath}</code> disappear from {lib.Name}. The files themselves aren’t touched.</>}
          action="Remove folder"
          danger
          onCancel={() => setDropPath(null)}
          onConfirm={async () => {
            try {
              await api.admin.removeFolder(lib.Name, dropPath);
              toast('Folder removed');
              onChange();
            } catch (e) {
              toast((e as Error).message);
            }
            setDropPath(null);
          }}
        />
      )}
    </article>
  );
}

function NewLibrary({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [kind, setKind] = useState('movies');
  const [name, setName] = useState('');
  const k = KINDS.find((x) => x.kind === kind)!;
  return (
    <article className="lib-card new">
      <h3>New library</h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="nl-kind">What’s in it</label>
          <select id="nl-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nl-name">Name</label>
          <input id="nl-name" className="input" placeholder={k.label} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>First folder</label>
        <PathAdder
          placeholder={k.example}
          label="First folder for the new library"
          addLabel="Create library"
          onAdd={async (p) => {
            await api.admin.addLibrary(name.trim() || k.label, kind, [p]);
            toast('Library created. Scanning it now; titles appear as they’re found.');
            onDone();
          }}
        />
        <span className="hint">You can add more folders to it afterwards.</span>
      </div>
      <div className="row-actions">
        <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
      </div>
    </article>
  );
}
