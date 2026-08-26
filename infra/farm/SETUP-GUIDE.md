# Octagon — 10-line setup

1. iPhone: Settings → Accessibility → Voice Control → On, language English, create commands `Alpha Swipe Next`, `Alpha Like Post` (one per phone prefix).
2. Plug iPhones via powered USB hub to Mac, trust, `idevice_id -l` to get UDID (or Finder).
3. `cp .env.example .env` → set `FARM_PHONE1_PREFIX=Alpha` etc.
4. `pip install -r engine/requirements.txt && python scripts/seed-demo.py`
5. `cd apps/dashboard && npm install && npm run dev` → http://localhost:3010/
6. Test one phone: `node infra/farm/farm-brain.js --slot=1 --prefix=Alpha --dry-run --log` — say `Alpha Swipe Next` should swipe.
7. Run farm: `node infra/farm/hub.js --slots=4 --duration=60` (or `--test` for no sound)
8. See it: chat in center, Routinen on right. Press Start.
9. If phone hangs: hub restarts it, event shows in chat.
10. That's it. One Mac, real taps, no APIs.
