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
