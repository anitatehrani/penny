# Design brief: "Ink & Signal"

## 1. What is wrong with the current dashboard

| Problem | Why it hurts |
| --- | --- |
| Every block is the same bordered rectangle. | Nothing says what matters. The balance, a payment list and a bar list have equal weight. |
| Information is only ever *shown*, never *interpreted*. | The user has to notice for themselves that spending is up or that February goes negative. The numbers are all there; the meaning is not. |
| Charts are decoration next to lists. | The category bars and the balance chart do not talk to each other. Hovering something does not reveal anything. |
| The shell is generic. | A flat sidebar, a bell, and nothing that reflects *you* (no avatar menu, no search, no quick actions). |
| No personalisation. | Everyone gets the same page in the same order. |
| Weak states. | Loading is a grey box, errors are a red banner, a brand-new account sees empty cards. |
| Type and colour are system defaults. | The product has no recognisable voice. |

## 2. Direction

**Ink & Signal.** The page is a quiet ledger (warm paper, ink-black type, hairline rules, tabular figures) and *signals* appear on it only when there is something worth saying.

* **Ledger, not dashboard.** Open sections divided by rules instead of boxes everywhere. Only the hero and the chart sit on raised surfaces.
* **Numbers are the typography.** Geist Mono tabular figures for every amount and small-caps mono labels (`BALANCE`, `NEXT 14 DAYS`). Geist for prose.
* **Intelligence through behaviour.** No sparkle icons, no gradients. The assistant is a thin *signal* rule (indigo) beside a sentence that is computed from your data: what changed, why it matters, what you could do, and a way to ask more.
* **Context decides what is visible.** A warning appears only if there is something to warn about; secondary detail appears on hover/expand.

### Palette (semantic, not decorative)

| Role | Light | Dark | Used for |
| --- | --- | --- | --- |
| Paper / surface | `#f5f4ef` / `#fcfbf8` | `#111210` / `#191a18` | canvas, raised panels |
| Ink | `#15171a` | `#f1f1ec` | text |
| Accent (user choice) | blue `#1f5fc4` default | `#6ea4f2` | actions, focus, active nav |
| Positive | `#0b7a53` | `#4fcf9b` | money in, on-track |
| Caution | `#9a5b00` | `#f0b95a` | upcoming, watch |
| Negative | `#c4302b` | `#ff7b78` | money out beyond means, overdue |
| Forecast | `#0e7490` (dashed) | `#53c4dc` | anything predicted, never a solid line |
| Signal (assistant) | `#5450c4` | `#a9a6f7` | assistant insights only, used for a 2px rule and a label |

Colour is never the only carrier: negative amounts get a minus sign, warnings get an icon and a word, forecasts are dashed.

### Design tokens

Defined once in `client/src/design/tokens.css` and consumed everywhere.

* **Type:** Geist (sans) / Geist Mono (figures, labels). Scale 12 / 13 / 14 / 15 / 18 / 22 / 30 / 44. Weights 400, 500, 600.
* **Space:** 4-pt scale `--s-1 … --s-8` (4, 8, 12, 16, 24, 32, 48, 64).
* **Radius:** `--r-1` 6 (chips, inputs), `--r-2` 10 (panels), `--r-3` 14 (dialogs, menus). No pill-shaped containers except badges and switches.
* **Elevation:** three levels only: `flat` (hairline), `raised` (hairline + 1px shadow), `float` (menus, dialogs).
* **Motion:** `--t-fast` 120 ms, `--t-base` 180 ms, `--t-slow` 260 ms, one easing curve; everything off under `prefers-reduced-motion`.
* **Icons:** 16 / 18 / 20 px, 1.75 stroke, one icon set.

### Components (one implementation each)

`Panel`, `Section` (open, ruled), `Stat`, `Badge`, `Button`/`IconButton`, `Switch`, `Tooltip`, `Menu` (popover), `Sheet` (side panel / bottom sheet), `Skeleton`, `EmptyState`, `ErrorState`, `Avatar`, `PaymentRow`, `AIInsightCard`.

## 3. Information architecture of the new dashboard

```
TopBar      [collapse]  search / command (⌘K)      Ask  ·  bell  ·  avatar menu
Hero        Balance (hover = how it is made up)  +  month-end projection  + cash-flow chart
Insights    0–2 assistant insights (dismissible, expandable, ask-follow-up)   [only if any]
Left col    Next 14 days (quick actions on hover)        Right col  Spending (donut ↔ list linked, vs last month)
Below       Recurring & subscriptions · Balance outlook (history + forecast overlay)
```

Widgets can be reordered, hidden and resized (S / M / L) from a single "Customise" mode; density (comfortable / compact), accent colour and sidebar state are remembered per user.

## 4. Assistant: what it is and is not

The assistant is a **rules-and-statistics engine running on this server**. It reads the user's own ledger, computes comparisons and projections, writes sentences from templates, and answers a fixed set of question types ("How much did I spend on groceries?", "Will I go negative?", "What are my subscriptions?"). It is *not* a large language model, and no financial data leaves the server. The UI says so. It can be swapped for an LLM later behind the same `POST /api/assistant/ask` contract.

## 5. Backend changes (defined before implementation)

### Tables / columns

| Change | Purpose |
| --- | --- |
| `user_preferences(user_id PK, data jsonb, updated_at)` | dashboard layout, density, accent, sidebar state, favourites |
| `insight_dismissals(user_id, workspace_id, insight_key, dismissed_at)` | dismissed insights stay dismissed (keys include the month, so a new month starts fresh) |
| `users.last_seen_at`, `users.show_status` | optional presence ("Active now") for connections and budget members; can be switched off |
| `notification_settings`: `forecast_warning`, `ai_insights`, `weekly_summary`, `monthly_summary`, `security_alerts`, `email_forecast`, `email_ai`, `email_weekly`, `email_monthly`, `email_security`, `weekly_day`, `last_insight_on` | new notification types, their email switches, summary weekday, once-a-day insight scan marker |
| Existing `forecast_warning` is back-filled from `balance_warning` once, so nobody is surprised | migration safety |

### New notification kinds

`forecast_warning` (projected negative), `ai_insight`, `summary_weekly`, `summary_monthly`, `security`. Old `balance_warning` now means *currently* below zero only.

### Endpoints

| Endpoint | Scope | Description |
| --- | --- | --- |
| `GET /api/insights` | budget | `{ insights[], summary, compare, dismissed }` computed from the ledger |
| `POST /api/insights/:key/dismiss` · `DELETE /api/insights/dismissed` | budget | hide one insight / bring them all back |
| `POST /api/assistant/ask` `{question}` | budget | `{ intent, answer, blocks[], follow_ups[], link }` |
| `GET /api/preferences` · `PUT /api/preferences` | user | validated, merged per top-level key |
| `GET /api/presence` | user | `{ username: { online, last_seen } }` for people the caller may see |
| `PUT /api/profile` (+`show_status`) | user | opt out of presence |
| `GET/PUT /api/notifications/settings` (+new fields) | user | as above |

Everything else (payments, forecast, summary, recurring, people, uploads) is reused unchanged.

## 6. Credit card payments (defined before implementation)

**The need.** Some purchases go on a credit card on one day (1 Oct) and the money only leaves the account when the card bill is
paid (10 Nov). They must be recorded on the day they were bought, marked as credit card, and counted in the month the bill is paid.

**The model.** A card purchase is an ordinary expense with two extra facts. `date` keeps its meaning, *the day the money leaves the
account*, so the balance, forecast, month totals, due and overdue alerts and insights all stay correct without any change. New:
`charged_on`, the purchase date, and `pay_method`.

| Change | Purpose |
| --- | --- |
| `transactions.pay_method` `'cash'` (default) or `'credit_card'` | which way it was paid |
| `transactions.charged_on date` | purchase date; set only for credit card payments, never after `date` |
| check: credit card means an expense with a `charged_on` on or before `date`; cash means no `charged_on` | the database refuses inconsistent rows |
| `workspace_settings.card_pay_day` 1 to 28, default 10 | the day of the month the card bill is paid, used to suggest the pay date |

Existing rows are untouched (`cash`, no `charged_on`).

| Endpoint | Change |
| --- | --- |
| `POST /api/transactions`, `PUT /api/transactions/:id` | optional `pay_method`, `charged_on`. A credit card payment must be an expense; `charged_on` defaults to `date`; a `charged_on` after `date`, or on a cash payment, is a 400. On `PUT`, leaving `pay_method` out keeps the current one. |
| `GET /api/transactions` and `/export.csv` | new filter `pay=credit_card` or `pay=cash`; rows carry `pay_method` and `charged_on`; CSV gains `paid_with` and `bought_on` |
| `GET /api/settings`, `PUT /api/settings` | `card_pay_day` (optional on `PUT`, kept if left out) |

Not changed: recurring items and installment plans (cash only), the forecast and summary queries (they already read `date`).

**Interface.** In the payment form, an expense can be switched to "Paid with credit card". The date field then reads "Bought on", and a
"Counts in" month list (default: the month after the purchase) sets when the bill is paid, on the budget's card pay day. Rows show a
"Credit card" badge and "bought 1 Oct"; the Payments page can filter by credit card and shows the card total for the month.

## 7. Moved recurring payments no longer come back (bug fix, defined before implementation)

**The bug.** A recurring item turns into real payments ahead of time, and the app tops them up at every start and every six hours.
To avoid duplicates it relied on a unique `(recurring_id, date)`. If someone moved one occurrence to another day (rent on the 14th instead
of the 10th), the 10th became "free" and the top-up created it again, so the rent was counted twice.

**The fix.** Remember which schedule slot a generated payment belongs to, separately from the day it is paid.

| Change | Purpose |
| --- | --- |
| `transactions.occurrence_date date` | the scheduled day a recurring payment was generated for; it never changes when the payment is moved. Null for manual and installment payments |
| backfill `occurrence_date = date` for existing recurring payments | existing rows keep working (a payment that was already moved *and* regenerated before this fix has to be tidied by hand) |
| unique `(recurring_id, occurrence_date)` replaces unique `(recurring_id, date)` | the top-up skips slots that exist, whatever day they were moved to; two occurrences may now be moved to the same day |

No endpoint changes. Editing the recurring item itself still regenerates its unpaid payments from this month, as before; skipped ones stay skipped.

## 8. Debts (defined before implementation)

**The need.** Money you owe someone (a friend, a loan) that is not a purchase on a card or an installment plan. It should be recorded
now, repaid in one chosen month or split over several months, or just kept on file until a plan is made, and the person decides
whether it counts in their budget.

**The model.** A debt is a named amount owed. Its repayments are ordinary expense payments (`source = 'debt'`), so the balance, forecast,
month totals, due and overdue alerts and the Payments page work without any change.

| Choice | Meaning |
| --- | --- |
| Plan `none` ("not scheduled yet") | the debt is on file; no payments exist |
| Plan `once` | one payment of what is still owed, on `first_due_date` |
| Plan `monthly` | `installment_count` equal monthly payments of what is still owed (cents split exactly, the extra cents on the first ones), from `first_due_date`, on the same day each month |
| Count in my budget ON | the scheduled payments exist as pending payments (forecast, balance projection, alerts); the debt is part of "balance after debts" |
| Count in my budget OFF | tracked only: the plan is remembered and shown, but **no payments are created**, so nothing changes in the balance or the forecast |

Money actually paid always counts: marking a scheduled payment paid, or recording an extra payment, is a real payment.

| Change | Purpose |
| --- | --- |
| `debts(id, workspace_id, user_id, member_id, name, total_amount, note, category_id, plan, first_due_date, installment_count, count_in_budget, settled_at, created_at)` | the debt and its plan; checks keep the plan consistent (`none`: no date or count; `once`: a date; `monthly`: a date and 2 to 120 payments) |
| `transactions.debt_id` (to `debts`, set null on delete) and `source = 'debt'` | links a repayment to its debt |

Computed for every debt: `paid` (its payments marked paid), `remaining` (total less paid, never below 0), the pending scheduled payments
(`scheduled_total`, `scheduled_count`, `next_due`, `next_amount`) and `status` (`active` or `settled`: settled by hand, or nothing remaining).

| Endpoint (budget scope) | Description |
| --- | --- |
| `GET /api/debts` | `{ debts[], totals }` with `owed`, `counted`, `scheduled`, `paid` |
| `POST /api/debts`, `PUT /api/debts/:id` | create / replace. Saving rebuilds the unpaid schedule from what is still owed; paid payments stay |
| `DELETE /api/debts/:id` | removes the unpaid payments; paid ones stay in the history |
| `POST /api/debts/:id/payments` `{amount, date?, note?}` | record a payment now (at most what is still owed); the unpaid schedule is re-split over the remaining amount |
| `POST /api/debts/:id/settle`, `POST /api/debts/:id/reopen` | close a debt by hand (removes unpaid payments) / open it again |

In the interface: a Debts page (progress, plan, "in your forecast" or "not counted", record a payment, settle), a "Debt" badge on repayments,
"Add debt" in the command palette. Debts are money you owe; money owed *to* you is not covered.

## 9. Recurring items: a clear ending (defined before implementation)

Recurring items already store an optional `end_date`, but the form only had an unexplained date box. The form now asks "Ends": never, on a
date, or after a number of payments, and shows the last payment. For the last choice the API accepts `ends_after` (1 to 600) instead of
`end_date`, and works out the date of that payment from the schedule. Giving both is a 400. No table changes.

## 10. Signing in with an email or a username

`POST /api/auth/login` takes `{ identifier, password }`. `identifier` is an email address or a username; a leading `@` and surrounding
spaces are ignored and case does not matter. Anything containing an `@` (after that) is treated as an email and must be a valid address;
anything else is looked up as a username. The old field name `email` still works and may hold either. No table changes (usernames are
already unique, case-insensitively).

Nothing about what the server reveals changes: a wrong password, an unknown username and an unknown email all give the same 401
("Invalid email, username or password") and take the same work. Guesses are limited per IP and what was typed (as before), and now also
per account once it is found, so alternating between a person's email and username does not double the attempts.

## 11. Credit card purchases are also listed in the month they were bought (defined before implementation)

**The problem.** A card purchase is stored with `date` = the day the bill is paid, and the monthly Payments list filters on `date`, so a
purchase made on 1 October appeared only under 10 November. Someone who writes "1 October: Klarna 71" expects to see it on the 1st.

**The change.** `GET /api/transactions?month=YYYY-MM&bought=1` also returns the credit card payments *bought* in that month whose bill is
paid in another month, each marked `purchase_only: true`. Rows whose `date` is in the month come back as before (`purchase_only: false`),
and a purchase whose bill falls in the same month is listed once. Without `bought=1` nothing changes, so the dashboard, forecast, summary,
alerts and CSV export keep counting by the day the money leaves.

In the Payments page the "All" view sends `bought=1`. A purchase-only row is shown on its purchase day with "Credit card · counts on
10 Nov", has no pay button or alert bell, and is left out of the month's income, expenses and net; the strip shows it as "Bought on
card". The month the bill is paid shows the same payment as usual, counted. The "to pay", "paid" and "overdue" views do not add them.

## 12. A month calendar, and a month view on the dashboard (defined before implementation)

**The need.** Jump straight to any month instead of clicking arrows, on the dashboard and in "Counts in" for a credit card payment.

**The month calendar** is one component with two forms: a button that opens a small popup (a year with arrows and twelve month buttons, the
current month ringed, out-of-range months greyed out with a reason), and the same grid shown inline. It is keyboard-operable (arrows
move between months, Page Up/Down change the year, Home/End, Enter/Space choose, Escape closes without closing a dialog it sits in) and
works on a phone as a bottom sheet. It is used in the Payments month navigator (any month), the dashboard header (12 months back to 24 ahead,
the range the forecast can cover), and inline in the payment form, where only months a card bill can fall in are enabled.

**The dashboard month view.** The month is in the address (`/?month=2027-02`), so it can be linked and the back button works; no month
means this month and nothing changes. For another month:

| Widget | Shows |
| --- | --- |
| Balance | the balance at the end of that month (actual for a past month, projected for a future one), its income, expenses and net, and the arithmetic from the start of the month; the chart marks the month |
| Spending | the month's spending by category against the month before |
| Cash flow | the months around it, with that month's net |
| Coming up | becomes "In {month}": every payment of that month, including card purchases bought in it |
| Insights | hidden: the assistant is about today |
| Recurring | unchanged (commitments are not tied to a month) |

A banner says which month is shown and has "Back to this month". Everything is built from endpoints that already exist (`/summary?month=`,
`/forecast?past=&months=`, `/transactions?month=&bought=1`); there are no server changes.

## 13. Payment filters: styled dropdowns with search (defined before implementation)

**The need.** The filters on the Payments page were the browser's own menus: plain, no way to type to find a category, and no sign of which
filters were switched on.

**What changes.** The type, paid-with, category and member filters (member only in a shared budget) become one component, `FilterSelect`:

- a button with an icon that shows the current choice; when something other than "all" is chosen the button is tinted, so the active filters
  can be seen at a glance, and a **Clear filters (n)** button appears (the month and the status chips are always visible, so they are not counted);
- a popup list (drawn outside the page so nothing clips it, flips above the button when there is no room below, a bottom sheet on a phone);
- with more than seven options the popup starts with a **search box**: type to narrow the list (capitals and accents ignored, every word
  typed must match the name or its group), arrows move, Enter chooses, Escape closes and returns focus to the button;
- categories are grouped under Expenses and Income and show their colour; people show their avatar; the chosen option has a tick;
- the search box for descriptions and notes gets an icon and a clear button, and sits first in the row.

Choosing writes to the address as before (`?category=3&type=expense`), so a filtered list can be linked. The matching and keyboard rules are
plain functions in `client/src/filterLogic.js` so they can be tested without a browser. Nothing changes on the server.

## 14. Clearer balance card, forecast page and debts (design pass)

**What was wrong.** The balance figure sat at the bottom of an empty block beside its chart; two charts on the forecast page were an older
design than the dashboard's, with a browser dropdown and checkboxes; months with the same name in a range longer than a year (two
Octobers) shared one place on the chart axis, which squashed the months and hid the "dips below zero" marker; the progress bar on a debt
was almost invisible.

**What changed.**

- The balance is a card as tall as its chart, with a one-line status under the figure answering "will I be all right?": *Below zero today*,
  *Dips below zero in {month}*, or *No dip ahead, lowest {amount} in {month}*. It is worked out from the forecast by `outlook()` in
  `monthLogic.js` (months already behind us are ignored; exactly zero is fine).
- The chart axes are keyed on the whole month (`2027-10`), only the printed label is short, so every month has its own place whatever the
  range. The dip label sits beside its marker instead of on the line.
- The forecast page uses the dashboard's charts, a segmented "Look ahead" (3 months, 6 months, 1 year, 2 years) and two switches for the
  estimates, each with a sentence saying what it does.
- A debt shows a visible progress bar with the percentage paid, and the "·" before the person's name no longer collides with the text.

## 15. Debt repayment timeline (defined before implementation)

**What was missing.** A debt card shows how much is paid and the next payment, but not the road to zero: which payments are done, which
is next, when the last one lands, and whether anything is still unplanned. The user had to open Payments to piece it together.

**What it is.** Each debt card gets a "Repayment timeline" that opens in place (a native `<details>`, closed by default, so the page stays
short). It is a vertical rail, one step per payment, in date order:

| State | Mark | Meaning |
| --- | --- | --- |
| `paid` | check | a payment marked paid (a scheduled one, or one recorded by hand) |
| `overdue` | red ring | a pending payment whose day has passed |
| `next` | filled dot | the first pending payment that is not overdue |
| `later` | empty circle | pending payments after it |
| `open` | dashed circle | the part of what is owed that no payment covers yet ("Not scheduled yet") |

Each step shows the date, the amount and a state word (not colour alone). The rail ends with "Debt-free" and the date of the last planned
payment, but only when the planned payments cover everything still owed; otherwise the `open` step comes last.

**Where the data comes from.** `GET /api/debts` adds `payments[]` to every debt: `{ id, date, amount, status, installment_no }` for its paid
and pending payments (skipped ones are left out), oldest first. The steps are worked out by `timelineSteps(debt, today)` in
`client/src/debtLogic.js`, a plain function, so it is tested without a browser. Nothing else about debts changes.

**Look.** The visual idea (rail, mark, date beside a state word) follows a timeline from the 21st.dev catalog; it is drawn in Penny's own
CSS tokens (`client/src/design/pages.css`), not copied, because the app does not use Tailwind. It works in light and dark, wraps on a phone,
and is keyboard operable and announced as an ordered list.

## 16. Payment rows: what is left to do stands out (defined before implementation)

**What was wrong.** Every payment row looked the same weight. A paid rent and an unpaid, overdue gym fee differed only by a button label and a
small badge, so scanning for "what do I still have to pay?" meant reading every row. Overdue was said twice (a red "2 days overdue" under the
date and an "Overdue" badge). Four small icon buttons (reminder, receipt, edit, delete) sat at full strength on every row.

**What changes** (look only; no data, route or behaviour changes):

| Row state | Left edge | Text |
| --- | --- | --- |
| overdue (pending, day passed) | red 3px strip | normal; "N days overdue" under the date stays red |
| pending | none | normal |
| paid | green 3px strip | title, date and amount one step softer, so unpaid rows read first |
| skipped | none | as before (struck through) |

- The "Overdue" badge goes; the strip and the red "N days overdue" say it, in words as well as colour.
- The secondary icon buttons (reminder, receipt, edit, delete) are quieter until the row is hovered or has focus, **only where the device
  has a hover-capable fine pointer**. On a phone or tablet they stay at full strength, and they are never hidden: keyboard focus on any
  button in the row brings them all up (`:focus-within`). The main "Mark paid" / "Paid" button is always full strength.
- The strip is an inset shadow, so no grid column changes and the dashboard's compact rows, the People page and recurring rules keep their
  layout. Skipped and "purchase-only" card rows are untouched.

**Look.** The idea (a status edge plus quiet row actions, as in the status tables in the 21st.dev catalog) is drawn in Penny's own tokens in
`client/src/design/rows.css`. The state is a class on the row (`is-paid`, `is-overdue`) set in `TxRow.jsx` from `rowState()` in
`client/src/cardLogic.js`, a plain function, so it is tested without a browser.

## 17. Recurring: what each item costs a month (defined before implementation)

**What was wrong.** The list says *how often* each item repeats ("Every 3 months on the 15th", "Yearly on 4 May") but not what it means for
a normal month, so a yearly insurance and a monthly rent cannot be compared by eye. The page header gives only the three totals, with
no way to see which item is behind them.

**What changes** (look only; the routes, data and form are untouched):

- Every active item shows **its monthly equivalent** in words: "about €121.00 a month", and "a month" is the average (a weekly item counts
  52 / 12 weeks, a yearly one a twelfth). A paused item shows no figure, because it is not counted.
- Under it, a slim **share bar** shows that item's part of all active items *of the same kind* (expenses against total commitments,
  income against total income), with the percentage in words next to the figure ("34% of commitments", "80% of income"). The bar is decoration
  only (`aria-hidden`); the words carry the meaning.
- The summary strip's totals and the rows use one function, `monthlyEquivalent(rule)` in `client/src/recurrenceLogic.js`, instead of the
  sum being worked out inline on the page, so the two cannot disagree. It is a plain function, so it is tested without a browser.
- A row that ends gets a quiet "Ends {date}" as before; nothing else about ending changes.

**Look.** Drawn in Penny's tokens in `client/src/design/rows.css`, in the spirit of the share-of-total list rows in the 21st.dev catalog.
It works in light and dark, wraps on a phone, and adds no controls.

## 18. Installments: one step per payment (defined before implementation)

**What was wrong.** A plan showed one smooth bar and "3 of 6 paid". The bar could not tell you *which* payment is next, what each one is, or
when the last one lands, so those had to be found on the Payments page.

**What changes** (look only; no server change, the page already has `installment_count`, `first_due_date`, `total_amount`, `paid_count` and `next_due`):

- The bar becomes a **step track**: one segment per installment, filled for the ones paid, outlined for the one due next, empty for the
  rest. Past 24 installments the segments would be hair-thin, so a plan that long keeps the continuous bar.
- The sentence under it adds **what each one is and when the plan ends**: "3 of 6 paid · about €120.00 each · the last one is on 10 March
  2027". A finished plan says "Finished on 10 March 2027".
- The track is `role="progressbar"` with the same label as before ("3 of 6 installments paid"); the segments themselves are `aria-hidden`.
- `planFacts(plan)` in `client/src/installmentLogic.js` works out the segments, the share paid, the average payment and the last due date.
  The last due date uses the same month-by-month rule as the server's schedule (`installmentDates`), and a test checks they agree.

**Look.** Drawn in Penny's tokens in `client/src/design/rows.css`, after the segmented step indicators in the 21st.dev catalog. Works in
light and dark, wraps on a phone, adds no controls.

## 19. Dashboard: a "Paying off" widget, and the same row language (defined before implementation)

**What was missing.** Debts and installment plans appeared nowhere on the dashboard, so the answer to "how far along am I with what I owe?"
needed three clicks. The "Coming up" rows still had the double overdue signal that Payments lost in section 16, and the Recurring widget
kept its own copy of the monthly-equivalent sum that section 17 moved into one function.

**What changes.**

- **New widget `paying` ("Paying off", eyebrow "Debts and plans")**, a seventh widget. It lists up to five *active* debts and installment
  plans, overdue first, then by next payment, then those with nothing scheduled. Each row: the name, a progress track (a step track for
  an installment plan with up to 24 steps, as in section 18; a continuous bar for a debt), "{paid} of {count} paid" or "{pct}% paid", and
  the next payment ("Oct 10 · €166.67", "Overdue since Sep 10", "Nothing scheduled yet", "Not counted"). The lead line says what is still
  to pay **in your budget**: counted debts plus installment plans (debts with "count it in my budget" off are listed, tagged "Not counted",
  but left out of that figure, exactly as the Debts page's "Counted in your budget" does). Links go to Debts and Installments.
- **Empty:** no active debts or plans shows a calm empty state with links to add one.
- **Layout.** Like every widget it can be moved, resized (default medium), hidden and collapsed. `normalizeLayout` already appends a new
  widget to an old saved layout at the end, so nobody's saved dashboard hides or loses it; "Reset layout" places it after Recurring.
  The server's list of known widgets (`preferences.js`) gains `paying`, or saving a layout that contains it would be rejected.
- **Month browsing.** The widget is about today, like Recurring; it shows the same thing when another month is chosen.
- **"Coming up" rows** get the overdue edge (a red strip on the row's left) and lose the "Overdue" badge; "N days overdue" under the date
  stays, in words and red.
- **Recurring widget** calls `monthlyEquivalent()` instead of its own copy. The figures do not change.

**Where the logic is.** `payingOff(debts, plans, today)` in `client/src/payingOffLogic.js` picks, orders and describes the rows and works
out the lead figure. A plain function, so it is tested without a browser. No new server route: the page reads `GET /api/debts` and
`GET /api/installments`.

## 20. One dropdown everywhere (defined before implementation)

**What was wrong.** The Payments filters use Penny's own dropdown (`FilterSelect`: a rounded popup with a search box for long lists,
coloured category dots, people's pictures, a bottom sheet on a phone). Every *form* still used the browser's built-in `<select>`: a plain
grey list that ignores the theme, shows no category colours and looks different on every browser and phone. Sixteen of them remained.

**What changes** (look and feel only; the values, labels and what gets saved are unchanged):

- `FilterSelect` gets a `variant`: `filter` (as before), `field` (looks like the other inputs in a form: full width, same height,
  never tinted as "active"), and `inline` (compact, for a table cell or a line of text). It also accepts `disabled` and `id`, so a
  form label can point at it. `components/ds/Select.jsx` is the form-facing name: `<Select label value onChange options />`, where
  `onChange` gets the chosen value as a string, exactly like the native element did.
- All 16 native dropdowns are replaced: category, status, "paid by" (with the person's picture), repeats, alerts, currency, the
  weekly-summary day, the e-mail hour, a category's alert setting, the notification filter and per-payment alert, a connection's
  relationship, and the invite picker. Categories show their colour dot and, in a long list, a search box.
- Keyboard and screen readers work as in the filters: Arrow keys move, Enter chooses, Escape closes the list without closing the
  dialog it was opened from, and the control is a button announced as "{label}: {chosen}" with a listbox.

**Where the code is.** `CategorySelect` in `ui.jsx` keeps its props and builds its options from the categories. The pure option
logic stays in `filterLogic.js`, already tested.

## 21. Carrying what is left over into the next month (defined before implementation)

**What was wrong.** December ended at +€645.00 (income less expenses), but January's list and totals started from zero, as if that money
did not exist. The running balance already includes it (it is the sum of everything), so nothing was lost, but the month's own screen did
not say "you start January with €645.00 left from before".

**The rule.** A month's *left over* is what remains after its own payments *and* what was carried into it:

```
carried into month M   =  leftover(M − 1)
leftover(m)            =  max(0, carried into m  +  income(m) − expenses(m))
```

- It starts at the budget's first month with any payment, with nothing carried in. The starting balance is **not** part of it: that
  money is already the opening of the running balance and is not "left over from a month".
- Income and expenses are counted exactly as the Payments page counts them: by the day the payment *counts* (a card purchase counts
  when the bill is paid, in the month of its `date`), skipped payments left out, paid and still-to-pay both counted.
- **Only money, never debt, is carried.** A month that ends short is a month with nothing to carry; the shortfall is not carried
  forward as a negative (the running balance and the forecast already show it). Because the chain keeps adding leftover and subtracting
  shortfall inside a month first, a shortfall in a later month eats into what was carried before it.

**A setting, on by default.** Settings → the budget gets a switch **"Carry what is left over into the next month"** (stored per
budget as `workspace_settings.carry_over`, default on, so a shared budget behaves the same for both people). Off: nothing below
appears and the Payments page is exactly as it was.

**What appears (Payments page, a chosen month, nothing else changes).**

- At the top of that month's list, one line that cannot be edited, skipped or deleted: **"Left over from December"**, dated the 1st,
  `+€645.00`, with a "Carried over" badge. It reads **Expected** while that month has not started yet (it depends on payments still to
  come) and is plain once the month has begun.
- The strip above the list adds it to **Income** and **Net**, with "includes €645.00 left over from December" under the Income figure.
- It shows only when the filters would show an income: status "All" (or "To pay" for a month not started, "Paid" for one that has),
  type "Income & expenses" or "Income only", and no search, category, way-of-paying or person filter, since it belongs to none of those.
  When it is hidden the totals do not include it either, so the strip always adds up to the rows below it.

**What it is not.** It is not stored as a payment. A stored payment would count twice in the balance and the forecast, which already
carry the money. It is worked out on request by `GET /api/carryover?month=YYYY-MM` → `{ enabled, month, from_month, amount }` (`amount`
is `0` when the setting is off, when there was nothing left, or when the month is the budget's first). The pure rule is
`carriedInto(netCents, month)` in `server/src/lib/carryover.js`; the client adds it to the strip with `withCarry()` in
`client/src/carryLogic.js`, which is tested without a browser.

## 22. Payments totals: bought with the credit card, bought with the debit card (defined before implementation)

**What was wrong.** The two small figures next to Net were "Paid with the card bill" (the card bills that fall in this month) and
"Bought on card" (card purchases made this month that are paid by a later bill). Neither answers the plain question "how much did I
spend with each card this month?", and "Bought on card" sounded like it should be inside the other.

**What changes.** The two figures become one like-for-like pair, both counted by the day you *bought* something:

- **Bought with credit card** = expenses paid with the credit card whose purchase day falls in the chosen month, even when part of
  it is paid with next month's bill (so it is not a part of the Expenses figure, which counts what leaves the account this month).
- **Bought with debit card** = expenses paid from cash or the bank (Penny's "Cash and bank", which covers the debit card) in the
  chosen month.

Skipped payments are left out, and income is never counted. Each figure shows only when it is more than zero. The "Paid with"
filter keeps its wording ("Credit card", "Cash and bank"); only the two figures change. The dashboard's "Payments this month" line
says "bought with credit card" for the same number. `monthTotals(rows, month)` in `client/src/cardLogic.js` returns
`boughtCredit` and `boughtDebit` in place of `onCard` and `bought`; the month is needed to tell a purchase made in it from a bill
that falls in it for something bought earlier.

## 23. Credit card purchases paid in installments, with interest (defined before implementation)

**What was missing.** A card purchase was always one payment, on one bill. Real cards also let you spread a purchase over several
monthly bills, often with interest, and the amount charged each month is what the bank prints on the statement.

**Entering one.** In the payment form, "Paid with credit card" gets a choice, **In one bill** (as before) or **In installments**:

- **How many** installments (2 to 36) and **each installment**, the amount the bank charges each month. It starts as the price divided
  by the number and is yours to change, which is how interest gets in: the form shows *"6 × €190.00 = €1,140.00 · interest €140.00
  (14.0% of the price)"*. An amount lower than the price is refused (that is a discount, not an installment).
- The bill chooser stays and now says which bill the **first** installment is on (so "pay from March" works as it does for one bill).
  The rest follow monthly on the same card pay day.
- Sharing with people, receipts and a payment alert are not offered while adding installments (they belong to one payment). They can
  be added to any single installment afterwards; the form says so.
- It is only for adding. Editing one installment edits that payment only, as for every installment plan.

**What it creates.** An installment plan (so it also appears under Installments, with its steps and the last date) whose payments are
credit card payments: each installment is on its bill day, bought on the purchase day (`charged_on`), and is marked paid or still to pay
by the same rule as any payment (a bill day that has passed is paid). The plan remembers the **purchase price** (`purchase_amount`)
and the **purchase day** (`charged_on`); interest is the total less the price, and is shown on the Installments page.

**How it is counted.**

- **Expenses** count each installment, with its interest, in the month it is charged. Nothing about the balance or forecast changes:
  they already add up payments.
- **Bought with credit card** (section 22) counts the **price once**, in the purchase month, not once per installment. The purchase
  month lists one line for it (the first installment, shown with the price and *"paid in 6 installments from 10 Jan"*); the other
  installments are listed only in their own months. `GET /api/transactions` leaves installments 2 and later out of the "bought this
  month" extras, and adds `plan_purchase_amount` and `plan_installment_count` to each installment.

**Not in this step: paying part of a bill and rolling the rest over with interest.** That needs its own screen ("Pay only part of
this bill"), because it moves or splits several purchases at once. It is described and asked about separately.

## 24. Scrolling over a number box must not change the number (bug fix)

**The bug.** While typing an amount, the figure sometimes went up or down by itself (100 became 100.01, then 99.99). Browsers change a
*focused* `<input type="number">` when the mouse wheel or a two-finger trackpad scroll passes over it, so scrolling a form with the
cursor resting on the amount quietly edits it. It affected every number box (amounts, counts, the card pay day, alert days).

**The fix.** One page-wide listener (`installNumberWheelGuard` in `client/src/numberInputs.js`, installed in `main.jsx`) lets go of a
focused number box when a wheel event happens on it. The page then scrolls as expected and the number is untouched. Typing and the
arrow keys still work. A browser check scrolls over the amount and the card pay day and asserts the value is unchanged; it fails
(100 → 100.01) without the listener.
