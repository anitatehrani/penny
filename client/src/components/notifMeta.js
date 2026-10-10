// How each kind of notification looks (icon + tone) and which group it belongs to.
// Shared by the notification centre, the Notifications page and the settings.
export const KIND_ICON = {
  payment_due: 'clock',
  payment_overdue: 'alert',
  balance_warning: 'alert',
  forecast_warning: 'trend',
  budget_alert: 'target',
  ai_insight: 'signal',
  summary_weekly: 'calendar',
  summary_monthly: 'calendar',
  security: 'shield',
  connection_request: 'users',
  connection_accepted: 'users',
  group_invite: 'users',
  group_change: 'users',
  payment_shared: 'share',
  group_activity: 'list',
  system: 'bell',
};
export const KIND_TONE = {
  payment_overdue: 'danger',
  balance_warning: 'danger',
  forecast_warning: 'forecast',
  budget_alert: 'warn',
  payment_due: 'info',
  ai_insight: 'signal',
  summary_weekly: 'signal',
  summary_monthly: 'signal',
  security: 'warn',
};

export const GROUPS = [
  { id: 'payments', label: 'Payments', icon: 'clock', kinds: ['payment_due', 'payment_overdue', 'balance_warning', 'forecast_warning', 'budget_alert'] },
  { id: 'ai', label: 'AI insights', icon: 'signal', kinds: ['ai_insight', 'summary_weekly', 'summary_monthly'] },
  { id: 'people', label: 'People & budgets', icon: 'users', kinds: ['connection_request', 'connection_accepted', 'group_invite', 'group_change', 'payment_shared', 'group_activity'] },
  { id: 'account', label: 'Account & system', icon: 'shield', kinds: ['security', 'system'] },
];
export const groupOf = (kind) => GROUPS.find((g) => g.kinds.includes(kind))?.id ?? 'account';
