import { Link } from 'react-router-dom';
import { Icon, useApi, useAsync } from '../lib/ui';

/**
 * "Get the TV app": download link for the ReelForge Roku app that matches this server, and step-by-step
 * install instructions (Roku only allows store apps, plus one app installed in developer mode per TV).
 */
export default function TvApp() {
  const api = useApi();
  const app = useAsync(() => api.tvApp(), []);
  const v = app.data?.Version;
  const releases = 'https://github.com/ReelForge-stream/ReelForge/releases/latest';

  return (
    <div className="page tv-app">
      <div className="page-head">
        <h1>Get the TV app</h1>
      </div>

      <section className="tv-app-hero">
        <span className="link-icon" aria-hidden="true"><Icon.tv /></span>
        <div>
          <h2>ReelForge for Roku</h2>
          <p className="muted">
            For Roku TVs (TCL, Hisense, onn and others) and Roku streaming sticks. It's the full ReelForge: your libraries, My List, the
            billboard, and sign-in with a QR code.
          </p>
          <div className="tv-app-actions">
            {app.data ? (
              <a className="btn primary" href={app.data.RokuDownloadUrl} download>
                <Icon.download /> Download ReelForge for Roku{v ? ` (${v})` : ''}
              </a>
            ) : (
              <a className="btn primary" href={releases} target="_blank" rel="noreferrer">
                <Icon.download /> Download ReelForge for Roku
              </a>
            )}
            {app.data && (
              <a className="btn ghost" href={app.data.ReleaseUrl} target="_blank" rel="noreferrer">
                Release notes
              </a>
            )}
          </div>
          <p className="hint">
            Download it on a computer on the same Wi-Fi or network as the TV. It's a .zip file: <strong>don't unzip it</strong>.
            {app.data && <> If the download says the file isn't there, use the <a href={releases} target="_blank" rel="noreferrer">latest release</a> instead.</>}
          </p>
        </div>
      </section>

      <section className="panel tv-app-why">
        <h3>Why it isn't in the Roku Channel Store</h3>
        <p className="muted">
          ReelForge runs on your own server, so it's installed straight onto the TV instead. Roku allows one app installed this way on each TV, and it
          stays installed, also after restarts. It takes about 5 minutes per TV, once.
        </p>
      </section>

      <ol className="tv-steps">
        <li>
          <h3>Turn on developer mode on the TV</h3>
          <p>With the TV's Roku remote, press these buttons in a row, one at a time:</p>
          <p className="tv-keys" aria-label="Home three times, Up twice, Right, Left, Right, Left, Right">
            <kbd>Home</kbd><kbd>Home</kbd><kbd>Home</kbd><kbd>↑</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>←</kbd><kbd>→</kbd><kbd>←</kbd><kbd>→</kbd>
          </p>
          <ul>
            <li>A <strong>Developer Settings</strong> screen opens. Write down the address it shows, for example <code>http://192.168.1.57</code>.</li>
            <li>Choose <strong>Enable installer and restart</strong>, then accept the agreement.</li>
            <li>Make up a <strong>password</strong> and write it down. The username is always <code>rokudev</code>.</li>
            <li>The TV restarts.</li>
          </ul>
          <p className="hint">Nothing happens? Make sure you're on the TV's home screen first, and press the buttons a little slower.</p>
        </li>
        <li>
          <h3>Open the TV's installer page</h3>
          <p>
            On the computer with the download, open a web browser and type the address from step 1 (for example <code>http://192.168.1.57</code>)
            into the address bar. Sign in with the username <code>rokudev</code> and your password.
          </p>
          <p className="hint">Type <code>http://</code>, not https. If the page doesn't open, check that the computer and the TV are on the same network.</p>
        </li>
        <li>
          <h3>Install ReelForge</h3>
          <p>
            Click <strong>Upload</strong>, pick the <code>ReelForge-Roku…zip</code> file you downloaded, then click <strong>Install with zip</strong>.
            After a few seconds ReelForge opens on the TV. From now on it's in the TV's list of apps, like any other.
          </p>
          <p className="hint">"Install failed"? Make sure you picked the .zip as downloaded, not an unzipped folder.</p>
        </li>
        <li>
          <h3>Sign in</h3>
          <p>
            The app finds this server on your home network by itself; if it asks, type the server's address. Then scan the <strong>QR code</strong>{' '}
            on the TV with your phone's camera and tap <strong>Sign in</strong>. No typing with the remote. You can also{' '}
            <Link to="/link">type the TV's 6-digit code here</Link>.
          </p>
        </li>
      </ol>

      <section className="panel">
        <h3>Updates</h3>
        {api.isAdmin ? (
          <p className="muted">
            In <Link to="/manager/tvs">Media Manager › TVs</Link>, turn on automatic updates for each TV with its developer password from step 1. The
            server then installs every new version of the app on that TV by itself. Without it, repeat steps 2 and 3 with the new download.
          </p>
        ) : (
          <p className="muted">
            Whoever runs this server can switch on automatic updates for your TV, so new versions install by themselves. Otherwise, repeat steps 2 and
            3 with the new download.
          </p>
        )}
        <p className="hint">Several TVs? Do the steps on each one. Each TV needs developer mode turned on once.</p>
      </section>
    </div>
  );
}
