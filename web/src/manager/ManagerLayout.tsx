import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/manager', label: 'Overview', end: true },
  { to: '/manager/duplicates', label: 'Duplicates' },
  { to: '/manager/space', label: 'Space Saver' },
  { to: '/manager/queue', label: 'Conversions' },
  { to: '/manager/saved', label: 'Space saved' },
  { to: '/manager/agents', label: 'Agents' },
  { to: '/manager/holding', label: 'Removed files' },
  { to: '/manager/settings', label: 'Settings' },
];

export default function ManagerLayout() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Media Manager</h1>
      </div>
      <nav className="mm-tabs" aria-label="Media Manager">
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
