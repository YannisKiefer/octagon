# Setup guide: real iPhones, step by step

This guide takes you from a clean checkout to a running session on real iPhones. Demo mode needs no phones at all.

## 1. Prerequisites

- A Mac running macOS. The brain speaks through the built-in `say` command.
- Node 20 or newer. Check with:

  ```bash
  node -v
  ```

  better-sqlite3 12 does not build on older Node versions.

- Check the speaker path once:

  ```bash
  say -v Samantha "test"
  ```

- Optional, for UDIDs and screen capture only: [libimobiledevice](https://libimobiledevice.org):

  ```bash
  brew install libimobiledevice
  ```

Python is not needed at any step.

## 2. Get the code and configure .env

```bash
git clone https://github.com/YannisKiefer/octagon.git
cd octagon
cp .env.example .env
```

Edit `.env`:

- `FARM_PHONE1_PREFIX`..`FARM_PHONE4_PREFIX` - optional; used only when the dashboard initializes an empty database, as each device's `voice_prefix` (`Alpha`, `Bravo`, `Charlie`, `Delta` by default). The prefixes the brains actually speak come from the database afterwards - if you change a Voice Control command, update `voice_prefix` there.
- `FARM_PHONE1_UDID`..`FARM_PHONE4_UDID` - optional, seeded into the devices' `usb_udid` on the same first initialization; only needed for screen capture (step 8). On an existing database the values live in `farm_devices`, not in `.env`.

There is no login and no required auth configuration - the dashboard is local-only.

## 3. Install

```bash
cd infra/farm && npm install
cd ../../apps/dashboard && npm install
cd ../..
```

## 4. Demo mode: look around without phones

```bash
node scripts/seed-demo.js
cd apps/dashboard
npm run dev
```

`scripts/seed-demo.js` resets `infra/db/farm.db` and fills it with clearly synthetic demo data (4 phones, a fake chat transcript). Open **http://localhost:3010**. No login - the dashboard is local-only; the same is true for a production build (`npm run build && npm run start`).

**Try it with demo data:** on a fresh, empty database the dashboard shows a first-run overlay with a **Load demo data** button. It fills the farm through `POST /api/farm/demo` with the same synthetic transcript as the seeder - no phones, no seeder run needed. The endpoint refuses (HTTP 409) when the database already holds data, so demo content never mixes into a real farm.

What you see: phones on the left, per-phone chat in the center, sessions on the right. Everything in demo mode is fake and labeled synthetic.

## 5. Dry run: prove the runtime without TTS

```bash
node infra/farm/farm-brain.js --slot=1 --prefix=Alpha --dry-run --log --duration=0.2
```

Expected output: several `say: Alpha Swipe Next` lines, then `done swipes=N`. Nothing is spoken aloud; the cues are only logged to the console and to `farm_events`.

You can also dry run the whole hub:

```bash
node infra/farm/hub.js --slots=4 --duration=60 --test
```

`--test` means silent dry run: every spawned brain runs with `--dry-run`. Stop it with Ctrl-C.

## 6. Prepare the iPhones

For each phone, on the iPhone:

1. Settings > Accessibility > Voice Control > On. The Voice Control language must be English, because the commands are matched against English phrases.
2. Under Voice Control, open Customize Commands > Create New Command:
   - Phrase: exactly `<Prefix> Swipe Next` for that phone's prefix. The four default commands are:
     - `Alpha Swipe Next`
     - `Bravo Swipe Next`
     - `Charlie Swipe Next`
     - `Delta Swipe Next`
   - Action: Run Custom Gesture, record one swipe-up gesture.
   - Keep "Application: Any".
3. Plug the iPhone into the Mac via USB and trust the Mac when prompted.

Physical setup notes: keep the phones within speaker range of the Mac, do not lay them face down or muffle the microphone with a thick case, and keep the Mac's output volume up. Only one phone listens at a time; the hub's audio lock enforces this.

## 7. Run the hub

```bash
node infra/farm/hub.js --slots=4 --duration=60
```

- `--duration` is minutes per session, fractions allowed (`--duration=0.2` for a 12-second check).
- Each brain speaks its prefix cue, the iPhone swipes, and events land in the dashboard chat. Queue sessions from the chat with `run 20`. The hub alone starts nothing - it only executes queued sessions, check with `status`, cancel with `stop`.
- If a brain exits, the hub restarts it up to 3 times. Missed heartbeats mark a phone degraded (15 s) or offline (50 s) in the dashboard.

Open http://localhost:3010 and watch the events appear in the phone's chat while the hub runs.

## 8. Screen capture (optional)

The MCP tool `get_phone_screen` captures a real screenshot, or honestly reports "unavailable".

```bash
brew install libimobiledevice
idevice_id -l   # lists UDIDs of connected, trusted iPhones
```

`get_phone_screen` reads each device's `usb_udid` from the database. On a fresh database, `FARM_PHONEn_UDID` in `.env` is seeded into that column on first dashboard start; on an existing database, set it directly, for example `sqlite3 infra/db/farm.db "UPDATE farm_devices SET usb_udid='<udid>' WHERE id='phone1'"`. `get_phone_screen {phoneId}` writes a screenshot to the process's current directory via `idevicescreenshot`. Without libimobiledevice or a configured UDID, the tool answers `available: false` with the reason instead of a placeholder.

## 9. Troubleshooting

**The iPhone does not react to the cue.** Check, in order:

1. Voice Control is On on that iPhone (the overlay indicator shows when it listens).
2. Voice Control language is English.
3. The command phrase matches exactly: `<Prefix> Swipe Next`, same prefix as the brain's `--prefix` (default Alpha/Bravo/Charlie/Delta).
4. The Mac's volume is up and `say -v Samantha "test"` is audible.
5. The phone's microphone is not muffled (face-down placement, thick case).
6. Only one phone should listen at a time. The hub serializes cues with its audio lock; if you run brains manually, stagger them yourself.

**SQLITE_BUSY / database is locked.** Another process holds `infra/db/farm.db`. The runtime handles set `busy_timeout` to 5 seconds, but a stuck hub or brain from an earlier run should be closed: look for stray `node infra/farm` processes and stop them.

**Port 3010 busy.** The dashboard scripts pin port 3010. Find it with `lsof -ti :3010` and stop that process, or start the dashboard on another port with `npx next dev -p 3020`, or run the dashboard from that directory with an overridden command.

**better-sqlite3 build errors during npm install.** Use Node 20 or newer (`node -v`), then remove `node_modules` in that package and run `npm install` again.

## 10. Stop and uninstall

- Stop the hub or a brain with Ctrl-C.
- Uninstall: delete the checkout directory and `infra/db/farm.db` (plus `-wal` and `-shm` files if present). Octagon changes nothing else on your system.
