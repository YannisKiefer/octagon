# Design System — Reference chat window, extracted 1:1

Source: user-provided screenshot (1712x1082). Neutral dark macOS chat app.
Applied to Octagon with only the copy changed to phone-farm meaning.

## 1. Colors

| Token | Hex | Use |
|---|---|---|
| window | #0d0d0f | chat bg |
| sidebar | #111113 | left + right panels |
| sidebar border | #1c1c1e | panel edges |
| item selected | #2a2a2c | active chat row |
| item hover | #1c1c1e | rows, buttons |
| bubble | #26262a | agent messages |
| bubble self | #323236 | user messages (right) |
| input / search bg | #1b1b1d | fields, pills |
| border strong | #2c2c2e | search, input, cards, tags |
| text primary | #f5f5f7 | names, bubble text |
| text secondary | #98989d | previews, schedules |
| text muted | #636366 | timestamps, placeholders, IDs |
| link | #4aa3ff | URLs in bubbles |
| green (clock) | #30d158 | routine icons, live note |
| traffic lights | #ff5f57 #febc2e #28c840 | titlebar |
| avatar bgs | #3a3a3c #7d5cf6 #3b82f6 #f59e0b | per-agent circles |

Dark mode only. No light variant.

## 2. Typography

System stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif`.
No monospace anywhere (previous version was wrong).

| Element | Size/Weight | Color |
|---|---|---|
| Chat name | 13.5px / 600 | #f5f5f7 |
| Tag pill | 10.5px / 400 | #98989d on #2c2c2e |
| Preview | 12.5px / 400 | #98989d, truncate |
| Row time | 11px / 400 | #636366 |
| Header name | 14px / 600 | #f5f5f7 |
| Header ID | 12px / 400 | #636366 |
| Timestamp | 11px / 400 | #636366 |
| Bubble text | 13.5px / 400, lh 1.5 | #f5f5f7 |
| Pill "Aktualisiert" | 11.5px / 400 | #636366 on #1b1b1d |
| Input | 13.5px / 400 | placeholder #636366 |
| Routine title | 13.5px / 500 | #f5f5f7 |
| Routine schedule | 12px / 400 | #98989d |
| Panel label | 12.5px / 400 | #98989d |
| "Routinen" heading | 15px / 600 | #f5f5f7 |

## 3. Spacing + Shapes

- Titlebar 48px; sidebar 275px; right panel 370px; center flex.
- Search: rounded-lg (8px), pl-8, py-6px.
- Chat row: px-2 py-9px, gap-10px, rounded-xl (12px); avatar 36px circle.
- Bubble: rounded-[18px], px-14px py-10px, max-w 68%.
- Input: rounded-full, h~44px, + 30px circle left, mic 30px white circle right.
- Screen box: aspect 4/3, rounded-xl (12px), border #2c2c2e, spinner 32px.
- Routine row: gap-10px, py-7px, rounded-lg hover; clock icon 20px green outline.
- Modal: w-340px, rounded-[28px], phone frame 9/18 rounded-[20px] border 3px.

## 4. Layout (top to bottom)

Titlebar: traffic lights left · "+" at sidebar edge · gear + ❯❯ far right.
Sidebar: Suchen → chat rows (avatar | name+tag+time / preview) → bottom: Plugins row, Yannis Kiefer row (YK avatar).
Center: header (avatar 34px, name, ID below) → scroll (timestamp, bubble, timestamp, bubble …, centered pill) → input pill.
Right: "Bildschirm von X" label centered → screen box (spinner) → "Routinen" + plus → clock rows.
Flow: click row → header/messages/input placeholder/right panel all switch. Click screen box → phone modal. ✕ / backdrop closes.

## 5. Motion

- animate-spin on screen spinner (1s).
- hover bg transitions ~150ms. Nothing else.

## 6. Copy mapping (only intentional difference)

| Reference | Octagon |
|---|---|
| Ralf (+ tag "X- Marketing") | Alpha (+ tag "Warmup") |
| Rufklar / E-Mail / Finance | Bravo / Charlie / Delta |
| "Nachricht an Ralf" | "Nachricht an {Phone}" |
| "Bildschirm von Ralf" | "Bildschirm von {Phone}" |
| X routines (morning trend, hourly post…) | farm routines (Warmup sweep, Auto-post, Parity check, Nightly learn) |
| message text | farm-agent reports (swipes, jitter, learn pass) |
