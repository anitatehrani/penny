# Demo logins

Open **http://localhost:3001** and sign in with the **email address or the username** (with or without the `@`) and the password below.

Password for every account: `Budget-Showcase#2026`

| Who | Email or username | What you will see |
| --- | --- | --- |
| **Alex Morgan** (start here) | `alex.morgan@example.com` or `alex` | Everything: months of history, forecast, installments, splits, 3 budgets, inbox |
| Sam Rivera | `sam.rivera@example.com` or `sam` | Alex's partner, shares the "Home" budget |
| Jordan Morgan | `jordan.morgan@example.com` or `jordan` | Alex's sister, has a pending group invitation |
| Priya Nair | `priya.nair@example.com` or `priya` | Friend, in "Lisbon trip", has invited Alex to "Book club" |
| Chris Walker | `chris.walker@example.com` or `chris` | Has sent Alex a connection request |
| Dana Lee | `dana.lee@example.com` or `dana` | Alex sent Dana a request |

If the page does not load, the app is not running. In a terminal in `D:\budget-app` run:

    npm run db:start
    npm start

If the accounts are missing (for example after you reset the database), recreate them with the server running:

    npm run seed:demo
