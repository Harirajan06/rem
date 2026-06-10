# 🗃️ Stash

**Your personal vault for links, notes and images — paste anything, it figures out what it is.**

**Live: https://harirajan06.github.io/rem/**

- 📋 Paste a URL → link card with favicon · paste a screenshot → image card · paste text → note
- 🏷️ Tags, instant search (`/`), and type filters
- 🖼️ Images auto-compressed, masonry grid, fullscreen viewer
- 🔒 Local-first: everything stays in your browser (IndexedDB) — no accounts, no uploads
- ⬇ One-click backup / restore (JSON, images included)

## Run locally

```bash
python3 -m http.server 8743
# open http://localhost:8743
```

Static files only — deploys as-is to GitHub Pages.

The data layer is isolated in `app.js` (`store` object) so a cloud backend
(e.g. Supabase) can replace IndexedDB later without touching the UI.

MIT License.
