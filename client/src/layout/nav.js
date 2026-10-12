import { t } from '../i18n/translate.js';
// The main destinations. `id` matches the ids the server accepts for favourites.
export const NAV = [
  { id: 'dashboard', to: '/', get label() { return t('Dashboard'); }, icon: 'home', end: true },
  { id: 'payments', to: '/payments', get label() { return t('Payments'); }, icon: 'list' },
  { id: 'budget', to: '/budget', get label() { return t('Monthly budget'); }, icon: 'target' },
  { id: 'recurring', to: '/recurring', get label() { return t('Recurring'); }, icon: 'repeat' },
  { id: 'installments', to: '/installments', get label() { return t('Installments'); }, icon: 'card' },
  { id: 'debts', to: '/debts', get label() { return t('Debts'); }, icon: 'debt' },
  { id: 'forecast', to: '/forecast', get label() { return t('Forecast'); }, icon: 'trend' },
  { id: 'people', to: '/people', get label() { return t('People'); }, icon: 'users' },
  { id: 'settings', to: '/settings', get label() { return t('Settings'); }, icon: 'gear' },
];

/** Only for admins (docs/DESIGN.md section 33); not one of the pinnable destinations. */
export const ADMIN_NAV = { id: 'admin', to: '/admin', get label() { return t('Admin'); }, icon: 'shield' };

/** Shown in the bottom bar on phones; everything else lives under "More". */
export const MOBILE_PRIMARY = ['dashboard', 'payments', 'forecast', 'people'];

export const navById = Object.fromEntries(NAV.map((n) => [n.id, n]));

/** Label for the page the user is on, used in the top bar and as the document title. */
export function titleFor(pathname) {
  if (pathname === '/') return t('Dashboard');
  const hit = NAV.find((n) => n.to !== '/' && pathname.startsWith(n.to));
  if (hit) return hit.label;
  if (pathname.startsWith('/admin')) return t('Admin');
  if (pathname.startsWith('/notifications')) return t('Notifications');
  if (pathname.startsWith('/profile')) return t('Profile');
  if (pathname.startsWith('/u/')) return t('Profile');
  return t('Penny');
}
