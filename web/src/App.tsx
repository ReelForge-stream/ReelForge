import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, type Location } from 'react-router-dom';
import { Api, defaultServer, isDemo, loadSession, publicUsers, saveSession, userImage } from './lib/api';
import type { Session, User } from './lib/types';
import { ApiContext, Avatar, Icon, Logo, ToastHost, useApi, useAsync, usePoll } from './lib/ui';
import Login from './pages/Login';
import Profiles from './pages/Profiles';
import Setup from './pages/Setup';
import { setup } from './lib/setup';
import Home from './pages/Home';
import Library from './pages/Library';
import MyList from './pages/MyList';
import Details from './pages/Details';
import { ItemMenuHost } from './lib/itemMenu';
import SearchBox from './lib/SearchBox';
import Search from './pages/Search';
import ManagerLayout from './manager/ManagerLayout';
import ManagerOverview from './manager/Overview';
import Duplicates from './manager/Duplicates';
import SpaceSaver from './manager/SpaceSaver';
import Queue from './manager/Queue';
import Holding from './manager/Holding';
import Saved from './manager/Saved';
import Agents from './manager/Agents';
import ManagerSettings from './manager/Settings';
import SettingsLayout from './settings/SettingsLayout';
import SettingsGeneral from './settings/General';
import SettingsLibraries from './settings/Libraries';
import SettingsProfiles from './settings/Profiles';
import SettingsPlayback from './settings/Playback';
import SettingsNetwork from './settings/Network';
import SettingsActivity, { WatchingBadge } from './settings/Activity';
import Downloads from './pages/Downloads';
import Person from './pages/Person';
import { DownloadWatcher, useCanDownload } from './lib/download';
import { InstallBanner, InstallMenuItem } from './lib/install';

// The player pulls in hls.js; load it only when someone presses Play.
const Player = lazy(() => import('./pages/Player'));

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  // null = still checking; false = this server hasn't been set up yet
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [manual, setManual] = useState(false); // "Sign in another way" (profiles hidden from the picker)

  useEffect(() => {
    if (isDemo) {
      setSetupDone(!new URLSearchParams(location.search).has('setup'));
      return;
    }
    setup.info().then((i) => setSetupDone(i.StartupWizardCompleted)).catch(() => setSetupDone(true));
  }, []);
  const api = useMemo(() => (session ? new Api(session) : null), [session]);

  const signIn = (s: Session) => {
    saveSession(s);
    setSession(s);
    setManual(false);
  };
  const signOut = (switchTo?: string) => {
    try {
      if (switchTo) sessionStorage.setItem('reelforge.switchTo', switchTo);
    } catch {
      /* ignore */
    }
    saveSession(null);
    setSession(null);
  };

  return (
    <BrowserRouter basename="/reelforge">
      <ToastHost>
        {setupDone === null ? (
          <div className="login" />
        ) : !setupDone ? (
          <Setup
            onDone={(s) => {
              setSetupDone(true);
              signIn(s);
              history.replaceState(null, '', '/reelforge/');
            }}
          />
        ) : !api ? (
          manual ? <Login onSignedIn={signIn} onBack={() => setManual(false)} /> : <Profiles onSignedIn={signIn} onManual={() => setManual(true)} />
        ) : (
          <ApiContext.Provider value={api}>
            <AppRoutes onSignOut={signOut} />
          </ApiContext.Provider>
        )}
      </ToastHost>
    </BrowserRouter>
  );
}

function AppRoutes({ onSignOut }: { onSignOut: (switchTo?: string) => void }) {
  const api = useApi();
  const location = useLocation();
  const background = (location.state as { background?: Location } | null)?.background;
  // Details always open as an overlay. Opened from a link, the page you came from stays behind it;
  // opened directly (a shared URL), Home sits behind it.
  const isItem = location.pathname.startsWith('/item/');
  const pageLocation = background ?? (isItem ? ({ ...location, pathname: '/' } as Location) : location);

  return (
    <ItemMenuHost>
      <Routes location={pageLocation}>
        <Route path="/play/:id" element={<Suspense fallback={<div className="player" />}><Player /></Suspense>} />
        <Route element={<Shell onSignOut={onSignOut} />}>
          <Route index element={<Home />} />
          <Route path="library/:id" element={<Library />} />
          <Route path="list" element={<MyList />} />
          <Route path="search" element={<Search />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="person/:id" element={<Person />} />
          {api.isAdmin && (
            <Route path="manager" element={<ManagerLayout />}>
              <Route index element={<ManagerOverview />} />
              <Route path="duplicates" element={<Duplicates />} />
              <Route path="space" element={<SpaceSaver />} />
              <Route path="queue" element={<Queue />} />
              <Route path="saved" element={<Saved />} />
              <Route path="agents" element={<Agents />} />
              <Route path="holding" element={<Holding />} />
              <Route path="settings" element={<ManagerSettings />} />
            </Route>
          )}
          {api.isAdmin && (
            <Route path="server" element={<SettingsLayout />}>
              <Route index element={<SettingsGeneral />} />
              <Route path="libraries" element={<SettingsLibraries />} />
              <Route path="profiles" element={<SettingsProfiles />} />
              <Route path="playback" element={<SettingsPlayback />} />
              <Route path="network" element={<SettingsNetwork />} />
              <Route path="activity" element={<SettingsActivity />} />
            </Route>
          )}
          <Route path="setup" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {isItem && (
        <Routes>
          <Route path="/item/:id" element={<Details hasBackground={!!background} />} />
        </Routes>
      )}
    </ItemMenuHost>
  );
}

function Shell({ onSignOut }: { onSignOut: (switchTo?: string) => void }) {
  const api = useApi();
  const views = useAsync(() => api.views(), []);
  // Right after setup the libraries are still being created: keep checking until they appear.
  usePoll(() => api.views().then(views.setData).catch(() => undefined), 4000, !!views.data && views.data.length === 0);
  const libs = (views.data ?? []).filter((v) => ['movies', 'tvshows', 'homevideos', 'mixed', undefined].includes(v.CollectionType));
  // TV first, then movies, then everything else (Figma nav order)
  const order = (t?: string) => (t === 'tvshows' ? 0 : t === 'movies' ? 1 : 2);
  const sorted = [...libs].sort((a, b) => order(a.CollectionType) - order(b.CollectionType));
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const iconFor = (t?: string) => (t === 'movies' ? <Icon.film /> : t === 'tvshows' ? <Icon.tv /> : <Icon.folder />);

  return (
    <div className="app">
      <header className={`topbar${solid ? ' solid' : ''}`}>
        <div className="topbar-left">
          <Link to="/" className="topbar-brand" aria-label="ReelForge home">
            <Logo />
            <span>ReelForge</span>
          </Link>
          <nav className="topnav" aria-label="Main">
            <NavLink to="/" end>Home</NavLink>
            {sorted.map((l) => (
              <NavLink key={l.Id} to={`/library/${l.Id}`}>{l.Name}</NavLink>
            ))}
            <NavLink to="/list">My List</NavLink>
          </nav>
        </div>
        <div className="topbar-right">
          {api.isAdmin && <WatchingBadge />}
          <SearchBox />
          <ProfileMenu onSignOut={onSignOut} />
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>
      <DownloadWatcher />
      <InstallBanner />

      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end>
          <Icon.home />
          Home
        </NavLink>
        {sorted.slice(0, 2).map((l) => (
          <NavLink key={l.Id} to={`/library/${l.Id}`}>
            {iconFor(l.CollectionType)}
            {l.Name}
          </NavLink>
        ))}
        <NavLink to="/search">
          <Icon.search />
          Search
        </NavLink>
        <NavLink to="/list">
          <Icon.heart />
          My List
        </NavLink>
      </nav>
    </div>
  );
}

/** Figma: SmallAvatar + Profile Menu (other profiles, then account actions, then sign out). */
function ProfileMenu({ onSignOut }: { onSignOut: (switchTo?: string) => void }) {
  const api = useApi();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState<User[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const me = api.session.user;
  const canDownload = useCanDownload();
  const server = api.session.server || defaultServer();

  useEffect(() => {
    if (!open) return;
    publicUsers(server).then((u) => setOthers(u.filter((x) => x.Id !== me.Id))).catch(() => setOthers([]));
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open, server, me.Id]);

  const go = (to: string) => {
    setOpen(false);
    nav(to);
  };

  return (
    <div className="profile-menu-wrap" ref={ref}>
      <button className="profile-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`${me.Name}: profile menu`} onClick={() => setOpen((o) => !o)}>
        <Avatar user={me} url={userImage(server, me, 64)} size={32} />
        <span className={`caret${open ? ' up' : ''}`}><Icon.caret /></span>
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <span className="profile-menu-notch" aria-hidden="true" />
          <div className="pm-profiles">
            {others.map((u) => (
              <button key={u.Id} role="menuitem" className="pm-row" onClick={() => onSignOut(u.Id)}>
                <Avatar user={u} url={userImage(server, u, 64)} size={32} />
                <span>{u.Name}</span>
              </button>
            ))}
          </div>
          <div className="pm-actions">
            <InstallMenuItem onDone={() => setOpen(false)} />
            {canDownload && (
              <button role="menuitem" className="pm-row" onClick={() => go('/downloads')}>
                <span className="pm-icon"><Icon.download /></span>
                <span>Downloads</span>
              </button>
            )}
            {api.isAdmin && (
              <>
                <button role="menuitem" className="pm-row" onClick={() => go('/manager')}>
                  <span className="pm-icon"><Icon.manager /></span>
                  <span>Media Manager</span>
                </button>
                <button role="menuitem" className="pm-row" onClick={() => go('/server/profiles')}>
                  <span className="pm-icon"><Icon.pencil /></span>
                  <span>Manage profiles</span>
                </button>
                <button role="menuitem" className="pm-row" onClick={() => go('/server')}>
                  <span className="pm-icon"><Icon.settings /></span>
                  <span>Server settings</span>
                </button>
              </>
            )}
          </div>
          {!isDemo && (
            <button role="menuitem" className="pm-signout" onClick={() => onSignOut()}>
              Sign out of ReelForge
            </button>
          )}
        </div>
      )}
    </div>
  );
}
