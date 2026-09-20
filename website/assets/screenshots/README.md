# Screenshot drop-in directory

Real screenshots land here. `index.html` references these exact paths:

- `dashboard-main.png` - hero image. Expected: the Octagon dashboard with the device fleet chat visible, captured at roughly 1440x900, dark theme, running on synthetic demo data from `node scripts/seed-demo.js`.
- `dashboard-chat.png` - demo section image. Expected: a single phone's conversation view (events, session reports), roughly 1200x800, same synthetic data.

Until real files are dropped in, the current placeholder PNGs are flat dark panels. If a file is missing entirely, the page hides the broken image and shows a labeled frame ("Dashboard screenshot - synthetic demo data") instead.

Captions on the page must keep stating that screenshots show synthetic demo data.
