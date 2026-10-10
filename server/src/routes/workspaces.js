import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { createGroup } from '../lib/accounts.js';
import { HttpError, idParam, text, wrap } from '../lib/http.js';
import { notify, notifyMany, removeByData, resolveByData } from '../lib/notifications.js';
import { briefUser, usernameField } from '../lib/profile.js';

const router = Router();

const nameSchema = z.object({ name: text(60) });

const LIST_SQL = `
  SELECT w.id, w.name, w.kind, m.role, ws.currency,
    (SELECT json_agg(json_build_object('username', u.username, 'name', u.name, 'avatar_url', u.avatar_url, 'role', m2.role)
                     ORDER BY (m2.role = 'owner') DESC, lower(u.name))
       FROM workspace_members m2 JOIN users u ON u.id = m2.user_id WHERE m2.workspace_id = w.id) AS members
  FROM workspace_members m
  JOIN workspaces w ON w.id = m.workspace_id
  LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id`;

async function membership(workspaceId, userId) {
  const { rows } = await query(
    `SELECT w.id, w.name, w.kind, w.owner_id, m.role FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $2 WHERE w.id = $1`,
    [workspaceId, userId],
  );
  if (!rows[0]) throw new HttpError(404, 'Group not found.');
  return rows[0];
}

/** Someone who leaves (or is removed from) a group no longer sees that group's payments in "Shared with me". */
async function dropSharedAccess(client, workspaceId, userId) {
  await client.query(
    `DELETE FROM transaction_participants p USING transactions t
     WHERE p.transaction_id = t.id AND t.workspace_id = $1 AND p.user_id = $2`,
    [workspaceId, userId],
  );
}

async function ownedGroup(workspaceId, userId) {
  const w = await membership(workspaceId, userId);
  if (w.kind !== 'group') throw new HttpError(400, 'This is your personal budget, not a group.');
  if (w.role !== 'owner') throw new HttpError(403, 'Only the group owner can do that.');
  return w;
}

router.get(
  '/workspaces',
  wrap(async (req, res) => {
    const { rows } = await query(`${LIST_SQL} WHERE m.user_id = $1 ORDER BY (w.kind = 'personal') DESC, lower(w.name)`, [req.user.id]);
    res.json(rows.map((r) => ({ ...r, members: r.members ?? [] })));
  }),
);

router.post(
  '/workspaces',
  wrap(async (req, res) => {
    const { name } = nameSchema.parse(req.body);
    const mine = await query(
      `SELECT ws.currency FROM workspaces w JOIN workspace_settings ws ON ws.workspace_id = w.id
       WHERE w.kind = 'personal' AND w.owner_id = $1`,
      [req.user.id],
    );
    const ws = await createGroup(req.user.id, name, mine.rows[0]?.currency ?? 'USD');
    // the window said that the assistant may use this budget's figures for any member who turns AI answers on (only sent when it said so)
    if (req.body?.ai === true) await query('UPDATE workspace_members SET ai_consent_at = now() WHERE workspace_id = $1 AND user_id = $2', [ws.id, req.user.id]);
    const { rows } = await query(`${LIST_SQL} WHERE m.user_id = $1 AND w.id = $2`, [req.user.id, ws.id]);
    res.status(201).json(rows[0]);
  }),
);

router.put(
  '/workspaces/:id',
  wrap(async (req, res) => {
    const { name } = nameSchema.parse(req.body);
    const w = await ownedGroup(idParam(req), req.user.id);
    await query('UPDATE workspaces SET name = $1 WHERE id = $2', [name, w.id]);
    res.json({ id: w.id, name });
  }),
);

// Deleting a group deletes its payments, categories and settings for everybody.
router.delete(
  '/workspaces/:id',
  wrap(async (req, res) => {
    const w = await ownedGroup(idParam(req), req.user.id);
    const others = (await query('SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id <> $2', [w.id, req.user.id])).rows.map((r) => r.user_id);
    await query('DELETE FROM workspaces WHERE id = $1', [w.id]);
    await notifyMany(others, {
      kind: 'group_change',
      title: `"${w.name}" was deleted`,
      body: `${req.user.name} deleted the shared budget.`,
      link: '/people?tab=groups',
      data: { from: briefUser(req.user) },
      dedupeKey: `gdel:${w.id}:${Date.now()}`,
    });
    res.status(204).end();
  }),
);

// ---- invitations (only to people you are already connected with) ----
router.get(
  '/workspaces/:id/invites',
  wrap(async (req, res) => {
    const w = await ownedGroup(idParam(req), req.user.id);
    const { rows } = await query(
      `SELECT i.id, i.created_at, u.name, u.username, u.avatar_url
       FROM workspace_invites i JOIN users u ON u.id = i.invitee_id
       WHERE i.workspace_id = $1 AND i.status = 'pending' ORDER BY i.created_at`,
      [w.id],
    );
    res.json(rows.map((r) => ({ id: r.id, created_at: r.created_at, user: briefUser(r) })));
  }),
);

router.post(
  '/workspaces/:id/invites',
  wrap(async (req, res) => {
    const { username } = z.object({ username: usernameField }).parse(req.body);
    const w = await ownedGroup(idParam(req), req.user.id);
    const { rows } = await query(
      `SELECT u.id FROM users u
       JOIN connections c ON c.status = 'accepted'
         AND ((c.requester_id = $1 AND c.addressee_id = u.id) OR (c.addressee_id = $1 AND c.requester_id = u.id))
       WHERE lower(u.username) = $2`,
      [req.user.id, username],
    );
    const invitee = rows[0];
    if (!invitee) throw new HttpError(400, 'You can only invite people you are connected with. Add them under People first.');
    const already = await query('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [w.id, invitee.id]);
    if (already.rowCount) throw new HttpError(409, 'That person is already in this group.');
    try {
      const created = await query('INSERT INTO workspace_invites (workspace_id, inviter_id, invitee_id) VALUES ($1, $2, $3) RETURNING id', [w.id, req.user.id, invitee.id]);
      await notify(invitee.id, {
        kind: 'group_invite',
        title: `${req.user.name} invited you to "${w.name}"`,
        body: 'Join to share one budget together.',
        link: '/people?tab=groups',
        data: { invite_id: created.rows[0].id, workspace: { id: w.id, name: w.name }, from: briefUser(req.user) },
        dedupeKey: `invite:${created.rows[0].id}`,
      });
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'An invitation is already waiting for that person.');
      throw err;
    }
    res.status(201).json({ ok: true });
  }),
);

// Cancel an invitation (group owner).
router.delete(
  '/workspace-invites/:id',
  wrap(async (req, res) => {
    const { rows } = await query(
      `DELETE FROM workspace_invites i USING workspaces w
       WHERE i.id = $1 AND i.status = 'pending' AND w.id = i.workspace_id AND w.owner_id = $2 RETURNING i.id, i.invitee_id`,
      [idParam(req), req.user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Invitation not found.');
    await removeByData(rows[0].invitee_id, 'group_invite', 'invite_id', rows[0].id);
    res.status(204).end();
  }),
);

router.post(
  '/workspace-invites/:id/accept',
  wrap(async (req, res) => {
    const id = idParam(req);
    const accepted = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE workspace_invites SET status = 'accepted', responded_at = now()
         WHERE id = $1 AND invitee_id = $2 AND status = 'pending' RETURNING workspace_id, inviter_id`,
        [id, req.user.id],
      );
      if (!rows[0]) throw new HttpError(404, 'Invitation not found.');
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, ai_consent_at) VALUES ($1, $2, 'member', CASE WHEN $3 THEN now() END) ON CONFLICT DO NOTHING`,
        [rows[0].workspace_id, req.user.id, req.body?.ai === true],
      );
      return rows[0];
    });
    await resolveByData(req.user.id, 'group_invite', 'invite_id', id);
    const ws = (await query('SELECT name FROM workspaces WHERE id = $1', [accepted.workspace_id])).rows[0];
    await notify(accepted.inviter_id, {
      kind: 'group_change',
      title: `${req.user.name} joined "${ws.name}"`,
      link: '/people?tab=groups',
      data: { workspace_id: accepted.workspace_id, from: briefUser(req.user) },
      dedupeKey: `joined:${accepted.workspace_id}:${req.user.id}:${Date.now()}`,
    });
    res.json({ workspace_id: accepted.workspace_id });
  }),
);

router.post(
  '/workspace-invites/:id/decline',
  wrap(async (req, res) => {
    const { rows } = await query(
      `UPDATE workspace_invites SET status = 'declined', responded_at = now()
       WHERE id = $1 AND invitee_id = $2 AND status = 'pending' RETURNING id, inviter_id, workspace_id`,
      [idParam(req), req.user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Invitation not found.');
    await resolveByData(req.user.id, 'group_invite', 'invite_id', rows[0].id);
    const ws = (await query('SELECT name FROM workspaces WHERE id = $1', [rows[0].workspace_id])).rows[0];
    await notify(rows[0].inviter_id, {
      kind: 'group_change',
      title: `${req.user.name} declined the invitation to "${ws.name}"`,
      link: '/people?tab=groups',
      data: { workspace_id: rows[0].workspace_id, from: briefUser(req.user) },
      dedupeKey: `declined:${rows[0].id}`,
    });
    res.status(204).end();
  }),
);

// ---- membership ----
router.delete(
  '/workspaces/:id/members/:username',
  wrap(async (req, res) => {
    const w = await ownedGroup(idParam(req), req.user.id);
    const target = usernameField.parse(req.params.username);
    const { rows } = await query(
      `SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1 WHERE lower(u.username) = $2`,
      [w.id, target],
    );
    if (!rows[0]) throw new HttpError(404, 'That person is not in this group.');
    if (rows[0].id === req.user.id) throw new HttpError(400, 'Use "Leave group" for yourself.');
    await withTransaction(async (client) => {
      await client.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [w.id, rows[0].id]);
      await dropSharedAccess(client, w.id, rows[0].id);
    });
    await notify(rows[0].id, {
      kind: 'group_change',
      title: `You were removed from "${w.name}"`,
      body: `${req.user.name} removed you from the shared budget.`,
      link: '/people?tab=groups',
      data: { from: briefUser(req.user) },
      dedupeKey: `removed:${w.id}:${Date.now()}`,
    });
    res.status(204).end();
  }),
);

router.post(
  '/workspaces/:id/leave',
  wrap(async (req, res) => {
    const w = await membership(idParam(req), req.user.id);
    if (w.kind !== 'group') throw new HttpError(400, 'You cannot leave your personal budget.');
    const { rows } = await query('SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1', [w.id]);
    if (w.role === 'owner' && rows[0].n > 1) {
      throw new HttpError(400, 'You own this group. Transfer ownership to someone else first, or remove the other members.');
    }
    if (rows[0].n === 1) await query('DELETE FROM workspaces WHERE id = $1', [w.id]); // last person out
    else {
      await withTransaction(async (client) => {
        await client.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [w.id, req.user.id]);
        await dropSharedAccess(client, w.id, req.user.id);
      });
      await notify(w.owner_id, {
        kind: 'group_change',
        title: `${req.user.name} left "${w.name}"`,
        link: '/people?tab=groups',
        data: { workspace_id: w.id, from: briefUser(req.user) },
        dedupeKey: `left:${w.id}:${req.user.id}:${Date.now()}`,
      });
    }
    res.status(204).end();
  }),
);

router.post(
  '/workspaces/:id/transfer',
  wrap(async (req, res) => {
    const { username } = z.object({ username: usernameField }).parse(req.body);
    const w = await ownedGroup(idParam(req), req.user.id);
    let newOwner;
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1 WHERE lower(u.username) = $2`,
        [w.id, username],
      );
      if (!rows[0] || rows[0].id === req.user.id) throw new HttpError(400, 'Choose another member of this group.');
      await client.query(`UPDATE workspace_members SET role = 'member' WHERE workspace_id = $1 AND user_id = $2`, [w.id, req.user.id]);
      await client.query(`UPDATE workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`, [w.id, rows[0].id]);
      await client.query('UPDATE workspaces SET owner_id = $1 WHERE id = $2', [rows[0].id, w.id]);
      newOwner = rows[0].id;
    });
    await notify(newOwner, {
      kind: 'group_change',
      title: `You are now the owner of "${w.name}"`,
      body: `${req.user.name} handed the group over to you.`,
      link: '/people?tab=groups',
      data: { workspace_id: w.id, from: briefUser(req.user) },
      dedupeKey: `owner:${w.id}:${Date.now()}`,
    });
    res.status(204).end();
  }),
);

export default router;
