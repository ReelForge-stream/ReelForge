import { useState } from 'react';
import { useApi, useAsync, usePoll, useToast } from '../lib/ui';
import { Confirm, SaveBar, Section, useDraft } from './common';

type Config = Record<string, unknown> & { ServerName: string; PreferredMetadataLanguage: string; MetadataCountryCode: string };

export default function General() {
  const api = useApi();
  const toast = useToast();
  const info = useAsync(() => api.admin.info(), []);
  const plugins = useAsync(() => api.admin.plugins().catch(() => []), []);
  const config = useAsync(() => api.admin.config() as Promise<Config>, []);
  const countries = useAsync(() => api.admin.countries(), []);
  const cultures = useAsync(() => api.admin.cultures(), []);
  const tasks = useAsync(() => api.admin.tasks(), []);
  const d = useDraft<Config>(config.data, (c) => api.admin.saveConfig(c));
  const [restart, setRestart] = useState(false);
  const [checking, setChecking] = useState(false);

  const updTask = tasks.data?.find((t) => t.Key === 'PluginUpdates');
  usePoll(() => api.admin.tasks().then(tasks.setData).catch(() => undefined), 2000, updTask?.State === 'Running' || checking);
  usePoll(() => api.admin.info().then(info.setData).catch(() => undefined), 5000, !!info.data);

  const version = plugins.data?.find((p) => p.Name === 'ReelForge')?.Version?.replace(/\.0$/, '');
  const languages = (cultures.data ?? []).filter((c) => c.TwoLetterISOLanguageName).sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));
  const countryList = (countries.data ?? []).slice().sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));

  const checkUpdates = async () => {
    if (!updTask) return;
    setChecking(true);
    try {
      await api.admin.runTask(updTask.Id);
      toast('Checking for ReelForge updates…');
      setTimeout(() => setChecking(false), 8000);
    } catch (e) {
      toast((e as Error).message);
      setChecking(false);
    }
  };

  if (config.error) return <div className="err-box">Couldn’t load settings: {config.error}</div>;
  const c = d.draft;

  return (
    <div className="set-stack">
      {info.data?.HasPendingRestart && (
        <div className="set-banner">
          <span>An update or a change is waiting for the server to restart.</span>
          <button className="btn primary sm" onClick={() => setRestart(true)}>Restart now</button>
        </div>
      )}

      <Section title="This server">
        {!c ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="settings-grid">
            <div className="field">
              <label htmlFor="sname">Server name</label>
              <input id="sname" className="input" value={c.ServerName} placeholder={info.data?.ServerName} onChange={(e) => d.set('ServerName', e.target.value)} />
              <span className="hint">Shown on TVs and phones when they look for servers on your network.</span>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="lang">Language for titles and descriptions</label>
                <select id="lang" className="select" value={c.PreferredMetadataLanguage} onChange={(e) => d.set('PreferredMetadataLanguage', e.target.value)}>
                  {languages.map((l) => <option key={l.TwoLetterISOLanguageName} value={l.TwoLetterISOLanguageName}>{l.DisplayName}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="country">Country (for ratings and release dates)</label>
                <select id="country" className="select" value={c.MetadataCountryCode} onChange={(e) => d.set('MetadataCountryCode', e.target.value)}>
                  {countryList.map((x) => <option key={x.TwoLetterISORegionName} value={x.TwoLetterISORegionName}>{x.DisplayName}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="ReelForge" desc="ReelForge checks GitHub for updates every day and installs them by itself; the server restarts to finish.">
        <dl className="kv">
          <div><dt>Version</dt><dd>{version ?? '…'}</dd></div>
          <div><dt>Server engine</dt><dd>{info.data?.Version ?? '…'}</dd></div>
          <div><dt>Address on your network</dt><dd>{info.data?.LocalAddress ? <code>{info.data.LocalAddress}</code> : '…'}</dd></div>
          {updTask?.LastExecutionResult && <div><dt>Last update check</dt><dd>{new Date(updTask.LastExecutionResult.EndTimeUtc).toLocaleString()}</dd></div>}
        </dl>
        <div className="row-actions">
          <button className="btn" onClick={checkUpdates} disabled={!updTask || checking || updTask.State === 'Running'}>
            {checking || updTask?.State === 'Running' ? 'Checking…' : 'Check for updates now'}
          </button>
          <button className="btn ghost" onClick={() => setRestart(true)} disabled={info.data?.CanSelfRestart === false}>Restart server</button>
        </div>
      </Section>

      <p className="hint advanced-link">
        Need a setting that isn’t here? <a href="/web/#/dashboard">Open advanced server settings</a>.
      </p>

      <SaveBar dirty={d.dirty} busy={d.busy} onSave={d.save} onReset={d.reset} />

      {restart && (
        <Confirm
          title="Restart the server?"
          body="Anyone watching will be interrupted for about a minute while ReelForge restarts. Conversions in progress pick up again afterwards."
          action="Restart"
          onCancel={() => setRestart(false)}
          onConfirm={async () => {
            try {
              await api.admin.restart();
              toast('Restarting… this page reconnects by itself.');
            } catch (e) {
              toast((e as Error).message);
            }
            setRestart(false);
          }}
        />
      )}
    </div>
  );
}
