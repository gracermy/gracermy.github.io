# Project idea: Commerce portfolio piece (Shopify store + from-scratch POS)

> **Purpose of this doc:** a durable record of the ideation for my next side project,
> so my thinking survives even if the chat history is lost. This is NOT part of the
> games site — it's a separate portfolio project. Saved here only because this repo is
> my reliable free GitHub storage.
>
> **Status:** Ideation complete, decisions locked. Next step = create accounts + scaffold.
> **Last updated:** 2026-07-27

---

## The goal

Build a portfolio project that shows I can build things beyond puzzle games — specifically
around **e-commerce**: managing an online shop **and** a modern **POS (point-of-sale) system**.
Audience includes project managers / e-commerce / ops roles, so "can operate & customize
Shopify" is a deliberately valuable skill signal, alongside "can engineer a system from scratch."

## Big-picture decision: TWO artifacts, two skill stories

1. **Online store → built ON real Shopify (Path B: custom theme).**
   Shows I can stand up and *customize* a real commercial platform (ops + front-end code).
2. **POS system → built FROM SCRATCH in my own code (companion project).**
   Shows I can *engineer* a system end-to-end, not just configure one.

Framing for a reviewer: *"Here's a real Shopify store I configured and custom-themed — and
here's a POS engine I built from the ground up."* The two complement each other and don't overlap.

---

## The Shopify half — Path B (custom theme)

### What "building on Shopify" means
Shopify gives the backend for FREE (catalog, inventory, orders, checkout, payments, admin).
I don't build that. I build a layer on top. The four possible paths considered:

| Path | What I do | Skill signal | Code? |
|---|---|---|---|
| A. Store setup/config | Add products, shipping, taxes, apps, pick theme in visual editor | e-commerce / PM ops | No |
| **B. Custom theme (CHOSEN)** | Everything in A **+** edit storefront code in **Liquid** (Shopify's HTML templating lang) + CSS/JS | ops **and** front-end dev | **Yes** |
| C. Shopify App | App embedded in admin, uses Admin API + React + Polaris | full-stack dev on real platform | Yes (most) |
| D. Headless (Hydrogen) | Replace storefront with custom React app via Storefront API | modern front-end + API | Yes |

### Why Path B
- Gives **both** the ops/config skill PMs want **and** a real code artifact (custom Liquid theme).
- **Closest to skills I already have** (HTML/CSS/JS from the games site); only new thing is Liquid — gentle ramp.
- Free to build via a Partner dev store.
- Complements the from-scratch POS (which already carries the heavy "I can engineer" signal),
  so C/D would be redundant with that; A alone would be too code-light.

### What Liquid looks like (example)
```liquid
{% for product in collection.products %}
  <div class="card">
    <img src="{{ product.featured_image | img_url: '400x' }}">
    <h3>{{ product.title }}</h3>
    <span>{{ product.price | money }}</span>
  </div>
{% endfor %}
```

---

## ⚠️ The cost / "can I actually show this?" catch — RESOLVED

**The worry:** I use free GitHub + free GitHub Pages hosting. Does that transfer to Shopify? **No.**

- GitHub Pages hosts *my files* free forever. Shopify hosts *their platform*; a live PUBLIC
  storefront is their **paid product (~$39/mo)**. GitHub **cannot** deploy a Liquid theme —
  it only runs on Shopify's servers.
- **Partner development store** is FREE forever for: creating the store, building/editing themes,
  and *me* (logged in) previewing everything.
- BUT a dev store is password-protected, can't take real orders, and can get limited/frozen if
  not moved to a paid plan. **I cannot hand the public a clean, always-on link without paying.**

### The resolution — how it stays FREE + permanent + portfolio-safe

**CHOSEN = Option 1 (free, permanent):**
- **The theme code lives in a free PUBLIC GitHub repo** — permanent, readable. *This is the core
  portfolio artifact* (reviewers read the code).
- **Visual proof = screenshots + a short screen-recorded walkthrough** of the live dev store
  (which I can view free anytime while logged in).
- This is how many Shopify devs show work without paying monthly.

**Optional later = Option 2 ($1–39, temporary live link):**
- Shopify frequently offers **$1/month for first 3 months**. During an actual job hunt I can spin
  up a paid plan briefly to have a real clickable public URL, then take it down.
- This is a CHOICE made at hiring time, not a prerequisite to building.

(Option 3 considered & rejected: build a "headless" React storefront on free hosting instead —
but that's no longer Path B / Liquid, so it loses the "I can theme Shopify" signal and collapses
back into the from-scratch build.)

**Bottom line: the project is always showable. The repo never disappears and costs nothing;
the live link is an optional add-on, never a trap.**

### How long can I hold it free? (confirmed)
- **Partner account + theme-building + creating dev stores = free FOREVER, no time limit.** Stable.
- **A dev store persists indefinitely** — there is NO hard "X days then deleted" clock on it
  (that ~3-day clock is the *paid-plan free trial*, a different thing). Caveats: it stays
  password-protected, can't take real orders, and Shopify may pause it after long inactivity.
- **For Option 1 this doesn't matter:** the real artifact is the theme code in GitHub, and a
  dev store is a re-creatable workbench — if one ever gets paused/deleted, spin up a fresh dev
  store and re-upload the theme from GitHub in ~10 min. So effectively I can hold it **as long as
  I want**. (Verify exact terms on Shopify Partner docs — Shopify changes them periodically.)

### Option 1 → Option 2 is a SWITCH, not a rebuild (confirmed)
- Going live later = **upgrade/transfer the SAME dev store to a paid plan.** No migration.
- Theme code, products, collections, settings ALL stay; the password wall just drops and the
  store becomes a public clickable URL.
- Lifecycle: **(1)** build free on dev store + push code to GitHub → **(2)** during job hunt,
  upgrade that same store to paid (grab ~$1/mo promo if live) for a public link → **(3)** cancel
  when done; GitHub code + recordings stay forever, and the link can be re-lit anytime by
  upgrading again.
- Caveat: the Partner "transfer to paid" step is a menu click, not engineering — walk through
  the exact button at that time. Capability is core Shopify behavior; promo pricing drifts.
- **Decision locked:** START with Option 1. Keep Option 2 in back pocket. Nothing built now is
  thrown away in the switch.

---

## The POS half — from scratch (companion project)

- Build my own POS app in code (NOT Shopify POS — that's config-only and can't be "engineered").
- Suggested stack (from earlier discussion): modern React + a real DB (e.g. SQLite via Prisma),
  sharing a similar product/inventory/order data model to feel like a real system.
- POS = staff-facing: fast item lookup → ring up sale → tender → change due → receipt →
  inventory decrements. (Contrast: storefront is customer-facing, conversion-optimized.)
- Deployable free (Vercel / GitHub) since it's my own code.
- **Deferred** — tackle after the Shopify store, or in parallel later. Not the immediate focus.

---

## DEVELOPMENT ROADMAP — big picture

The store (Shopify Path B) is the immediate focus; the POS is the later companion.
Each phase is independently demoable. All of Phase 0–6 is FREE.

### PART ONE — Shopify custom-theme store (Path B)

**Phase 0 — Accounts & scaffold (setup, ~1 sitting).**
- Create free **Shopify Partner account** (browser — I do it; Claude gives click-by-click).
- Spin up a **development store** (free sandbox).
- Install the **Shopify CLI** locally (the tool that connects my code editor to the store —
  lets me pull/push theme code and live-preview edits).
- Create a **public GitHub repo** for the theme code (the permanent portfolio artifact).
- Pick a **store niche** for demo content (affects products/imagery/copy).

**Phase 1 — Base theme + local dev loop working.**
- Start from Shopify's free reference theme **"Dawn"** (`shopify theme init`) so I have a
  working, well-structured base to customize — NOT a blank page.
- Get `shopify theme dev` running: edit a `.liquid` file locally → see it live-reload in the
  browser against my dev store. Proving this loop works is the milestone.
- Commit the base theme to GitHub.

**Phase 2 — Store content & config (the "ops/PM" skill).**
- Add demo **products** (photos, descriptions, prices, variants, SKUs, stock).
- Group into **collections** (e.g. featured / sale / by category).
- Configure **navigation menus**, shipping/tax basics, store info.
- This is what proves the "can operate a real store" signal.

**Phase 3 — Customize the theme in Liquid (the "coding" skill — the core work).**
- Restyle to my own visual identity (colors, fonts, spacing) — reuse HTML/CSS/JS instincts
  from the games site.
- Customize key templates: **homepage** (hero, featured collection), **product page**,
  **collection/listing page**, **cart**, **header/footer**.
- Build **theme settings / sections** so the store is editable in Shopify's visual editor
  (shows I understand how themes are meant to be configured, not just hardcoded).
- Add a bit of custom **JS interaction** for polish.

**Phase 4 — Polish + portfolio capture.**
- Responsive/mobile check, accessibility pass, performance sanity.
- **Capture proof:** screenshots + a short **screen-recorded walkthrough** of the live dev store.
- Write a strong **README** in the theme repo (what it is, stack, what I built, screenshots,
  link-on-request note). This README + code IS the portfolio piece.

**Phase 5 (OPTIONAL, later) — go live for a job hunt (Option 2).**
- Upgrade the same dev store to a paid plan for a public clickable URL. Take down when done.

### PART TWO — From-scratch POS (companion, deferred)

**Phase 6+ — separate build.** My own POS app (React + real DB, e.g. SQLite/Prisma),
staff-facing ring-up flow, framed as the engineering companion to the Shopify store.
Tackle after Part One is in good shape. (Details in the POS section above.)

---

## WHERE I BEGIN (next action)

**Start at Phase 0.** Concretely, the very first steps, in order:
1. Create the free **Shopify Partner account** in the browser (Claude provides click-by-click).
2. Create a **development store** from the Partner dashboard.
3. Install **Shopify CLI** + confirm **Node** is present (Claude helps / checks locally).
4. Create the **public GitHub repo** for the theme (Claude can scaffold the local folder in
   parallel while I do the browser signup).

### Open questions to answer at kickoff
- **Repo/theme name?** (e.g. `shopify-store-demo`, or something branded to the niche.)
- **Store niche?** — what does the demo shop sell? (Affects products, imagery, copy, styling.
  Pick something I find fun and can source free stock images for.)
- **Where does the theme repo live?** — its own new folder outside the games site (recommended),
  e.g. `~/my github/<theme-repo-name>/`.
- Scaffold local theme folder now, or wait until the dev store + Dawn theme exist? (Slight lean:
  create the dev store first so Dawn gives us the real file structure to commit, rather than
  guessing it.)
