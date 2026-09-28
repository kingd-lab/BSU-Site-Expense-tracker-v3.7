# Site Expense Management System

A web-based expense tracker for construction/site businesses. Site Managers submit
expenses that become permanent once saved; Admins see everything and manage users;
the Boss gets a read-only reporting view.

- **Frontend:** plain HTML/CSS/JS (no build step) — deployable to Vercel, Netlify, or GitHub Pages
- **Backend:** Google Apps Script Web App
- **Database:** Google Sheets
- **Charts/exports:** Chart.js, jsPDF, SheetJS (all loaded from CDN, no install needed)

---

## 1. Set up the Google Sheet + backend

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet, e.g. **"Site Expense DB"**.
2. In the sheet, open **Extensions → Apps Script**.
3. Delete the default `Code.gs` contents and paste in the entire contents of `apps-script/Code.gs` from this project.
4. In the Apps Script editor, select the function `setupSheets` from the dropdown at the top and click **Run**.
   - The first time, Google will ask you to authorize the script — accept it.
   - This creates the `Users`, `Expenses`, `AuditLog`, and `Sites` sheets with the right columns, plus three starter logins:
     | Username | Password | Role |
     |---|---|---|
     | king | ChangeMe123! | Admin |
     | boss | ChangeMe123! | Boss |
     | john | ChangeMe123! | Site Manager (site: Lekki) |
   - **Change these passwords immediately** — open the `Users` sheet and edit the `Password` column, or use the in-app "Add User" tool and delete the defaults.
5. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**, authorize again if prompted, and copy the **Web app URL** (ends in `/exec`). You'll need this next.

> Because the Web App is set to "Execute as: Me", it always runs with *your* Google account's
> permissions — Site Managers and the Boss never get direct Sheets access, exactly as required.

## 2. Point the frontend at your backend

Open `js/api.js` and replace the placeholder:

```js
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

with the `/exec` URL you copied in step 6 above.

## 3. Run it locally (optional)

Any static file server works, e.g.:

```bash
npx serve .
```

Then open `http://localhost:3000` and log in with one of the accounts above.

## 4. Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Since this is a static site (no build step), Vercel will deploy it as-is. Alternatively,
drag-and-drop the project folder into [vercel.com/new](https://vercel.com/new), or push it
to a GitHub repo and import it in the Vercel dashboard.

(GitHub Pages and Netlify work the same way — just point them at the project root.)

---

## How the roles work

| | Site Manager | Admin | Boss |
|---|---|---|---|
| Submit expenses | ✅ (own site only) | ✅ (any site) | ❌ |
| Edit / delete expenses | ❌ never | ❌ never (immutable by design) | ❌ never |
| View expenses | own site only | all sites | all sites |
| Manage users & sites | ❌ | ✅ | ❌ |
| View audit log | ❌ | ✅ | ❌ |
| Export PDF/Excel | ❌ | ✅ | ✅ |

Every expense is permanent once submitted — there is no edit or delete endpoint in the
backend at all for expenses, so it can't be added back in by mistake later.

## Security notes

- The Sheet itself is never shared with Site Managers or the Boss — all access goes through
  the Apps Script Web App, gated by a session token (`CacheService`, 6-hour expiry).
- Every login, failed login, expense submission, and user/site creation is written to the
  `AuditLog` sheet.
- The starter setup stores passwords in plain text in the `Users` sheet, matching the sheet
  layout in the spec. For a production rollout, consider hashing passwords (e.g. with
  `Utilities.computeDigest`) before comparing them in `login()` in `Code.gs`.

## Project structure

```
site-expense-system/
├── index.html          Login (all roles)
├── manager.html         Site Manager dashboard
├── add-expense.html     Add-expense form (Site Manager + Admin)
├── dashboard.html        Admin dashboard (all sites, users, audit log)
├── report.html            Reports (Boss + Admin) — charts, PDF/Excel export
├── css/
│   ├── style.css         Shared tokens, sidebar, cards, tables
│   ├── login.css
│   ├── dashboard.css
│   └── forms.css
├── js/
│   ├── api.js            Calls the Apps Script backend
│   ├── auth.js            Session storage + route guarding
│   ├── layout.js           Sidebar builder
│   ├── categories.js        Expense category taxonomy
│   ├── login.js
│   ├── dashboard.js          Manager + Admin dashboards
│   ├── report.js               Boss/Admin reports + export
│   └── expense.js               Add-expense form
└── apps-script/
    └── Code.gs            Paste into Apps Script — the entire backend
```
