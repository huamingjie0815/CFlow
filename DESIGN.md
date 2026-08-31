---
name: CFlow Quiet Light Workbench
description: A restrained light workbench that lets non-technical staff read, adjust, check, and publish agent Flows in plain language.
colors:
  paper: '#f6f7f9'
  paper-deep: '#eef0f4'
  surface: '#ffffff'
  panel: '#fbfbfc'
  inset: '#f2f4f7'
  white: '#ffffff'
  text: '#1d2126'
  muted: '#5b636d'
  faint: '#8a919b'
  border: '#e5e8ec'
  border-strong: '#d2d7de'
  accent: '#35569e'
  accent-deep: '#2b4681'
  accent-soft: '#eef1f8'
  green: '#16794e'
  green-soft: '#e8f3ed'
  amber: '#8f6314'
  amber-soft: '#fbf2df'
  red: '#b0392d'
  red-soft: '#fbecea'
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 'clamp(22px, 2.6vw, 30px)'
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: '-0.012em'
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '17px'
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: '-0.008em'
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 'normal'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 'normal'
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '11px'
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: '0.02em'
  mono:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
    fontSize: '11px'
    fontWeight: 400
rounded:
  indicator: '50%'
  compact: '5px'
  control: '7px'
  standard: '8px'
  overlay: '9px'
  card: '10px'
  node: '11px'
  field-group: '12px'
  emblem: '14px'
spacing:
  hairline: '2px'
  micro: '5px'
  compact: '8px'
  control: '10px'
  standard: '12px'
  section: '18px'
  panel: '20px'
  spacious: '24px'
components:
  button-standard:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    borderColor: '{colors.border-strong}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '0 11px'
    height: '34px'
  button-signal:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.white}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '0 11px'
    height: '34px'
  button-publish:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.green}'
    borderColor: '{colors.border-strong}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '0 11px'
    height: '34px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    borderColor: '{colors.border-strong}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '0 10px'
    height: '34px'
  flow-node:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    borderColor: '{colors.border}'
    rounded: '{rounded.node}'
    width: '190px'
  mark:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.accent}'
    rounded: '{rounded.overlay}'
---

# Design System: CFlow Quiet Light Workbench

## Overview

**Creative North Star: "安静的办公桌面"**

CFlow is used by staff who do not write code. The interface therefore behaves like a
well-organised desk rather than an operator console: a near-white ground, hairline
rules, plain-language labels, and one quiet accent that only ever marks the single
next step. Nothing blinks, nothing shouts, and no screen asks the reader to
understand a protocol, a hash, or a DSL in order to do their job.

The system is deliberately monochrome-dominant. Colour carries meaning, never
decoration: the slate-blue accent means "this is the action to take now", green means
"cleared", amber means "waiting on a person", red means "stopped". Everything else is
neutral. Technical facts are never deleted — they are demoted behind an explicit
disclosure so the one colleague who needs to reconcile a run can still find them.

**Key Characteristics:**

- A top bar for flow management, then three panels — detail, canvas, assistant — plus a drawer under the canvas.
- Exactly one filled button per screen: whatever the user should do next.
- Status is a small dot plus a word, never a large colour fill and never colour alone.
- Business language on the surface; identifiers, versions, and hashes behind 「技术细节」.
- Desktop only. Side panels collapse to a 50px rail; there is no mobile drawer.

## Colors

The palette is neutral-first. Six greys carry the entire structure; the accent and
three status hues are used at small scale only.

| Token                  | Value                 | Use                                                       |
| ---------------------- | --------------------- | --------------------------------------------------------- |
| `paper`                | `#f6f7f9`             | App ground behind all panels                              |
| `panel`                | `#fbfbfc`             | Flow list rail                                            |
| `surface`              | `#ffffff`             | Cards, fields, node bodies, overlays                      |
| `inset`                | `#f2f4f7`             | Search field, hover rows, count chips                     |
| `border`               | `#e5e8ec`             | Default hairline                                          |
| `border-strong`        | `#d2d7de`             | Control outlines, focused separation                      |
| `text`                 | `#1d2126`             | Primary copy                                              |
| `muted`                | `#5b636d`             | Secondary copy, helper text                               |
| `faint`                | `#8a919b`             | Meta, timestamps, placeholder                             |
| `accent`               | `#35569e`             | The single next action, active tab, focus ring, selection |
| `accent-soft`          | `#eef1f8`             | Selected row, mark blocks, quiet chips                    |
| `green` / `green-soft` | `#16794e` / `#e8f3ed` | Cleared, published, healthy                               |
| `amber` / `amber-soft` | `#8f6314` / `#fbf2df` | Draft, waiting for a person                               |
| `red` / `red-soft`     | `#b0392d` / `#fbecea` | Failed, destructive, blocked                              |

Contrast rule: any coloured text sits on `surface`, `paper`, or its own `-soft`
partner — never white text on a light token. All status hues meet 4.5:1 on white.

## Typography

One system stack, weights capped at 600. The old desk used 680–800 weights and
−0.035em tracking; both read as "engineering tool" and are gone.

- Display 22–30px/600 for view titles only.
- Headline 17px/600 for section headers.
- Title 14px/600 for card and row names.
- Body 14px/400 at 1.6 line-height for anything the user must actually read.
- Label 11px/600, +0.02em, uppercase only for group headers.
- Mono 11px reserved for filesystem paths and disclosed technical values.

## Layout

- Rows: `52px` top bar, an auto notice row, then the workbench.
- Workbench grid: `300px | minmax(560px, 1fr) | 340px`; either side collapses to `50px`.
- With no flow, the workbench collapses to a single full-width column.
- Minimum viewport 1280px. Desktop only, by product decision.
- The canvas toolbar holds step-adding buttons on the left and the action ladder (检查/测试/运行/发布) on the right.
- The centre column is the goal composer until a flow exists, then the canvas.
- The drawer under the canvas holds 日志 and 检查. It never opens by itself.

## Elevation & Depth

Effectively flat. Separation comes from hairlines and the ground/surface step.
A single soft shadow (`0 8px 24px rgba(24,32,46,.1)`) is permitted for overlays
and the settings sheet. Node cards, buttons, and panels cast no shadow.

## Shapes

7px for controls, 8–10px for cards and overlays, 11px for flow nodes, 50% for
status dots. No pills except the canvas 「开始」 marker.

## Components

- **Button** — outline by default. `.signal` adds the one accent fill on screen.
  `.publish` is outline with green text and only fills once a test has passed.
  `.danger` is red text on white; it fills only inside a confirmed destructive flow.
- **Flow node** — kind label, sequence number, human name, one line of plain
  description, an optional quiet config chip, and a status dot with a word. The node
  never shows an internal id as its title.
- **Status dot** — 7–8px, paired with a text label, in green/amber/red/neutral.
- **Mark block** — `accent-soft` ground with `accent` glyph, for view emblems.
- **Technical disclosure** — a closed `<details>` holding ids, versions, hashes, and
  raw JSON. Present on the check panel, the run log, and the detail panel.
- **Bottom drawer** — tab strip plus close button, sized `min(38vh, 320px)`, a flex
  sibling under the canvas so it resizes the canvas instead of covering its controls.
- **Flow switcher** — one flat list of drafts and published versions with a status
  tag per row, search, per-row delete, and 新建流程 at the foot.

## Do's and Don'ts

**Do**

- Name the next step and fill exactly that one button.
- Write every label as a sentence a colleague in HR or finance would understand.
- Translate error codes into what to change and where.
- Keep hidden system folders out of the folder picker by default.
- Label a branch edge with the routing rule the author wrote, not the case id.

**Don't**

- Don't put white text on a light token; check contrast when retinting.
- Don't surface `cfId`, `planHash`, `programHash`, `policyRef`, or "DSL/ACP/manifest"
  on a primary surface — disclose them instead.
- Don't use two filled buttons on one screen; the fill is computed by `nextSignalAction`.
- Don't encode state in colour alone, and don't animate to attract attention.
- Don't add a mobile or touch layout; that is out of product scope.
