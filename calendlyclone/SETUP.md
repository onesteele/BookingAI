# Setup Guide — Calendly Clone

This guide walks you through standing up your self-hosted booking system from scratch.
No Node.js, no build step — just upload the `docs/` folder to GitHub Pages.

---

## Prerequisites

- A [GitHub](https://github.com) account
- A [Supabase](https://supabase.com) account (free tier is fine)
- A [Google Cloud](https://console.cloud.google.com) account (free)

---

## Step 1 — Create Your Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Give it a name (e.g. `calendlyclone`), choose a region close to you, set a database password
3. Once created, go to **Project Settings → API**
4. Copy these two values — you'll need them in Step 4:
   - **Project URL** (e.g. `https://abcdef.supabase.co`)
   - **anon public** key

### Run the Database Migrations

In the Supabase dashboard, go to **SQL Editor** and run both migration files in order:

1. Paste and run: `supabase/migrations/20240101_schema.sql`
2. Paste and run: `supabase/migrations/20240101_rls.sql`

### Create Your Admin Account

In Supabase dashboard → **Authentication → Users → Add User**:
- Email: your admin email
- Password: secure password
- Click **Create User**

---

## Step 2 — Set Up Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. `CalendlyClone`)
3. In the sidebar go to **APIs & Services → Enable APIs**
4. Search for and enable **Google Calendar API**
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
6. Choose **Web application**
7. Under **Authorized redirect URIs** add:
   ```
   https://github.com/onesteele/BookingAI/auth/google-callback.html
   ```
8. Click **Create** — copy the **Client ID** and **Client Secret**


Client ID: 808293812450-n136rhb49eprqp1rt6kf1oida64tle7h.apps.googleusercontent.com

Client Secret: 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


### Configure OAuth Consent Screen

1. Go to **OAuth consent screen**
2. Set User Type to **Internal** (if using Google Workspace) or **External**
3. Fill in App name, your email
4. Add scopes: `../auth/calendar` and `../auth/calendar.events`
5. Add your team members' Google accounts as test users (if External)

---

## Step 3 — Configure Supabase Edge Function Secrets

In your Supabase dashboard → **Edge Functions → Secrets**, add:

| Secret Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `APP_BASE_URL` | `https://github.com/onesteele/BookingAI/` |

The `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are automatically available to edge functions.

---

## Step 4 — Edit config.js

Open `docs/config.js` in any text editor and fill in your values:

```js
const CONFIG = {
  supabaseUrl:     'https://YOUR_PROJECT_ID.supabase.co',
  supabaseAnonKey: 'your_supabase_anon_key_here',
  appBaseUrl:      'https://github.com/onesteele/BookingAI/',
}
```

This is the **only file** you need to edit to configure the frontend.

---

## Step 5 — Upload to GitHub Pages

### 5a — Create the GitHub repository

1. Go to [github.com](https://github.com) → **New repository**
2. Name it exactly `calendlyclone` (must match the URL path)
3. Make it **Public**

### 5b — Upload all files

**Option A — Browser upload (simplest):**
1. In your repo → **Add file → Upload files**
2. Drag in the entire project folder (including `docs/`, `supabase/`, `SETUP.md`, etc.)
3. Commit to `main`

**Option B — Git terminal:**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/calendlyclone.git
git push -u origin main
```

### 5c — Enable GitHub Pages

In your GitHub repo → **Settings → Pages**:
- Source: **Deploy from a branch**
- Branch: `main`
- Folder: `/docs`
- Click **Save**

Your site will be live at `https://YOUR_USERNAME.github.io/calendlyclone/` within a minute.

### Updating the site later

The `docs/` folder contains all the HTML/CSS/JS — edit any file directly and re-upload (or git push). No build step required.

---

## Step 6 — Deploy Edge Functions

Install the Supabase CLI:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_ID
```

Deploy all edge functions:
```bash
supabase functions deploy get-availability
supabase functions deploy create-booking
supabase functions deploy google-auth-init
supabase functions deploy google-auth-callback
supabase functions deploy cancel-booking
```

---

## Step 7 — First-Time Admin Setup

1. Visit `https://YOUR_USERNAME.github.io/calendlyclone/admin/login.html`
2. Log in with the admin account you created in Step 1
3. Go to **Agents** → Add your team members
4. Click **Connect Calendar** next to each agent → complete the Google OAuth flow
5. Click the **Set Availability** link for each agent → configure their weekly schedule
6. Go to **Event Types** → Edit the default "30-min Onboarding Call" or create new ones
7. Go to **Booking Links** → Create a link (e.g. slug: `onboarding`) and assign an event type
8. Copy the link: `https://YOUR_USERNAME.github.io/calendlyclone/book.html?slug=onboarding`
9. Share with your customers!

---

## File Structure

```
docs/                          ← Everything served by GitHub Pages
├── config.js                  ← YOUR CREDENTIALS GO HERE (edit this)
├── style.css                  ← All styles
├── admin.js                   ← Shared admin utilities
├── index.html                 ← Redirects to admin/login.html
├── book.html                  ← Public booking page (?slug=yourslug)
├── book-success.html          ← Booking confirmation page
├── auth/
│   └── google-callback.html   ← Google OAuth redirect handler
└── admin/
    ├── login.html             ← Admin login
    ├── index.html             ← Dashboard
    ├── agents.html            ← Manage team members
    ├── availability.html      ← Per-agent weekly schedule
    ├── event-types.html       ← Event type configuration
    ├── links.html             ← Booking link management
    └── bookings.html          ← View & cancel bookings

supabase/
├── migrations/
│   ├── 20240101_schema.sql    ← Run in Supabase SQL Editor first
│   └── 20240101_rls.sql       ← Run in Supabase SQL Editor second
└── functions/
    ├── get-availability/      ← Compute open time slots
    ├── create-booking/        ← Round-robin + GCal event creation
    ├── google-auth-init/      ← Generate Google OAuth URL
    ├── google-auth-callback/  ← Exchange code, store tokens
    └── cancel-booking/        ← Cancel booking + delete GCal event
```

---

## Customization

### Brand Colors
Edit `docs/style.css` — change `--indigo` and `--indigo-dark` to your brand color.

### Company Name
Edit the sidebar title in `docs/admin.js` — search for `BookingAdmin`.

### Booking Page Title / Description
Edit `docs/book.html` — the left info panel is populated from the booking link's `title` and `description` fields stored in Supabase.

### Slot Duration
In the admin panel → **Event Types**, change the duration and buffer per event type.

### Timezone
Currently hardcoded to `America/New_York`. To change, search for `America/New_York` in:
- `docs/admin.js` (the `fmtTime` / `fmtDate` helpers)
- `supabase/functions/` edge functions

---

## Architecture Overview

```
Customer visits /book.html?slug=onboarding
    ↓
Vanilla JS calls Supabase Edge Function (get-availability)
    ↓
Edge Function checks:
  1. Agent weekly availability schedule (our DB)
  2. Google Calendar free/busy (real-time)
  3. Existing bookings in our DB
    ↓
Returns available slots with spots_left count
(slot disappears only when ALL agents are booked)
    ↓
Customer selects slot → submits form
    ↓
create-booking Edge Function:
  1. Re-validates slot availability (race condition guard)
  2. Round-robins to next available agent
  3. Creates booking in Supabase DB
  4. Creates Google Calendar event with customer as attendee
    ↓
Customer sees confirmation page
Agent sees event in Google Calendar
```
