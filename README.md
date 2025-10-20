City of Ottawa — Budget Awareness MVP

Files
- index.html — app shell (loads CSS + JS)
- style.css — styles extracted from the single-file prototype
- app.js — application logic: scenes, sliders, Chart.js rendering, persistence

How to run
1. Open `index.html` in your browser.
2. Or use VS Code Live Server for auto-reload.

Notes
- The app runs entirely client-side. No backend required.
- Chart.js is loaded from a CDN; you need internet access for charts.
- State is optionally saved in `localStorage` so you can return to your last run.

Next steps
- Add per-sector narrative hints in the adjustment screen.
- Add animations using `anime.js` or `GSAP`.
- Add accessibility improvements (focus states, ARIA labels).
