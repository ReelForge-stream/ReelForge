import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/server', label: 'General', end: true },
  { to: '/server/libraries', label: 'Libraries' },
  { to: '/server/profiles', label: 'Profiles' },
  { to: '/server/playback', label: 'Playback & GPU' },
  { to: '/server/network', label: 'Remote access' },
  { to: '/server/activity', label: 'Activity' },
];

export default function SettingsLayout() {
  return (
    <div className="page settings-page">
      <div className="page-head">
        <h1>Server settings</h1>
      </div>
      <nav className="mm-tabs" aria-label="Server settings">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
