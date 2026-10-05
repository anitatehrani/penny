// The main destinations. `id` matches the ids the server accepts for favourites.
export const NAV = [
  { id: 'dashboard', to: '/', label: 'Dashboard', icon: 'home', end: true },
  { id: 'payments', to: '/payments', label: 'Payments', icon: 'list' },
  { id: 'recurring', to: '/recurring', label: 'Recurring', icon: 'repeat' },
  { id: 'installments', to: '/installments', label: 'Installments', icon: 'card' },
  { id: 'debts', to: '/debts', label: 'Debts', icon: 'debt' },
  { id: 'forecast', to: '/forecast', label: 'Forecast', icon: 'trend' },
  { id: 'people', to: '/people', label: 'People', icon: 'users' },
  { id: 'settings', to: '/settings', label: 'Settings', icon: 'gear' },
];

/** Shown in the bottom bar on phones; everything else lives under "More". */
export const MOBILE_PRIMARY = ['dashboard', 'payments', 'forecast', 'people'];

export const navById = Object.fromEntries(NAV.map((n) => [n.id, n]));

/** Label for the page the user is on, used in the top bar and as the document title. */
export function titleFor(pathname) {
  if (pathname === '/') return 'Dashboard';
  const hit = NAV.find((n) => n.to !== '/' && pathname.startsWith(n.to));
  if (hit) return hit.label;
  if (pathname.startsWith('/notifications')) return 'Notifications';
  if (pathname.startsWith('/profile')) return 'Profile';
  if (pathname.startsWith('/u/')) return 'Profile';
  return 'Penny';
}
