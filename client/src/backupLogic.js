import { t } from './i18n/translate.js';
/**
 * The backups line on the Settings page (docs/DESIGN.md section 29): what GET /api/backups/status says, in words.
 * `when` formats an ISO time ('5 Oct, 22:10'); it is passed in so this stays plain and testable.
 */
export function backupLine(status, when) {
  if (!status) return null;
  if (!status.enabled) return { tone: 'off', text: t('Automatic backups are switched off (BACKUPS=off).') };
  const last = status.last_at ? t('Last automatic backup: {when} · {count} kept', { when: when(status.last_at), count: status.count }) : null;
  if (status.problem) return { tone: 'warn', text: [status.problem, last].filter(Boolean).join(' ') };
  return { tone: 'ok', text: last ?? t('Automatic backups are on.') };
}
