# BatsBettor — Design Spec Sheet

Reference: "MLB BETTOR / Dugout Red" mockup. This is the single source of
truth for color, type, spacing, elevation, and motion. Tokens are defined in
`src/styles.css` under `:root`; this doc explains intent and usage.

---

## 1. Color Palette — "Dugout Red"

### Brand (primary)
| Token | Hex | Use |
|---|---|---|
| `--red` / `--brand` | `#C05746` | Primary brand, active nav, key actions, section labels |
| `--brand-deep` | `#A44536` | Hover/pressed brand states, gradients |
| `--brand-darkest` | `#7E3125` | Brand gradient end, deep accents |

### Semantic (data signals — critical for a betting UI)
| Token | Hex | Use |
|---|---|---|
| `--positive` | `#2EC27E` | Positive edge, profit/ROI up, model > market, win |
| `--highlight` | `#F5B942` | Featured "biggest edge", stars, gold callouts |
| `--warning` | `#E5484D` | Caution, model < market, line moved against |
| `--danger` | `#DC2626` | Loss, strong negative, destructive actions |

Rule: **green = good for the bettor, red = bad.** Never use brand red to
signal a negative number — that's what `--warning`/`--danger` are for. Brand
red is identity, not sentiment.

### Surfaces (layered for depth — this is what makes it look "clean")
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0F1115` | App background (base layer) |
| `--panel` | `#161A22` | Cards, sidebar, panels (one step up) |
| `--panel-strong` | `#1D2430` | Elevated/nested surfaces, hover fills |
| `--line` | `rgba(255,255,255,0.07)` | Hairline borders |

Each layer is ~6–8% lighter than the one below. Depth comes from this
stepping plus shadow, not from heavy borders.

### Text
| Token | Hex | Use |
|---|---|---|
| `--text` | `#F4F6FA` | Primary text |
| `--muted` | `#B8C0CC` | Secondary text, labels |
| `--faint` | `#7B8492` | Timestamps, captions, disabled |

---

## 2. Typography

- **Display / headings:** Space Grotesk, `letter-spacing: -0.03em`
- **Body / UI:** IBM Plex Sans
- **Numerals:** use `font-variant-numeric: tabular-nums` for odds, %, money —
  keeps columns aligned as values change live.

Scale: 0.75 (caption) · 0.82 (label) · 0.9 (body) · 1.0 · 1.25 · 1.6 · 2.2 (hero stat).

---

## 3. Elevation & Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `8px` | chips, pills, inputs |
| `--radius-md` | `12px` | buttons, list items |
| `--radius-lg` | `16px` | cards, panels |
| `--shadow` | `0 18px 48px rgba(0,0,0,0.45)` | resting card |
| `--shadow-lift` | `0 22px 60px rgba(0,0,0,0.55)` | hover/active card |
| `--glow-brand` | `0 0 0 1px var(--brand), 0 8px 28px rgba(192,87,70,0.28)` | focused/selected |

Rounded corners (not the old 3px) are the largest single cleanliness win.

---

## 4. Motion

Principle: motion confirms state and guides the eye; it is never decorative
filler. Fast, eased, and subtle.

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | `140ms` | hovers, color/border changes |
| `--motion-base` | `220ms` | entrances, expands |
| `--motion-slow` | `420ms` | page/section transitions |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | entrances (decelerate) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | moves between states |

Patterns (utility classes in `styles.css`):
- `.motion-rise` — cards/messages fade + rise 8px on mount (`--ease-out`)
- `.motion-stagger > *` — children rise with incremental delay (lists)
- Hover lift: interactive surfaces `translateY(-2px)` + `--shadow-lift`
- `.value-flash-up` / `.value-flash-down` — brief green/red flash when a live
  number changes (win prob ticks, score updates)
- `.pulse-live` — soft pulsing dot for in-progress games
- All wrapped in `@media (prefers-reduced-motion: reduce)` → transitions
  collapse to near-instant, no transforms.

---

## 5. Component Guidance

- **Stat cards** (balance, P&L, accuracy): `--panel`, `--radius-lg`, big
  tabular numeral, semantic color on the delta line only.
- **Edge cards**: model % in brand red, market % in muted, edge in
  `--positive` (or `--warning` if negative). Featured "biggest edge" gets the
  `--highlight` gold ring.
- **Nav**: active item = brand-tinted fill + brand text + left accent bar;
  inactive = transparent, hover → `--panel-strong`.
- **Live game**: `.pulse-live` dot, win-prob uses `.value-flash-*` on change.
- **Chat**: messages mount with `.motion-rise`; assistant typing keeps the
  existing bounce.

---

## 6. Accessibility

- Body text on `--bg`/`--panel` meets WCAG AA (`--text`/`--muted` pass; keep
  `--faint` for non-essential only).
- Never encode meaning in color alone — pair green/red with sign (`+`/`−`) or
  an arrow icon.
- Honor `prefers-reduced-motion`.
