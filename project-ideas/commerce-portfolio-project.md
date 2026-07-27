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

## NEXT STEPS (where we left off)

Immediate, all free, commit to nothing:

1. **Create a free Shopify Partner account** (in browser — needs my email/verification;
   Claude can't create it, but will give click-by-click steps).
2. **Spin up a development store** (free coding sandbox).
3. **Create a public GitHub repo** for the theme code (permanent portfolio home).
4. **Start building the custom theme in Liquid.**

Claude offered to: write out the click-by-click Partner-account + dev-store setup, AND
scaffold the local project folder + GitHub repo structure for the theme (can do the local
scaffolding in parallel while I do the browser signup).

### Open questions still to confirm when I resume
- Project/repo name for the Shopify theme.
- Whether to scaffold the local theme repo now vs. after the dev store exists.
- What kind of store to theme (product niche) — affects demo content.
