# Design System — Grok Bot (Ralf) 1:1 for Octagon

Extracted from reference: Ralf screenshot (Image 1) — dark 3-panel chat, macOS traffic lights, left WhatsApp list, center bubbles, right Routinen.

## 1. Color Palette

**Backgrounds:**
- App bg: #010409 (center), #0d1117 (sidebars)
- Card/sidebar selected: #161b22
- Border: #21262d (1px), #30363d (input/border)
- Bubble other: #21262d, Bubble self: #1f2937
- Accent red: #f85149 (button, dot, link), hover #e7463d
- Text primary: #e6edf3, secondary: #8b949e, muted #6e7681, placeholder #8b949e
- Success green: #2ea043 / #238636 (clock), emerald #10b981 (dot), amber #d29922, sky #0ea5e9
- Link blue: #58a6ff (in bubbles)
- Beige line art (if in banner): #cfc8b8, #f0ede6 — not in grok, ignore

**Functional:**
- Danger: #f85149
- Success: #238636
- Warning: #d29922
- Info: #1f6feb

**Dark mode:** only dark. No light variant.

## 2. Typography

**Families:**
- UI sans: Inter, ui-sans-serif, system-ui, -apple-system
- Mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas
- No serif.

**Scale (from screenshot):**
- Header agent name: 14px, 700, Inter, #e6edf3
- ID/mono: 11-12px, 400, mono, #8b949e
- Timestamp above bubble: 11px, 400, mono, #8b949e
- Bubble body: 14px, 400, Inter, #e6edf3, line-height 1.5, whitespace-pre-wrap
- Sidebar item name: 14px, 500, Inter, #e6edf3
- Sidebar subtitle: 12px, 400, Inter, #8b949e, truncate
- Sidebar time: 11px, 400, mono, #8b949e
- Search placeholder: 13-14px, 400, Inter, #8b949e
- Routinen title: 14px, 500, Inter, #e6edf3
- Routinen schedule: 12px, 400, Inter, #8b949e
- Button: 13-14px, 700, Inter, white on #f85149 or #8b949e on #21262d
- Input placeholder: 14px, 400, Inter, #8b949e

**Weights:** 400 regular, 500 medium, 700 bold. No 900 except header.

## 3. Spacing System (4dp base)

- 4px, 8px, 12px, 16px, 24px, 32px
- Sidebar w: 280px, Right w: 360px, Center flex
- Header h: 56px, px-4, border-b #21262d
- Left search px-3 py-3, input pl-8
- List item px-3 py-2.5, gap-3, rounded-md (6px)
- Bubble px-4 py-3, gap-4, rounded-2xl (16px), max-w 720
- Input bar p-4, gap-3, rounded-full
- Card p-3, rounded-xl (12px), gap-3
- Routinen row py-2.5 px-2, gap-3

## 4. Component Styles

**Sidebar item:**
- Default: transparent, border transparent, hover #161b22
- Selected: bg #161b22, border #30363d, rounded-md
- Dot: w-2 h-2 rounded-full, green #2ea043 pulse, blue #1f6feb, grey #8b949e, amber
- Avatar: w-8 h-8 rounded-full #21262d, text letter

**Bubbles:**
- Other: bg #21262d, border #30363d, rounded-2xl, px-4 py-3, 14px
- Self: bg #1f2937, border #30363d, same, ml-auto
- Timestamp: 11px mono #8b949e above/below

**Input:**
- Container: bg #010409, border #30363d, rounded-full, px-3 py-2, gap-3
- + button: w-8 h-8 rounded-full bg #21262d, + center, #8b949e
- Input: flex-1 bg transparent, 14px, placeholder #8b949e
- Mic: w-8 h-8 rounded-full bg white, black mic icon

**Buttons:**
- Primary: bg #f85149, text white, rounded-md, py-2, 14px 700, hover #e7463d
- Secondary: bg #21262d, border #30363d, text #e6edf3, same

**Right cards:**
- Bildschirm: aspect-[4/3], bg #161b22, border #30363d, rounded-xl, p-3, spinner w-8 h-8 border-2 #30363d border-t-white animate-spin
- Tags: px-2 py-1 rounded bg #21262d border #30363d, 11px mono #8b949e or emerald
- Routinen row: flex gap-3, icon w-5 h-5 rounded-full border emerald, •, title 14px 500, sub 12px #8b949e, hover #161b22

**Search:**
- Input: w-full bg #010409, border #30363d, rounded-md, pl-8 pr-3 py-1.5, 14px, placeholder #8b949e

**Scrollbars:** hidden, overflow-auto

## 5. Layout & Flows

**3-panel flex h-screen:**
- Left 280 fixed, border-r #21262d, flex-col, overflow-hidden
- Center flex-1 flex-col min-w-0 bg #010409, header 56, bubbles overflow-auto p-6, input 56
- Right 360 fixed, border-l #21262d, hidden xl:flex, flex-col

**Flow:**
- Click left item → setSel(phone) → center header + bubbles + input placeholder + right Bildschirm + Routinen switch. No page nav.
- Click Bildschirm card → modal fixed inset-0 bg-black/70 backdrop-blur, centered 360x? phone outline 9/19.5, close ✕.
- Buttons: Start farm / Drop video → alert (stub, later MCP)

**States:**
- Hover: #161b22
- Selected: #161b22 border #30363d
- Focus: border #8b949e
- Loading: spinner animate-spin
- Empty: no events → show demo fallback

## 6. Animations

- Dot pulse: animate-pulse (1.5s)
- Spinner: animate-spin (1s linear)
- Hover: transition-colors 150ms
- No other motion. Ralf is static, fast.

## 7. Iconography

- No Lucide in Ralf. Use text: ⌕ search, + , ◐ clock, ⚙︎ gear, • dot, 🎤 mic. Keep minimal.
- If need icons, use same 11px mono, not Lucide.

