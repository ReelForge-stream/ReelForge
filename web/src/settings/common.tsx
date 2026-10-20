import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from '../lib/ui';

/** On/off row: label and explanation on the left, a switch on the right. */
export function Toggle({ id, label, desc, checked, onChange, disabled }: { id: string; label: string; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="setting">
      <label htmlFor={id}>
        <div>{label}</div>
        {desc && <div className="desc">{desc}</div>}
      </label>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

export function Section({ title, desc, children, aside }: { title: string; desc?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <div>
          <h2>{title}</h2>
          {desc && <p className="muted small measure">{desc}</p>}
        </div>
        {aside}
      </div>
      <div className="set-section-body">{children}</div>
    </section>
  );
}

/**
 * Edit a copy of a settings object and save it back whole (the server replaces the full object).
 * Returns the draft, a setter for one key, whether anything changed, and save/reset.
 */
export function useDraft<T extends Record<string, unknown>>(loaded: T | undefined, saveFn: (v: T) => Promise<unknown>, okMessage = 'Settings saved') {
  const toast = useToast();
  const [draft, setDraft] = useState<T | undefined>(loaded);
  const [base, setBase] = useState<T | undefined>(loaded);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (loaded) {
      setDraft(loaded);
      setBase(loaded);
    }
  }, [loaded]);
  const set = <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(base);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await saveFn(draft);
      setBase(draft);
      toast(okMessage);
    } catch (e) {
      toast(`Couldn’t save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return { draft, set, dirty, busy, save, reset: () => setDraft(base) };
}

/** Sticky bar that appears while there are unsaved changes. */
export function SaveBar({ dirty, busy, onSave, onReset, note }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void; note?: string }) {
  if (!dirty) return null;
  return (
    <div className="save-bar" role="region" aria-label="Unsaved changes">
      <span>{note ?? 'You have unsaved changes.'}</span>
      <button className="btn ghost sm" onClick={onReset} disabled={busy}>Undo</button>
      <button className="btn primary sm" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
    </div>
  );
}

/** Small confirm dialog. */
export function Confirm({ title, body, action, danger, onConfirm, onCancel }: { title: string; body: ReactNode; action: string; danger?: boolean; onConfirm: () => void | Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="dialog-back" onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="muted">{body}</div>
        <div className="actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Working…' : action}
          </button>
        </div>
      </div>
    </div>
  );
}

export function timeAgo(iso?: string): string {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
