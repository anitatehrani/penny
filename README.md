# Penny

Manage this month's payments, record past ones, plan upcoming commitments (recurring bills, birthdays,
installments) and see where your balance is heading — including when it goes negative.

**Stack:** Node.js + Express · PostgreSQL · React (Vite) · Recharts

## Features

| Area | What you can do |
| --- | --- |
| **Payments** | Add income/expenses, pick any date (past dates = "already paid"), mark paid/unpaid, edit, delete. Month navigator, filters (to pay / paid / overdue / skipped, type, how it was paid, category), search, CSV export. |
| **Credit card** | Mark an expense "Paid with credit card": record the day you bought it, and choose the month the card bill is paid. It counts in that month (balance, forecast, totals, alerts), not the purchase month. It is still listed on the day you bought it, marked "counts on 10 Nov" and kept out of that month's figures (shown as "Bought on card"), and in the bill month it carries a "Credit card" badge with "bought 1 Oct". The day of the month you pay the card is a setting (default the 10th). |
| **Recurring** | Rent, subscriptions, salary, yearly birthdays, quarterly insurance… (weekly / monthly / yearly, every N, pause/resume). It can **end** never, on a date, or after a number of payments (the form shows the last payment). Generates real pending payments for the next 24 months. Moving one occurrence to another day keeps it moved. |
| **Installments** | Enter total *or* per-installment amount, number of installments, first due date and how many are already paid. One payment per month, progress tracking, remaining total. |
| **Debts** | Money you owe, for example to a friend. Pay it **all in one month**, **split it over months** (equal payments, odd cents on the first), or leave it **not scheduled yet**. A switch decides whether it is **counted in your budget**: counted debts create real pending payments (Payments page, forecast, alerts) and count in "balance after debts"; not counted ones are only tracked and change nothing. Record extra payments (the planned ones shrink to match), mark a debt settled, reopen it. |
| **Money owed to you** | The same page has a second side, **Owed to me**: a loan to a friend, a share of a bill someone will pay back. It works like a debt turned round: repayments are **income** (pending income in Payments and the forecast when counted, a *Paid back* badge), the summary says what is **owed to you** and **received so far**, and the balance line says what it would be *if everyone paid you back*. *Also record the money I handed over* (off by default, since an old loan is already in your balance) adds one paid *Lent to …* payment on the day you lent it; it counts in the balance but not as spending. A repayment you receive is not counted as earnings in the insights and summaries, and **safe to spend** does not rely on it. The side is chosen when you add it and cannot be changed. |
| **Dashboard** | Balance today, this month's income/expenses (paid vs pending), projected end-of-month balance, overdue + next-14-days list, spending by category, balance outlook chart. |
| **Forecast** | 3 months back, up to 24 ahead. Balance line, income vs expenses, month-by-month table, warnings when/how far the balance goes negative, lowest point. Optional estimate of everyday spending. |
| **Settings** | Starting balance (can be negative), currency, credit card pay day, categories (name + colour). |
| **Accounts** | Sign up with email + password or with Google. Sign in with your **email or your username** (with or without the `@`) and your password, or with Google. Every account has its own private data. Change password, connect/disconnect Google, sign out. |
| **Profile & sharing** | Username, email, optional phone. Others find you by exact `@username`, email or phone (each can be switched off, or hide yourself completely). Share your profile link `/u/username` or a QR code from **Profile**. |
| **People** | Send connection requests (partner / family / friend / other), accept or decline, remove. Nobody is added without accepting. |
| **Add people to a payment** | Add connections to any payment and split it equally or with custom amounts. They see it under **People → Shared with me** and can add their share to their own budget in one click. |
| **Shared budgets (groups)** | Create a group, invite connections, and pool your income: one combined balance, payments marked *paid by / from* a member, per-member contributions on the dashboard, shared categories, recurring items, installments and forecast. Switching to a group re-themes the whole UI (teal) so it is obvious whose money you are looking at. |
| **Profile picture** | Upload a photo on **Profile** (cropped to a square and shrunk in your browser, re-checked by the server). Shown to people who can already see you; falls back to your Google picture or your initials. |
| **Receipts** | Attach up to 5 photos or PDFs (5 MB each) to any payment, when adding it or later via the paperclip. Preview, download, delete. Visible to everyone in the budget. |
| **Notifications** | A bell with an unread count and a **Notifications** page: payments coming up and overdue, low-balance warnings, connection requests, group invitations and changes, payments shared with you, and (optionally) activity in shared budgets. Mark read/unread, delete, "Mark paid" straight from the notification, clear read ones. |
| **Alert rules** | Decide which payments alert you: default (X days before), *always* (with its own number of days) or *never*, for a single payment, a whole recurring item, an installment plan or a category. The most specific rule wins. Pause all payment alerts for a day, week, month or until a date. |
| **Email alerts** | Confirm your email, then get a daily summary (at the hour you choose, in your time zone) or an email right away, choosing which kinds of alert are emailed. Every email has an unsubscribe link (also one-click for mail apps), and a test email button. |
| **Assistant** | Insights written from your own ledger: spending up or down against the same point last month, subscriptions that grew, a busy week ahead, the first month the forecast goes negative, where you could save. Each one can be expanded ("Why?"), questioned, or dismissed for the month. Ask your own questions ("How much did I spend on groceries?", "Will I go negative?"). **It is a rules-and-statistics engine running on your server, not a large language model; no financial data leaves it.** |
| **Command palette** | `Ctrl`/`⌘` + `K` from anywhere: fuzzy-search pages, actions (add payment, add recurring item…), payments, people, themes and accent colours; type a question to hand it to the assistant. |
| **Personal dashboard** | Reorder, resize (S/M/L) and hide dashboard widgets, collapse sections, pin pages in the sidebar, collapse the sidebar, choose comfortable or compact density and an accent colour. Saved to your account. |
| **Month calendar** | Jump to any month with a calendar (a year with arrows and twelve month buttons; keyboard-friendly; a bottom sheet on a phone) on the dashboard, the Payments page, and as the "Counts in" choice of a credit card payment. On the dashboard it opens a **month view** (`/?month=2027-02`, up to 12 months back and 24 ahead): the balance at the end of that month (actual or expected) with its arithmetic, that month's payments, spending against the month before, and cash flow around it. Insights stay about today. |
| **Payment filters** | The Payments page filters (type, paid with, category, member) are styled dropdowns: the active ones are tinted, a long list such as the categories has a search box (type to narrow it, arrows and Enter to choose), and **Clear filters** resets them. The search box for descriptions and notes has a clear button. Works with the keyboard and as a bottom sheet on a phone. |
| **Clearer forecast** | The balance card says at a glance whether you will dip below zero (and when), the forecast page uses the same charts as the dashboard with a Look-ahead choice (3 months to 2 years) and switches for the estimates, and a debt shows how much of it is paid. |
| **Avatars** | Your photo, initials, a generated pattern or a small illustration; an "active now" dot for people you are connected to (you can switch it off). |
| **Safety buffer** | Settings → *Safety buffer*: the balance you do not want to go below (default 0). The balance card, the forecast page and chart (a dashed buffer line), the low-balance alerts, the assistant and the insights all warn when the balance is, or is heading, below it, not only below zero. Below zero stays the stronger warning. |
| **Safe to spend** | A line on the balance card: how much you can spend a day until the next income, after the payments still to come and the buffer (*"Safe to spend €18.00 a day for 12 days, until Mo — salary on 10 Nov"*, or how much you are short). Hover it for the arithmetic. |
| **Match my bank balance** | On the balance card: type what your bank shows. Penny shows the difference and, if you say so, adds one paid *Balance adjustment* dated today (income or expense). It counts in the balance but not as spending; delete it to undo. Overdue unpaid payments, the usual cause of a gap, are pointed out first. |
| **Backups** | Once a day (and at start-up if there is none from the last 24 hours) the server writes a compressed copy of the whole database to `backups/`, checks it can be read back, and keeps the newest 14 days plus the first backup of each of the last 6 months. Settings shows when the last one was made. `npm run backup` makes one now; `npm run restore` puts one back. See "Backups and restoring". |
| **Date picker** | Every date field is Penny's own calendar, not the browser's: Monday-first weeks, today ringed, the chosen day filled, a Today button, a month and year chooser (click the title), days that are not allowed struck through, full keyboard use (arrows, Page Up/Down, Home/End, Escape closes only the calendar), and a bottom sheet on a phone. |
| **Editing recurring items** | Saving a recurring item on the Recurring page changes every unpaid payment from this month on (a new day reaches all the months to come; paid ones stay). Changing one month on the Payments page changes only that payment, never the recurring item or other months. A month that is already paid (or skipped) is not given a second payment when the item's day changes. |
| **Admin dashboard** | For running Penny in public: a page at `/admin` for admins only (everyone else gets "not found"). **Overview** (people, new and active, e-mail confirmed, sign-ins and failures in 24 hours, a 30-day sign-up chart, and a going-public checklist read from the real settings), **People** (search, filters, suspend with a reason, reinstate, sign out everywhere, delete), **Activity** (sign-ups, sign-ins, failed sign-ins, password changes, rate-limit hits and every admin action; kept 90 days, no passwords, sources only as a short hash of the address) and **System** (database size, uptime, backups, mail failures). The dashboard never shows payments, amounts, debts, notes or budget names. The one way to see a person's money is **View as** (a button on each person, to help them): it needs a reason and the admin's password, lasts 30 minutes, is **read-only unless the admin allows changes**, shows a banner you cannot miss, is written in the activity log, and **tells the person in the app**; even with changes allowed it can never change who they are, how they sign in, their friends or sharing. Make someone an admin only from the command line: `.\penny make-admin you@example.com`. |
| **Themes** | Light, Dark or System (follows your device), switchable from the sidebar, the sign-in page and Profile. |

The balance **can be negative** everywhere; negative values are shown in red with a warning icon.

### How the numbers work

* **Balance today** = starting balance + all income marked *received* − all expenses marked *paid*.
* **Month-end projection** = balance today + pending items up to that month (overdue unpaid items count
  against the current month) + optional estimates.
* **Estimate of everyday spending** = average of your last ≤3 full months of one-off (manually added) paid
  expenses, ignoring categories already covered by an active recurring item or an open installment plan
  (so a past "Rent" you typed in isn't counted on top of your recurring rent). Turn it off on the Forecast page.
* Deleting an occurrence of a recurring item *skips* it (it stays skipped, and can be restored from the
  "Skipped" filter). Deleting a recurring item or installment plan removes its unpaid payments and keeps paid history.
* Moving one occurrence to another day (rent on the 14th instead of the 10th) keeps it moved: each generated payment remembers the
  schedule slot it came from (`occurrence_date`), so the automatic top-up never creates the original day again.

## Running it

Requirements: Node 20+ and a PostgreSQL server.

```bash
npm run setup          # installs root, server and client dependencies
npm run db:start       # starts the project's own Postgres (see "Database"), skip if you use your own
npm run dev            # API on :3001, web app on http://localhost:5173
```

Production-style (one process serves API + built UI on http://localhost:3001):

```bash
npm run build
npm start
```

### With Docker, and the `penny` command

Needs only Docker Desktop. Everything (the database, the backend and the frontend) runs in containers, and one file, `penny.ps1`
(started through `penny.cmd`), runs it all. In PowerShell, in the project folder:

```powershell
.\penny install        # first time: makes .env (with a made-up database password), builds, starts
.\penny up             # (short name: bfu) start database + backend + frontend, then open http://localhost:3001
.\penny down           # (bfd) stop and remove the containers; the data stays in a Docker volume
.\penny help           # every command
```

| Command | What it does |
| --- | --- |
| `up` (`bfu`), `down` (`bfd`), `stop`, `restart [service]` (`bfr`) | start, stop (and remove) or restart the containers |
| `install` | first time: `.env`, build, start |
| `build [--no-cache]`, `rebuild` | build the image again |
| `dev` | development with hot reload: the backend (`api`, `nodemon` in polling mode) and the frontend (`web`, Vite on port 5173) as two containers |
| `status` (`s`), `logs [service]` (`l`), `open`, `shell [service]`, `psql` | look at it, follow the log, open the browser, get a shell or the database prompt |
| `backup`, `restore latest`, `restore <file>` | make a backup now, or put one back (asks first, makes a safety copy first) |
| `import-local` | move the data of the old local database (`npm start`, port 5433) into Docker; the old one is not touched |
| `seed` | demo accounts and data |
| `test`, `e2e`, `deps` | run the tests against the Docker database, the browser checks, install packages on this computer |
| `stop-local`, `db-local start\|stop` | stop the old local server, start or stop the old local database |
| `wipe` | delete the Docker database (makes a backup first and asks you to type DELETE) |

**Add your own command** at the bottom of `penny.ps1`, in "YOUR COMMANDS", one line each:

```powershell
Command fresh 'Rebuild, start and open the browser' { Up; Start-Process (Url) }
Alias   bfu up
```

Inside the braces anything PowerShell works; `Compose ...` runs `docker compose ...`, `Up` and `Down` are the commands above, `$Rest` is what was
typed after the name.

The same thing without the command file:

```bash
docker compose up -d --build     # then open http://localhost:3001
docker compose exec app node scripts/seed-demo.mjs   # optional: fill it with the demo data (see "Demo data")
docker compose logs -f app       # follow the server log
docker compose down              # stop (your data stays in the penny-data volume); add -v to delete it
```

The image (`Dockerfile`) builds the React app, installs only the server's production dependencies and runs as a non-root user;
Node serves the API and the built UI on one port. Tables are created on first start, and the container has a health check on `/api/health`.

Every setting is optional. Copy `.env.docker.example` to `.env` next to `docker-compose.yml` to change the port, the database
password (set it before the first start), `APP_URL`, `COOKIE_SECURE=true` behind HTTPS, Google sign-in or SMTP (see the sections below).
Without `SMTP_HOST`, e-mails are saved in the `penny-mail` volume instead of being sent:
`docker compose exec app ls /data/mail-preview`.

Data lives in two named volumes: `penny-data` (Postgres) and `penny-mail`, and the backups in a folder of this computer (`backups/`, or
`BACKUP_HOST_DIR` in `.env`, better on another drive or a synced folder). To update after pulling new code, run `.\penny up` again.
The old local database and `npm start` keep working next to it, but both use port 3001: only one at a time (`.\penny stop-local`).

**Moving to Docker with your existing budget:** `.\penny import-local` makes a backup of the old local database and restores it into the Docker
database (after asking). Check the result at http://localhost:3001; the old database stays as it was.

### Tests

```bash
npm test              # everything (about 40 seconds)
npm run test:server   # API, security, migration and logic tests
npm run test:client   # browser-side logic (password checklist vs server rules, formatting, fuzzy search, avatars, layout rules)
npm run e2e           # drives a real Chrome/Edge through the interface (needs the app running and the demo data)
```

`npm run e2e` is separate from `npm test` because it needs a browser. It checks the dashboard, notification centre, command palette,
assistant, customise mode, avatar picker, settings, offline/error/first-run states, the logo, credit card payments, debts, recurring endings, signing in by username or email, the month calendar, the payment filters, the balance card and forecast page, and the phone layout (about 80 checks).
Set `CHROME_PATH` if Chrome is not in its usual place.

The server tests start the **real server against a throw-away Postgres database** (created and dropped per test file
on the same Postgres, `budget_test_*`), so they never touch your data. They cover: budget logic (payments, filters,
CSV, recurring, installments, summary, forecast), sign-up/login/sessions/CSRF/rate limiting, Google account rules,
people and connections, groups and invitations, shared payments and splits, data isolation between users (IDOR),
malformed input, races (simultaneous sign-ups, double imports, crossing requests), database upgrades from older
versions, and database constraints. Set `TEST_PG_URL` (default `postgres://budget@127.0.0.1:5433`) to use another Postgres.

### Database

Tables are created automatically on server start (`server/src/schema.sql`, idempotent) and default categories
are seeded. The connection comes from `DATABASE_URL` in `server/.env` (see `.env.example`).

Three ways to provide Postgres:

1. **Project-local cluster (what this repo was set up with)** – data lives in `.pgdata/`, port **5433**,
   user `budget`, trusted for localhost only. `npm run db:start` / `npm run db:stop`. The default
   `DATABASE_URL` is `postgres://budget@127.0.0.1:5433/budget`. To recreate it from scratch:
   ```powershell
   $pg = "C:\Program Files\PostgreSQL\17\bin"
   & "$pg\initdb.exe" -D .pgdata -U budget --auth=trust -E UTF8
   Add-Content .pgdata\postgresql.conf "`nport = 5433`nlisten_addresses = 'localhost'"
   npm run db:start
   & "$pg\createdb.exe" -h 127.0.0.1 -p 5433 -U budget budget
   ```
2. **Docker** – `docker compose up -d db`, then set `DATABASE_URL=postgres://penny:penny@127.0.0.1:5434/penny` (the container publishes Postgres on 127.0.0.1:5434; change it with `DB_PORT`). To run the whole app in Docker instead, see "With Docker".
3. **Your own Postgres** – create a database and point `DATABASE_URL` at it.

### Backups and restoring

All of the data is in one database on one computer, so Penny copies it for you.

* **Automatic.** When the server starts, and then every hour, it checks the newest backup; if there is none from the last 24 hours it makes one
  with `pg_dump` (compressed) named `penny-YYYY-MM-DD-HHMM.dump` in `backups/` next to the app. Every backup is read back with `pg_restore --list`
  before it is kept. The folder is in `.gitignore`: a backup holds real financial data and must never be committed.
* **Kept:** the newest 14 days of backups, plus the first backup of each of the last 6 months. Older ones are deleted, never the newest.
* **Settings → Backups** shows when the last one was made and warns if there is none, the newest is more than 2 days old, or the last attempt failed.
  It is read-only on purpose: any signed-in person could otherwise start or delete a backup of everyone's data.
* **Keep a second copy somewhere else.** A backup on the same disk does not help if the disk fails. Set `BACKUP_DIR` to another drive, or set
  `BACKUP_COPY_DIR` to a synced folder (OneDrive, Dropbox, a USB drive) and every backup is copied there as well. Both go in `server/.env`.
* **By hand:** `npm run backup` makes one now and tidies the old ones.
* **Restoring:**
  1. **Stop the server.**
  2. `npm run restore -- latest` shows what it would do and changes nothing. To go ahead: `npm run restore -- latest --yes`
     (or `npm run restore -- penny-2026-10-05-2210.dump --yes` for a particular one).
  3. A restore **replaces** what is in the database. It first makes a `pre-restore` backup of what is there now (kept 90 days, so even a wrong
     restore can be undone), then restores in a single step: if anything fails, the database is left exactly as it was.
  4. Start the server again.
* **In Docker** the app makes its own daily backups too (`pg_dump` is in the image) into `/backups`, which is the `backups/` folder of this
  computer (`BACKUP_HOST_DIR` in `.env` changes where). `.\penny backup` makes one now, `.\penny restore latest` puts one back.
* **Switch off:** `BACKUPS=off` in `server/.env`. The tools `pg_dump` and `pg_restore` are found through `PG_BIN`, the usual Windows folders
  (`C:\Program Files\PostgreSQL\17\bin`) or the PATH.

### Running Penny in public

1. **An address and HTTPS.** Put a web server or proxy in front (Caddy and nginx both do HTTPS for you) and point your domain at it. In `.env`: `APP_URL=https://your.domain`, `COOKIE_SECURE=true`.
2. **`TRUST_PROXY=1`** (the number of proxies in front of Penny). Without it every visitor looks like the proxy: they share one rate limit and the activity log cannot tell them apart.
3. **A real mail server** (`SMTP_HOST` and the other `SMTP_` settings), so confirmation and alert e-mails reach people.
4. **Backups** stay on (they are by default), with a second copy somewhere else (`BACKUP_HOST_DIR`).
5. **Make yourself an admin:** sign up, confirm your e-mail, then `.\penny make-admin you@example.com`. The **Going public** card on the Admin page shows what is still missing.

Not built yet, and worth having before real strangers use it: two-step sign-in. ("Forgot my password" by e-mail, the terms of use and privacy policy, "download my data" and "delete my account" are built.)

### Putting Penny online (DigitalOcean)

A small server rented by the month runs the same Docker setup as your computer, with a web server in front that gets the HTTPS certificate by itself.
Plan on about **$12 a month** for the server and **$2.40** for weekly server backups (check DigitalOcean's current prices); the GitHub Student Pack credit
(if it is still offered when you look) covers about a year.

**Start with sign-ups closed** (`SIGNUPS=closed`, the template does this): Penny is then online for you and the people who already have an account, and
nobody new can join. Open it (`SIGNUPS=open`) only when you are ready for strangers (see the list at the end).

**On your computer**

1. **The credit.** [education.github.com/pack](https://education.github.com/pack): find DigitalOcean, follow the link and make the account. Check that the credit shows under Billing.
2. **An SSH key** (how the server knows it is you). In PowerShell:
   ```powershell
   ssh-keygen -t ed25519 -C "penny-server"
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
   ```
   Press Enter at the questions (a passphrase is a good idea). Copy the line that starts with `ssh-ed25519`.
   In DigitalOcean: Settings, Security, **Add SSH Key**, paste it.
3. **The server ("droplet").** Create, Droplets: **Ubuntu 24.04 (LTS)**, Basic, **Regular, 2 GB RAM / 1 CPU (about $12 a month)**, a region near your users (Frankfurt for Europe),
   authentication **SSH Key** (the one you added), name it `penny`, and turn on **Backups** (weekly). Note the server's **IP address**.
4. **The web address.** Claim the free domain from the pack (Name.com or Namecheap, see the pack page). In its DNS settings add an **A record**: host `@` (or a name such as
   `budget`) pointing to the server's IP address. It can take minutes to hours; check with `nslookup your.domain` that it shows the IP.
5. **Set the server up once.** Copy the setup script to it and run it (as root, once):
   ```powershell
   scp deploy/bootstrap.sh root@SERVER_IP:/root/
   ssh root@SERVER_IP "bash /root/bootstrap.sh"
   ```
   It installs Docker, makes a normal user `penny`, turns on a firewall (only SSH, HTTP and HTTPS), keys-only SSH, automatic security updates.

**On the server** (`ssh penny@SERVER_IP`)

6. **Let the server read your private GitHub repository** with a read-only key:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/penny_deploy -N ""
   printf 'Host github.com\n  IdentityFile ~/.ssh/penny_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
   cat ~/.ssh/penny_deploy.pub
   ```
   On GitHub: the penny repository, Settings, **Deploy keys**, Add deploy key, paste it, leave "Allow write access" **off**. Then:
   ```bash
   git clone git@github.com:anitatehrani/penny.git
   cd penny
   ```
7. **Your settings.** Copy the template and fill it in:
   ```bash
   mkdir -p backups   # made by you, so the server user owns it and Penny can write its backups there
   cp deploy/env.production.example .env
   echo "APP_UID=$(id -u)" >> .env
   echo "APP_GID=$(id -g)" >> .env
   nano .env        # DOMAIN=your.domain  DB_PASSWORD=(the output of: openssl rand -hex 16)  and the SMTP_ lines when you have a mail service
   ```
8. **Start it.** The first time takes a few minutes (it builds Penny). Then open **https://your.domain**:
   ```bash
   docker compose up -d --build
   ```

**Moving your budget to the server** (you can do this any time; it replaces what is on the server)

```powershell
.\penny backup                                     # on your computer: makes a backup, in the backups folder
scp backups\penny-2026-10-10-1200.dump penny@SERVER_IP:penny/backups/    # use the real file name
.\penny remote docker compose stop app
.\penny remote docker compose run --rm app node scripts/restore.mjs penny-2026-10-10-1200.dump --yes
.\penny remote docker compose up -d
.\penny remote docker compose exec app node scripts/make-admin.mjs you@example.com --force
```

**Every day after that.** In your `.env` on your computer add `DEPLOY_HOST=penny@SERVER_IP`. Then:

| Command | What it does |
| --- | --- |
| `git push`, then `.\penny deploy` | the server takes the new code, makes a backup, rebuilds and restarts (the data stays) |
| `.\penny remote docker compose ps` | run any command on the server (here: what is running) |
| `.\penny remote docker compose logs --tail 50 app` | read Penny's log on the server |
| `.\penny prod-backup` | back up now on the server and **download all its backups** to the folder `backups-live` on your computer |

**Keep copies of the backups somewhere other than the server** (run `.\penny prod-backup` every week or so, and keep the files on another drive or a synced folder): the weekly server backups
and Penny's own daily ones live on the same machine, which does not help if the machine is lost or someone deletes the server.

**Before you open sign-ups to strangers:** a real mail server (it also switches "Forgot your password?" on, see below), and **who runs the site** on the terms and privacy pages: set `OPERATOR_NAME`
(your name, or the name you run it under) and `CONTACT_EMAIL` (an address people can write to about their data) in `.env`. The **Going public** card on the Admin page shows what is still missing.
The two pages (`/terms` and `/privacy`) are written in plain language to describe what Penny really does; have a lawyer read them if the site grows.

## The home page

A visitor who is not signed in sees a home page at `/` (what Penny is, a forecast to play with, what it does with real pictures, privacy, questions, and Log in / Sign up buttons); signed-in people go straight to their dashboard. The text is in
`client/src/pages/Landing.jsx`; read it once and edit anything that is not true for you (for example "free" and "hosted in the EU"). With `SIGNUPS=closed` the sign-up buttons disappear and the page says that sign-ups are closed.
The pictures are real pages of the demo in `client/public/landing/`. When the screens change, make them again: start the app on a **scratch** database, `npm run seed:demo`, then `cd e2e && npm run landing` and rebuild the client.
Link previews (WhatsApp, social networks) use the picture `landing/og.png` and the address in `APP_URL`.

## The interface

The look is documented in [docs/DESIGN.md](docs/DESIGN.md): the problems it solves, the "Ink & Signal" direction, the design tokens
(`client/src/design/tokens.css`), and the backend additions that came with it. In short: figures are the typography (Geist Mono),
sections are ruled rather than boxed, colour carries meaning (and never alone), and the assistant is a thin indigo rule beside a sentence, not a chatbot bubble.

The logo is the rounded "penny" wordmark in `docs/brand/penny-wordmark.webp`, redrawn as vector strokes in `client/src/brand/paths.js`
so it stays sharp at any size and takes the text colour (ink on paper, paper on ink). The sidebar shows the wordmark and, when collapsed,
the p on a rounded square. The favicon, phone home-screen icons and `manifest.webmanifest` live in `client/public`; after changing the paths run
`node scripts/make-brand-assets.cjs` to redraw them (it needs Chrome or Edge and `cd e2e && npm install` once). A test fails if they fall out of date.

Keyboard: `Ctrl`/`⌘` + `K` palette · `Ctrl`/`⌘` + `J` assistant · `Esc` closes any panel and returns focus.
Everything moves only if your device allows motion (`prefers-reduced-motion`).

## Demo data

`npm run seed:demo` (with the server running) fills the app with a realistic demo so every feature has something to
show. It is safe to run again: it deletes and recreates only the demo accounts below, never anyone else's data.

| Account | Email | Username | Role in the demo |
| --- | --- | --- | --- |
| **Alex Morgan** (main) | `alex.morgan@example.com` | `@alex` (find-me name, not for login) | Six months of history, recurring items, installments, splits, three budgets |
| Sam Rivera | `sam.rivera@example.com` | `@sam` | Alex's partner; shares the **Home** budget |
| Jordan Morgan | `jordan.morgan@example.com` | `@jordan` | Alex's sister; has a pending invitation |
| Priya Nair | `priya.nair@example.com` | `@priya` | Friend; in the **Lisbon trip** budget, has invited Alex to **Book club** |
| Chris Walker | `chris.walker@example.com` | `@chris` | Has sent Alex a connection request (waiting) |
| Dana Lee | `dana.lee@example.com` | `@dana` | Alex has sent a request to Dana (waiting) |

Password for all of them: `Budget-Showcase#2026`

What Alex's account shows: a balance that is fine today but **projected to go negative** when the summer holiday
lands (the forecast warning), one **overdue** bill, payments **due in the next 14 days**, a **skipped** recurring
occurrence, a **paused** recurring item, **installment plans** (in progress, upcoming and completed), payments
**split** with Sam, Priya and Jordan, and payments others shared with Alex under **People → Shared with me**.
Alex's **Home** budget pools Alex's and Sam's income (per-member contribution bars, "paid by" on every payment),
**Lisbon trip** is a second shared budget with one invitation still pending, and the inbox holds one connection
request and one group invitation to answer. Alex and the friends have **profile pictures**, three payments have
**receipts** (images and PDFs), the **bell** has unread notifications, a few **alert rules** are set (an always-on rule
for the gym, a muted category, one single payment silenced) and Alex has a confirmed email with a daily summary turned on.
Log in as Sam or Priya to see the other side of the same data.

## Accounts and security

* **Sign up / sign in** at `/signup` and `/login`. Each account only ever sees its own payments, categories,
  recurring items, installments and settings (every query is scoped to the signed-in user).
* **Password format** (checked live in the form and enforced again on the server): at least 10 characters,
  with a lowercase letter, an uppercase letter, a number and a special character; at most 128 characters; not a
  very common password; must not contain the part of your email before the `@` or your first name.
* **Passwords are never stored.** Only a salted `scrypt` hash is kept. Login errors are deliberately generic
  ("Invalid email, username or password") and login/sign-up are rate-limited (15 attempts / 15 min per IP + what was typed; once the
  account is known, guesses are also counted against the account itself, so switching between its email and its username gives no extra attempts).
* **Sessions** are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (30 days, renewed while you use the
  app); only a hash of the token is stored in the database. Changing your password signs out all other devices.
  State-changing requests from another origin are rejected (CSRF protection). Set `COOKIE_SECURE=true` in
  `server/.env` when you serve the app over HTTPS.
* **Existing data:** if you used the app before accounts existed, the *first* account you create adopts that data.

### People, groups and privacy

* **Budgets ("workspaces").** Everyone has a private *Personal* budget. A *Group* is a separate shared budget with its
  own balance, categories, recurring items and settings; the switcher at the top of the sidebar (top bar on phones)
  changes which one you are looking at. Personal and group money never mix unless you add an entry yourself.
* **Finding people** works on the *exact* username, email or phone number only (no browsing or partial search), is
  rate-limited, and returns just a name and `@username`; your email and phone are never shown to anyone. Switch each
  way of being found on or off in **Profile**, or turn "Let people find me" off to disappear from search and disable
  your profile link.
* **Phone numbers must be in international format** (`+49 170 1234567`), because a local number cannot be matched reliably.
* **Phone numbers and email addresses are not verified** (there is no SMS/e-mail service behind this app). That is why a
  request always shows the person's name and `@username` and must be accepted by the other side. Check you have the
  right person before accepting or sending.
* **Groups:** only the owner invites (and only people they are connected with), invited people must accept, every
  member can add and edit payments, the owner can rename, remove members, transfer ownership or delete the group
  (which deletes its data for everyone). A member who leaves loses access; what they entered stays in the group.
* **Adding people to a payment:** only accepted connections (or fellow group members) can be added. Removing a connection
  stops sharing between the two of you. People you add only see description, date, amount and their own share.
* **Not included:** settling up / "who owes whom" tracking, and per-member permissions inside a group.
* **Email:** your address counts as confirmed once you open the link we email you (valid 24 hours, single use). Alerts are only
  ever sent to a confirmed address.
* **Terms, privacy, your data:** `/terms` and `/privacy` are public pages. Signing up needs the box ticked (the version and time are kept), and so does creating an account with
  Google; people who signed up before they existed see a one-time notice. **Settings, Account** has "Download my data" (a file with everything: profile, budgets and what is in them, connections,
  notifications; never a password, other members' e-mail addresses or the bytes of photos and receipts) and "Delete my account" (password, or a fresh Google sign-in for an account without a password, and
  the word DELETE; refused while you are an admin or share a budget with other people, and everything is removed at once). When the text changes, bump `TERMS_VERSION` in `server/src/lib/legal.js`
  so people are asked again.
* **Forgot your password:** the sign-in page links to a page that asks for the e-mail address and sends a link (valid one hour, works once, only the newest link works).
  The page says the same thing whether or not the address has an account. Choosing the new password signs the person out everywhere, tells them by e-mail and in the app,
  and does not sign them in. It needs a real mail server: **without `SMTP_HOST` on a server running in production the option stays hidden and the endpoints answer
  "not set up"**, because a link that is only saved in a folder reaches nobody. On your own computer the link is saved in `server/mail-preview`, so you can try it.

## Email alerts: setting up a mail server (optional)

Without any configuration the app runs in **preview mode**: nothing leaves the machine. Confirmation links are shown on screen
and every email it would send is written as an `.html` + `.txt` pair to `server/mail-preview/` so you can open it in a browser.
To send real email, put these in `server/.env` (any SMTP provider works):

| Variable | Meaning |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT` | mail server (port 587 STARTTLS is the default; 465 with `SMTP_SECURE=true`) |
| `SMTP_USER`, `SMTP_PASS` | login, if the server needs one |
| `SMTP_IGNORE_TLS` | `true` only for a local test server without TLS |
| `MAIL_FROM` | the From address, e.g. `Penny <alerts@example.com>` |
| `APP_URL` | the public address of this app (used for links in emails), e.g. `https://budget.example.com` |
| `ALERT_SCAN_MINUTES` | how often the server looks for new alerts (default 60; `off` turns the scheduler off) |
| `MAIL_PREVIEW_DIR` | where preview-mode emails are written |

How alerts work: every hour (and when someone opens **Notifications → Check now**) the server looks at each person's pending
payments in every budget they belong to, applies their alert rules in *their own* time zone, and creates one notification per
payment per due date (so nothing repeats). Overdue and due-soon alerts resolve themselves when the payment is paid, moved or
deleted. Email is a second step: a daily summary at the chosen hour, or (instant mode) one email shortly after something new appears.

## Google sign-in (optional)

The "Continue with Google" button creates an account the first time and signs you in afterwards. It stays
hidden until you give the server a Google OAuth client ID (free; takes about 5 minutes):

1. Open the [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your e-mail. While
   the app is in *Testing*, add the Google accounts that should be able to sign in under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
4. Under **Authorised JavaScript origins** add every address you open the app on, for example
   `http://localhost:3001` and `http://localhost:5173` (and `http://127.0.0.1:5173` if you use that).
   You do **not** need redirect URIs and you do **not** need the client secret.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) into `server/.env`:
   ```
   GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
   ```
6. Restart the server. The Google button now appears on the sign-in and sign-up pages.

How it behaves: the browser gets a signed ID token from Google, the server verifies it (signature, audience =
your client ID, e-mail verified) and then starts a normal session. If an account with that e-mail already exists
with a password, Google sign-in will *not* silently take it over: sign in with the password, then use
**Settings → Account → Connect Google**.

## API (all under `/api`; everything except `/health` and the public `/auth` calls needs a signed-in session)

| | |
| --- | --- |
| `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | account + session. `login` takes `{identifier, password}` where `identifier` is an email address or a username (a leading `@` is ignored); the older field name `email` still works |
| `POST /auth/google`, `POST /auth/google/link`, `DELETE /auth/google` | Google sign-in/up, connect, disconnect |
| `PUT /auth/password` | change (or, for Google-only accounts, set) password |
| `GET /auth/username-available?u=` | is this username free? |
| `PUT /profile` | name, username, phone, who can find you |
| `GET /people/lookup?q=` · `GET /people/:username` | find someone (exact username / email / phone) · profile card |
| `GET/POST /connections` · `POST /connections/:id/accept\|decline` · `PUT/DELETE /connections/:id` | connection requests and connections |
| `GET /inbox` | waiting requests, group invitations, shared payments |
| `GET/POST /workspaces` · `PUT/DELETE /workspaces/:id` | your budgets / create a group, rename, delete |
| `POST /workspaces/:id/invites` · `GET /workspaces/:id/invites` · `DELETE /workspace-invites/:id` | invite connections / cancel |
| `POST /workspace-invites/:id/accept\|decline` | answer an invitation |
| `POST /workspaces/:id/leave\|transfer` · `DELETE /workspaces/:id/members/:username` | membership |
| `GET /shared` · `POST /shared/:id/import` | payments shared with me / add my share to the open budget |
| `PUT/DELETE /profile/avatar` · `GET /avatars/:id` | profile picture (raw image body, max 512 KB) / remove / view |
| `GET/POST /transactions/:id/receipts` · `DELETE /receipts/:id` · `GET /receipts/:id[?download=1]` | receipts of a payment (raw body, `X-Filename` header, max 5 MB) |
| `GET /notifications` · `GET /notifications/summary` · `POST /notifications/refresh` | list (`status`, `kind`, `before`, `limit`) · unread count · check for new alerts now |
| `POST /notifications/read-all` · `DELETE /notifications` · `POST/DELETE /notifications/:id[/read|unread]` | mark read/unread, delete (clear read ones) |
| `GET/PUT /notifications/settings` | which alerts, lead days, pause, browser alerts, email on/off + frequency + hour + time zone |
| `POST /notifications/test-email` · `GET /notifications/emails` | send yourself a test email · recent emails |
| `GET /alerts/upcoming` · `GET /alerts/overrides` · `PUT/DELETE /alerts/:type/:id` | payments with their alert rule · all your rules · set (`{mode:'on'|'off', days}`) or remove a rule for a `transaction`, `recurring`, `installment` or `category` |
| `POST /auth/email/send-verification` · `POST /auth/email/verify` | confirm your email address |
| `POST /unsubscribe` (public) | one-click unsubscribe from the link in every email |
| `GET /insights` · `POST /insights/:key/dismiss` · `DELETE /insights/:key/dismiss` · `DELETE /insights/dismissed` | the assistant's insights, month summary and comparison numbers for the open budget · dismiss / undo / restore all |
| `POST /assistant/ask` `{question}` | answer a typed question from the ledger: `{intent, answer, blocks, follow_ups, link}` (40 a minute) |
| `GET/PUT/DELETE /preferences` | dashboard layout, density, accent, sidebar, pins, avatar style (validated; each key replaced as a whole) |
| `GET /presence` | who of your connections / budget members is active right now (if they allow it) |

Budget routes below act on the budget named by the `X-Workspace` header (or `?ws=`); without it they use your personal budget.
Membership is checked on every request. `paid_by` (username) and `participants` (`[{username, share}]`) are accepted on payments.
| `GET/PUT /settings` | starting balance, currency, `card_pay_day` (1 to 28, default 10; left out on `PUT` = unchanged) |
| `GET/POST/PUT/DELETE /categories` | categories |
| `GET /transactions?month=YYYY-MM&status=&type=&pay=&bought=1&category_id=&q=` | list (`status`: pending, paid, overdue, skipped; `pay`: credit_card, cash). A payment is listed in the month of its `date`, which for a card payment is the day the card bill is paid. With `bought=1` the card payments *bought* in that month are listed too, flagged `purchase_only: true` (the Payments page uses this; nothing else does, so totals and the forecast still go by the day the money leaves) |
| `POST /transactions`, `PUT /transactions/:id` | create / update. Optional `pay_method` (`cash` or `credit_card`) and `charged_on` (the purchase day). For a credit card payment `date` is the day the bill is paid; it must be an expense and `charged_on` may not be after `date` (default: `date`). On `PUT`, leaving `pay_method` out keeps the current one |
| `PATCH /transactions/:id/status` | `{status: 'paid'｜'pending'｜'skipped'}` |
| `DELETE /transactions/:id` | delete (recurring occurrences are skipped; `?hard=1` deletes) |
| `GET /transactions/export.csv` | CSV, same filters (columns include `paid_with` and `bought_on`) |
| `GET/POST/PUT/DELETE /recurring` | recurring rules. End with `end_date` or `ends_after` (a number of payments, 1 to 600; the server works out the date). Not both |
| `GET/POST/PUT/DELETE /installments` | installment plans |
| `GET/POST/PUT/DELETE /debts` | debts: `{name, total_amount, plan: none\|once\|monthly, first_due_date, installment_count, count_in_budget, category_id, note, paid_by, direction: owe\|lent, record_loan?, lent_on?}`. `direction` is chosen when adding and cannot change; `lent` means someone owes you, so repayments are income, and `record_loan` also adds the money handed over (source `loan`). `GET` returns `{debts, totals, lent_totals}` (`totals` is what you owe, `lent_totals` is `{owed_to_me, counted, expected, received}`); saving rebuilds the unpaid payments from what is still owed |
| `GET /admin/overview` · `/admin/users?q=&status=&sort=&page=` · `/admin/users/:id` · `/admin/events?kind=&user_id=&page=` · `/admin/system` · `POST /admin/users/:id/suspend` `{reason?}` · `/unsuspend` · `/sign-out` · `/view-as` `{reason, password, read_only}` · `DELETE /admin/users/:id` `{confirm: username}` | the admin dashboard, **admins only** (404 for everyone else); accounts and service health only, never a payment, amount or note |
| `POST /debts/:id/payments` `{amount, date?, note?}` · `POST /debts/:id/settle` · `POST /debts/:id/reopen` | record a payment (at most what is owed) / settle by hand / open again |
| `GET /summary?month=YYYY-MM` | dashboard numbers |
| `GET /forecast?months=12&past=3&estimateExpenses=1&estimateIncome=0` | forecast |

## Layout

```
server/src   index.js · db.js · schema.sql · routes/ · lib/ (dates, schedule, forecast, materialize, notifications, alerts, mailer)
server/test  unit tests for the pure logic
client/src   pages/ (older screens) · layout/ (sidebar, top bar, bottom bar) · dashboard/ (page, widgets, charts)
             assistant/ · command/ (palette, fuzzy search) · notifications/ · components/ (ds/ = tooltip, menu, sheet, states)
             design/ (tokens, base, components, shell, dashboard, assistant CSS) · prefs.jsx · quick.jsx
e2e          browser checks (puppeteer-core)
Dockerfile · docker-compose.yml · .env.docker.example   run the whole app (and its Postgres) in containers
deploy/ · docker-compose.prod.yml                        the live server: HTTPS web server, one-time server setup, update script, settings template
penny.ps1 · penny.cmd                                   the command file: `.\penny up`, `down`, `dev`, `backup`, ... (add your own)
docs         DESIGN.md · brand/ (the original wordmark artwork)
client/public favicon, app icons, manifest, standalone wordmark SVGs (generated by scripts/make-brand-assets.cjs)
scripts      pg-local.ps1 (start/stop the local Postgres) · make-brand-assets.cjs (redraw the favicon and app icons)
```
