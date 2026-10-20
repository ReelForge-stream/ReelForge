import { lazy, Suspense, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { Api, isDemo, loadSession, saveSession } from './lib/api';
import type { Session } from './lib/types';
import { ApiContext, Icon, Logo, ToastHost, useApi, useAsync } from './lib/ui';
import Login from './pages/Login';
import Home from './pages/Home';
import Library from './pages/Library';
import Details from './pages/Details';
import Search from './pages/Search';
import ManagerLayout from './manager/ManagerLayout';
import ManagerOverview from './manager/Overview';
import Duplicates from './manager/Duplicates';
import SpaceSaver from './manager/SpaceSaver';
import Queue from './manager/Queue';
import Holding from './manager/Holding';
import ManagerSettings from './manager/Settings';

// The player pulls in hls.js; load it only when someone presses Play.
const Player = lazy(() => import('./pages/Player'));

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const api = useMemo(() => (session ? new Api(session) : null), [session]);

  const signIn = (s: Session) => {
    saveSession(s);
    setSession(s);
  };
  const signOut = () => {
    saveSession(null);
    setSession(null);
  };

  return (
    <BrowserRouter basename="/reelforge">
      <ToastHost>
        {!api ? (
          <Login onSignedIn={signIn} />
        ) : (
          <ApiContext.Provider value={api}>
            <Routes>
              <Route path="/play/:id" element={<Suspense fallback={<div className="player" />}><Player /></Suspense>} />
              <Route element={<Shell onSignOut={signOut} />}>
                <Route index element={<Home />} />
                <Route path="library/:id" element={<Library />} />
                <Route path="item/:id" element={<Details />} />
                <Route path="search" element={<Search />} />
                {api.isAdmin && (
                  <Route path="manager" element={<ManagerLayout />}>
                    <Route index element={<ManagerOverview />} />
                    <Route path="duplicates" element={<Duplicates />} />
                    <Route path="space" element={<SpaceSaver />} />
                    <Route path="queue" element={<Queue />} />
                    <Route path="holding" element={<Holding />} />
                    <Route path="settings" element={<ManagerSettings />} />
                  </Route>
                )}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </ApiContext.Provider>
        )}
      </ToastHost>
    </BrowserRouter>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const api = useApi();
  const nav = useNavigate();
  const views = useAsync(() => api.views(), []);
  const libs = (views.data ?? []).filter((v) => ['movies', 'tvshows', 'homevideos', 'mixed', undefined].includes(v.CollectionType));
  const iconFor = (t?: string) => (t === 'movies' ? <Icon.film /> : t === 'tvshows' ? <Icon.tv /> : <Icon.folder />);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand">
          <Logo />
          ReelForge
        </div>
        <NavLink to="/" end>
          <Icon.home />
          Home
        </NavLink>
        {libs.map((l) => (
          <NavLink key={l.Id} to={`/library/${l.Id}`}>
            {iconFor(l.CollectionType)}
            {l.Name}
          </NavLink>
        ))}
        <NavLink to="/search">
          <Icon.search />
          Search
        </NavLink>
        {api.isAdmin && (
          <>
            <div className="section-gap" />
            <NavLink to="/manager">
              <Icon.manager />
              Media Manager
            </NavLink>
          </>
        )}
        <div className="spacer" />
        <div className="who">Signed in as {api.session.user.Name}{isDemo ? ' (demo)' : ''}</div>
        {!isDemo && (
          <button
            className="navlike"
            onClick={() => {
              onSignOut();
              nav('/');
            }}
          >
            <Icon.logout />
            Sign out
          </button>
        )}
      </nav>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end>
          <Icon.home />
          Home
        </NavLink>
        {libs.slice(0, 2).map((l) => (
          <NavLink key={l.Id} to={`/library/${l.Id}`}>
            {iconFor(l.CollectionType)}
            {l.Name}
          </NavLink>
        ))}
        <NavLink to="/search">
          <Icon.search />
          Search
        </NavLink>
        {api.isAdmin && (
          <NavLink to="/manager">
            <Icon.manager />
            Manager
          </NavLink>
        )}
      </nav>
    </div>
  );
}
