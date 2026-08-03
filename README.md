# APAC Legal Front Door — deployment package

This folder is ready to upload as-is to any static file host. No build step,
no npm install, no framework — just these files.

```
deploy/
├── index.html        ← the front door (public, share widely)
├── admin/
│   └── index.html    ← the admin panel (keep private, don't link from nav)
└── README.md          ← this file
```

## Before you deploy

1. **Ask IT**: "where do internal static web tools usually get hosted here?"
   PepsiCo may already have an approved static hosting service (e.g. Azure
   Static Web Apps) that avoids a fresh vendor review entirely. Worth a
   5-minute check before picking a platform below.

2. **Confirm in Supabase** (Authentication → Providers → Email):
   "Enable email signups" is **OFF**. Once this has a public URL, anyone
   could otherwise self-register an account with write access via the
   admin panel.

## Option A — Cloudflare Pages (recommended if no internal option exists)

1. Go to https://pages.cloudflare.com → sign up (free)
2. **Create a project** → **Upload assets**
3. Drag this entire `deploy` folder (or a zip of it) into the upload area
4. Deploy — you'll get a URL like `https://apac-legal.pages.dev` in under a minute
5. Front door: `https://apac-legal.pages.dev/`
   Admin: `https://apac-legal.pages.dev/admin/`

## Option B — Netlify

1. Go to https://app.netlify.com/drop
2. Drag the `deploy` folder onto the page
3. Same result — live URL immediately, `/admin/` for the admin panel

## After deploying

- [ ] Open the live front door URL — confirm OU tiles, tools, and newsletter all load
- [ ] Open the live `/admin/` URL — log in, confirm edits save and reflect on the front door
- [ ] Do **not** add a link to `/admin/` anywhere in the front door's navigation —
      it should only be reachable by people who already know the URL, on top of
      (not instead of) the login requirement
- [ ] Share the front door URL with your team; share the admin URL only with
      whoever you've created Supabase Auth accounts for

## Custom domain (optional, later)

Both Cloudflare Pages and Netlify support attaching a custom domain
(e.g. `legal-apac.pepsico.com`) for free once you have one approved through
IT/DNS — this is a settings change after initial deploy, not something you
need to decide now.
