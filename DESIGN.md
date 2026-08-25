---
name: CF Platform Flow Control Desk
description: A calm interlocking-signal control desk for reviewing, testing, clearing, and archiving agent-built Flows.
colors:
  rail-ink: "#17201c"
  rail-ink-soft: "#223027"
  rail-divider: "#3a4a3f"
  mineral-paper: "#f3efe3"
  mineral-paper-deep: "#e8e3d5"
  inspection-surface: "#fbfaf5"
  white: "#ffffff"
  text: "#202822"
  text-muted: "#667067"
  text-faint: "#8c938b"
  border: "#d5d0c3"
  border-strong: "#bdb7a8"
  signal-orange: "#ce6f32"
  signal-orange-deep: "#a44e20"
  clearance-green: "#2f7254"
  clearance-green-soft: "#dcebe2"
  fault-red: "#a74636"
  fault-red-soft: "#f1ded9"
  hold-amber: "#a06a22"
  hold-amber-soft: "#f2e7cc"
  capability-blue: "#315f78"
typography:
  display:
    fontFamily: 'Aptos, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(24px, 3vw, 34px)"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  headline:
    fontFamily: 'Aptos, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "17px"
    fontWeight: 760
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  title:
    fontFamily: 'Aptos, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 760
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: 'Aptos, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: 'Aptos, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
    fontWeight: 720
    lineHeight: 1.5
    letterSpacing: "0.02em"
  mono:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  indicator: "50%"
  compact: "5px"
  control: "7px"
  standard: "8px"
  overlay: "9px"
  card: "10px"
  node: "11px"
  field-group: "12px"
  emblem: "14px"
spacing:
  hairline: "2px"
  micro: "5px"
  compact: "8px"
  control: "10px"
  standard: "12px"
  section: "18px"
  panel: "20px"
  spacious: "24px"
components:
  button-standard:
    backgroundColor: "{colors.inspection-surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  button-publish:
    backgroundColor: "{colors.clearance-green}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  button-signal:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "34px"
  flow-node:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    rounded: "{rounded.node}"
    width: "184px"
---

# Design System: CF Platform Flow Control Desk

## Overview

**Creative North Star: "联锁信号台"**

CF Platform behaves like an interlocking signal desk: every Flow is a route that must be stated, reviewed, manually composed, tested, cleared, and archived. The visual world is operate-mode—calm, precise, reliable, restrained, and professional—with a deep ink-green route register, a mineral-paper work surface, exact route lines, enamel indicators, and a white inspection drawer.

The material language is functional rather than nostalgic. Ink marks persistent navigation and infrastructure; paper holds the editable work; enamel lamps expose machine state; orange signals present attention or motion; green means a route is clear to publish. The canvas grid is permitted only as the coordinate surface of the Flow editor. There are no shipping raster assets.

**Key Characteristics:**

- Full-height route register, work surface, and inspection drawer arranged as one control desk.
- Warm mineral neutrals and dark green ink instead of generic gray-white dashboard chrome.
- Sparse enamel state lamps paired with text labels, borders, and gate copy.
- A wide, zoomable route canvas with readable nodes and precise orthogonal connections.
- Short, purposeful motion that reports state without suggesting “AI magic.”

## Colors

Warm mineral paper and near-black green ink carry the interface; a compact signal palette is reserved for operation state and capability identity.

### Primary

- **Clearance Green** (`clearance-green`): the affirmative operational color for passed routes, successful stages, connected service health, and the gated publish action. Its soft companion supports passed-state badges.

### Secondary

- **Signal Orange** (`signal-orange`): the current-route and attention color for primary creation, goal submission, testing, selection, focus, and in-progress edges. The deep tone supplies borders, route codes, and text selection.

### Tertiary

- **Hold Amber** (`hold-amber`): waiting, draft, approval, and blocked-route state; use its soft companion behind draft badges.
- **Fault Red** (`fault-red`): failed nodes, failed tests, destructive actions, and error status; use its soft companion only where a quiet error surface is needed.
- **Capability Blue** (`capability-blue`): the compact identity field for ordinary CF capability nodes, never a competing action accent.

### Neutral

- **Rail Ink** (`rail-ink`): the route-register field, entry marker, dark toast surface, and strongest brand material. `rail-ink-soft` differentiates secondary ink controls; `rail-divider` separates ink regions.
- **Mineral Paper** (`mineral-paper`): the main workspace and functional canvas. `mineral-paper-deep` supports recessed paper layers.
- **Inspection Surface** (`inspection-surface`): the right drawer, lifted controls, tray items, and other pale working surfaces. Pure `white` is reserved for editable fields, nodes, and the composer.
- **Text / Muted / Faint** (`text`, `text-muted`, `text-faint`): primary content, secondary explanation, and low-emphasis metadata in descending order.
- **Border / Strong Border** (`border`, `border-strong`): quiet section structure and control/container outlines. Strong borders identify interactive or major panel boundaries.

### Named Rules

**The Signal Has One Meaning Rule.** Orange means attention, selection, or motion; green means passed, healthy, or publishable; amber means waiting or blocked; red means failed or destructive. Never swap these roles for variety.

**The Lamp-and-Label Rule.** State color is always accompanied by text, a border change, a position in the lifecycle, or an icon; an enamel lamp never carries meaning alone.

**The Paper Is Work Rule.** The faint square grid belongs only to the actual Flow canvas. All other paper surfaces remain quiet.

## Typography

**Display Font:** Aptos with Noto Sans CJK SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, and sans-serif fallbacks  
**Body Font:** Aptos with the same CJK and system fallbacks  
**Label/Mono Font:** SFMono-Regular with Consolas and Liberation Mono fallbacks for identifiers; the UI label face remains Aptos

**Character:** A compact humanist sans-serif keeps Chinese-first operations legible without feeling clinical. Weight, tabular numerals, and controlled negative tracking create hierarchy; there is no decorative display face.

### Hierarchy

- **Display** (700, fluid 24–34px, 1.18): centered first-run objective prompt only; use tight tracking (-0.035em).
- **Headline** (760, 17px, 1.5): current Flow title in the desktop workspace header; reduce to 14px on narrow screens.
- **Title** (760, 14px, 1.5): inspector and brand titles; node titles use 15px at 750 and may wrap to two lines.
- **Body** (400, 14px, 1.5): explanations, messages, and editable objectives; message text is capped at 70ch and introduction copy at 62ch.
- **Label** (720–800, 10–12px, 0.02em): controls, field labels, lifecycle stages, state copy, and compact metadata. Uppercase with 0.08em tracking is limited to route-register group labels; node headers are uppercase without widened tracking.
- **Mono** (400, 11px, 1.5): hashes, IDs, revisions, and version evidence. Use tabular numerals for route codes, counts, indices, and zoom readouts.

### Named Rules

**The Operations Type Rule.** Hierarchy comes from weight and density, not oversized headings; reserve the fluid display size for the empty-state invitation.

**The Evidence Face Rule.** Monospace identifies machine evidence—IDs, hashes, revisions, and versions—not ordinary UI labels.

**The Readable-Zoom Rule.** Node header, kind, order, title, subtitle, and footer text multiply their base size by `--inverse-zoom` so labels remain visually readable while the 1200×680 route plane scales from 60% to 140%.

## Layout

The desktop shell fills the viewport and prevents body scrolling. Its three columns are the 252px route register, a flexible workspace with a 520px minimum, and a 336px inspection drawer. The workspace header is 64px high, the lifecycle strip is 38px, and the canvas toolbar is at least 46px. The center swaps between conversation and route-canvas views while the left and right contexts persist.

Conversation content is deliberately narrow inside the flexible workspace: introductions top out at 680px, message streams at 760px, and the composer at roughly 790px. The route canvas is deliberately wide (1200×680px) inside an independently scrolling viewport and uses a 28×28px coordinate grid. Nodes are positioned on this plane, draggable within bounded coordinates, and their horizontal order rebuilds the execution route. A CF library appears as a horizontally scrolling tray above the canvas.

Spacing follows a dense 8–12px control rhythm, 18–20px panel/section rhythm, and 24px spacious rhythm. Interactive controls are generally 34px high; the main “New Flow” control is 38px. Inspector content uses 18px padding, and conversation gutters expand fluidly to center the reading column.

At 1180px and below, the side columns contract to 224px and 310px and test/publish button labels collapse to icon-only controls while their accessible names remain. At 980px and below, the inspector leaves the grid and becomes a right drawer (`min(360px, 100vw - 48px)`) over a scrim. At 720px and below, the route register becomes a left drawer (`min(288px, 100vw - 48px)`), the header drops to 58px, breadcrumb/status/view tabs hide, lifecycle labels reduce to numbered signals, starter cards become one column, and conversation/composer gutters tighten.

Responsive drawers trap focus, close on Escape or scrim activation, focus their first meaningful control when opened, and return focus to the trigger when closed. The mobile scrim belongs below the open drawer but above the work surface.

### Named Rules

**The Persistent Route Rule.** Keep the current Flow visible through the register, title, route code, lifecycle, or drawer context; no operation should make the user lose which route they are changing.

**The Work Surface Rule.** Conversation is a focused reading column; composition is a wide spatial canvas. Do not force both into a generic card grid.

**The Drawer Threshold Rule.** Collapse the inspector at 980px and the route register at 720px; do not squeeze either into unusably narrow persistent columns.

## Elevation & Depth

Depth is a restrained hybrid of tonal layering, one-pixel structural borders, and small shadows. Persistent shell regions remain flat. White editable objects lift slightly from paper; enamel indicators use an inset highlight plus a compact drop shadow; drawers and transient toasts receive the strongest shadows. No blur, glass, or translucent floating-card system is used.

### Shadow Vocabulary

- **Segment Selection** (`0 2px 5px rgba(38,44,38,.1)`): the selected option in the chat/canvas segmented control.
- **Enamel Lamp** (`inset 0 1px 1px rgba(255,255,255,.65), 0 2px 4px rgba(30,40,32,.24)`): small node indicators; larger test lamps extend the drop to `0 2px 5px rgba(35,45,37,.28)`.
- **Node Rest** (`0 5px 14px rgba(46,52,45,.11)`): draggable route nodes on paper.
- **Node Engaged** (`0 7px 18px rgba(46,52,45,.15)`): node hover and operational state; selection adds `0 0 0 2px rgba(206,111,50,.2)`.
- **Entry Marker** (`0 5px 16px rgba(33,38,33,.17)`): the fixed route origin.
- **Composer Lift** (`0 9px 26px rgba(53,58,49,.11)`): the goal composer against the paper work surface.
- **Emblem Lift** (`0 9px 22px rgba(35,40,34,.17)`): the first-run signal emblem.
- **Toast Lift** (`0 10px 28px rgba(22,28,23,.24)`): transient operational feedback.
- **Responsive Drawer** (`-12px 0 32px rgba(35,40,34,.12)` right; `12px 0 32px rgba(20,27,21,.22)` left): separates temporary navigation and inspection layers from the active surface.

### Named Rules

**The Structural Depth Rule.** Borders establish permanent hierarchy; shadows are reserved for editable objects, active selections, drawers, and transient feedback.

## Shapes

The system combines gently machined rectangles with literal round signals. Compact controls use 5–8px corners, overlays use 9px, starter cards use 10px, route nodes use 11px, the composer and status pills use 12px, and the signal emblem uses 14px. Flow-route endpoints, ports, lifecycle indices, and lamps are fully circular. Borders are one pixel except the entry marker’s 4px paper ring, node ports’ 3px stroke, selected node’s 2px outer signal, and the route underlay/line pair.

Route geometry is orthogonal and precise: the visible line is a 3px rounded stroke over an 8px pale paper underlay, with rounded joins and caps. Avoid ornamental diagonals and decorative grids; geometry should explain execution order or interaction.

### Named Rules

**The Enamel Geometry Rule.** Circles are signals, ports, indices, or route origins. Ordinary content lives in restrained rounded rectangles.

**The Measured Corner Rule.** Do not apply one universal radius. Radius increases modestly with object scale and softness, from 5px capability marks to the 14px emblem.

## Components

Components feel tactile, precise, and restrained. All controls retain the global 2px orange focus outline with 2px offset unless a field uses its inset focus treatment.

### Buttons

- **Shape:** compact machined control (7px radius), normally 34px high with 12px horizontal padding; icon-only controls are 34×34px with an 8px radius.
- **Primary:** publishing uses clearance green with white text and a darker green border. It is enabled only after a passing test.
- **Signal:** creation, goal submission, test initiation, and the empty-canvas recovery action use signal orange with white text and a deep-orange border.
- **Standard:** inspection-surface fill, primary text, and a strong mineral border. Destructive actions retain the pale surface but use fault-red text and a muted red border.
- **Hover / Focus / Active:** eligible rectangular buttons lift 1px and brighten over 140–240ms; orange and green variants deepen slightly. Disabled controls keep their shape but drop to 46% opacity and use a not-allowed cursor. Busy buttons spin their icon for 900ms linear.

### Chips

- **Style:** lifecycle and draft badges use full pill ends (12px radius), 24px height, 6px indicator, 8px horizontal padding, and paired state text. Proposal summary chips use an 11px radius with 3×8px padding on a recessed paper fill.
- **State:** amber is draft/waiting and green is passed; neither is a freeform category color.

### Cards / Containers

- **Corner Style:** starter cards use 10px, route nodes 11px, the composer 12px, and inspector gate panels 8px.
- **Background:** white for editable nodes and fields, inspection surface for controls/library items, mineral paper for the workspace, and deep ink for persistent navigation.
- **Shadow Strategy:** flat by default; use the documented node, composer, or overlay shadow only for the matching interaction role.
- **Border:** one-pixel mineral borders provide most structure. The node footer is a recessed paper strip with only its lower corners rounded.
- **Internal Padding:** compact interactive cards use 9–14px; inspector sections use 18px panel padding and 18–20px section separation.

### Inputs / Fields

- **Style:** white field, 1px quiet mineral border, 7px corners, and 34px height for inputs/selects. Textareas use 8×10px padding, 82px minimum height in the inspector, and vertical resizing; the goal textarea starts at 72px, grows to 160px, and does not show its own border inside the composer.
- **Focus:** switch the field border to signal orange and add a 2px translucent orange ring. The composer textarea removes its local outline because the enclosing composer provides the form silhouette.
- **Error / Disabled:** errors are expressed in the surrounding gate/toast/state copy. Disabled action controls use 46% opacity; never encode a field error by color alone.

### Navigation

The left route register is deep ink with 64px brand header, searchable route list, and service footer. Route items use a 12px lamp column plus flexible text, 10×9px padding, and 8px corners. Hover introduces a faint white wash; the current route uses a lighter ink field, white text, and a 3px orange rail at the far left. Draft/published lamps are paired with metadata. On narrow screens the entire register becomes the focus-trapped left drawer.

The chat/canvas switch is a 34px segmented control on recessed paper; the selected segment lifts onto the inspection surface. Inspector navigation uses three equal tabs with a 2px orange underline on the active tab.

### Goal Composer

The white 12px-radius composer is the primary first-view action. It combines an open textarea, a server-backed Runtime selector with a health lamp and Profile evidence note, and a 34px orange send control. Enter submits; Shift+Enter creates a new line. Unavailable or disabled Runtimes remain visible as evidence but cannot be selected; failures never silently fall back to another agent.

### Runtime and Workspace Settings

Settings reuse the signal-desk material system as an operational registry rather than a generic modal. A recessed left register lists Runtime health and immutable Profile versions; the main paper surface edits workspace defaults, Resource Profiles, commands, process arguments, cwd, timeouts, output protocol, environment-name allowlists, and capability labels. Connection tests report measured adapter evidence. Security traits distinguish enforced behavior from adapter declarations and unavailable constraints; the UI never labels an ordinary host process as a universal sandbox.

### Flow Route Canvas

The canvas is a functional coordinate surface, not decoration. It supports pan-by-scroll, CF drag/drop, node dragging, fit-to-width, and zoom in 10% steps from 60% to 140%. Fit selects the smaller of 100% and the viewport-derived scale, never below 62%. A drag-over state warms the paper slightly.

Routes use a pale 8px under-stroke and 3px gray-green line. Running edges become orange 9/7 dashed lines moving every 600ms; passed edges become clearance green. Reduced-motion preference collapses animations and transitions to 0.01ms and one iteration.

### Flow Node

The signature node is a 184px-wide white inspection card with a 3-row structure: uppercase kind header, editable identity body, and recessed status footer. A compact blue kind mark identifies CF calls; output uses soft ink and approval uses amber. Hover strengthens border and shadow; selection adds an orange border and outer signal; running, passed, failed, and blocked states use orange, green, red, and amber borders plus matching enamel lamps and textual status.

Nodes are draggable with grab/grabbing cursors. Alt+Left and Alt+Right reorder non-output nodes by swapping their horizontal positions, rebuild the sequential route, preserve focus, and report the change. Node typography uses inverse zoom so visual text size stays readable while the node plane scales.

### Inspection Drawer

The white inspection drawer holds Details, Versions, and Activity tabs. It edits the selected node or Flow, exposes the test gate, and presents immutable version/run evidence only on demand. Sections are separated by hairline mineral rules; property rows align labels left and evidence right. On screens at or below 980px it becomes a scrim-backed right drawer with close control, focus trap, Escape handling, and focus restoration.

### Test Gate and Feedback

The gate is a recessed 8px-radius paper panel with a 12px enamel lamp, explicit state sentence, and consequences. Any edit invalidates a prior test. Test starts in orange/running, becomes green/passed or red/failed, and publication is unavailable until passed. Toasts are compact dark-ink operational notices with a colored lamp, title, detail, and 300ms upward reveal; they never intercept pointer input.

## Do's and Don'ts

### Do:

- **Do** treat each Flow as a route with visible draft, running, passed, failed, blocked, and published evidence.
- **Do** use the ink rail, mineral paper, inspection white, exact route lines, and enamel lamps as a single functional material system.
- **Do** keep goal entry, test, and gated publish as the dominant actions in their respective lifecycle stages.
- **Do** preserve text labels, focus treatment, keyboard reordering, focus-trapped drawers, and reduced-motion behavior.
- **Do** keep route-node text readable across the implemented 60–140% zoom range with inverse scaling.
- **Do** use the 28px grid only inside the real Flow coordinate surface.

### Don't:

- **Don't** turn the product into a generic chat page or a general-purpose node administration dashboard.
- **Don't** replace the mineral-paper and ink world with a generic gray-white developer dashboard.
- **Don't** use neon “AI magic,” glassmorphism, or luminous gradient effects to imply intelligence.
- **Don't** create high-saturation card mosaics or let status colors compete as decoration.
- **Don't** place decorative grids outside the actual Flow canvas.
- **Don't** use raster atmosphere or ornamental imagery; the shipped system has no raster assets.
