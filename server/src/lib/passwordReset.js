import { mailMode } from './mailer.js';
import { N_, t } from './i18n.js';

/**
 * Whether "forgot my password" works on this server.
 *
 * It needs a real mail server. Without one the link would only be saved in a folder on the server, and nobody would receive it, so
 * the page hides the option and the endpoint says so. (The link is never handed back in the answer: anyone could then take over any
 * account just by asking.) On a developer's computer, outside production, the preview folder is enough to try it.
 */
export const resetAvailable = () => mailMode() === 'smtp' || process.env.NODE_ENV !== 'production';

export const RESET_UNAVAILABLE = N_('Password reset by e-mail is not set up on this server yet.');

/** How long a reset link works. */
export const RESET_MINUTES = 60;
