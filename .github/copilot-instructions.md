# Copilot Instructions

## Design Context

### Users
Windows sysadmins in smaller environments — "jack of all trades" IT staff who know some PowerShell but don't want to write scripts for every DNS change. They need a tool that surfaces the full power of Windows DNS Policy without demanding CLI fluency. They value efficiency, clarity, and trust that the tool won't misfire on a production server.

### Brand Personality
**Technical, capable, comprehensive.** This is an operations console, not a consumer app. It should feel like a purpose-built instrument — something an engineer trusts, not something a marketer designed. Confidence and control are the emotional goals.

### Anti-references
- Not a playful SaaS dashboard (no rounded pastel cards, no illustration mascots, no confetti)
- Not Windows MMC (no tree-view nesting, no grey-on-grey system chrome)
- Not a terminal emulator (structured GUI, not a CLI skin)

### Aesthetic Direction
Dark-only. Navy-charcoal base with cyan as the sole accent color. The visual tone is **restrained technical** — clean surfaces, precise typography, deliberate use of color.

**Reference (console.png):** The previous iteration is the north star for tone. Key qualities to preserve or restore:
- Simple pill/highlight tab navigation (no numeric prefixes, no staggered animation)
- Clean header without scanline overlays or noise textures — just title + subtitle + bridge status
- Left-edge cyan accent bars on card sections for structural rhythm
- Minimal decorative effects — let content density and typographic hierarchy do the work

**Pull back on:** Scanlines, noise overlays, dot-grid backgrounds, beacon pulse animations, and numeric tab prefixes. These add visual noise without aiding comprehension. Status indicators should be simple and static (colored dot + label), not animated.

**Keep:** The three-font system (Oxanium display, Manrope body, JetBrains Mono for code/data), the cyan accent scale, the navy-charcoal palette, the 1400px max-width layout, and the card-based content organization.

### Typography System
| Role | Font | Usage |
|------|------|-------|
| Display | Oxanium | Page titles, section headers, brand mark |
| Body | Manrope | All body text, labels, descriptions |
| Mono | JetBrains Mono | Hostnames, IPs, PowerShell code, data values, status labels |

### Color System
| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#080c14` | Page background |
| `--card` | `#0d1320` | Card/panel surfaces |
| `--primary` (cyan) | `#22d3ee` | Active states, links, accent borders |
| `--cyan-light` | `#67e8f9` | Hover states, highlighted text |
| `--cyan-dim` | `#06b6d4` | Secondary accent |
| `--success` | `#34d399` | Online/healthy status |
| `--destructive` | `#ef4444` | Offline/error status |
| `--warning` | `#fbbf24` | Caution states |
| `--muted-foreground` | `#7b8ba8` | Secondary text, inactive labels |
| `--border` | `rgba(136, 180, 255, 0.08)` | Subtle dividers and card edges |

### Design Principles

1. **Clarity over decoration.** Every visual element must aid comprehension. If it doesn't help the user understand state, navigate, or act — remove it. No scanlines, no noise, no gratuitous animation.

2. **Density without clutter.** Sysadmins work with many objects at once (zones, records, policies). Pack information tightly using good typography and spacing — not by shrinking everything or adding scroll regions.

3. **Status at a glance.** Connection state, server health, and execution mode must be instantly readable from any tab. Use color and position, not animation, to convey status.

4. **Progressive disclosure.** Show the essential controls first. Advanced options, bulk operations, and PowerShell output live one click deeper — never hidden, never in the way.

5. **Trust through precision.** This tool executes commands on production DNS servers. Every action label, confirmation dialog, and status message must be exact. Vague language erodes trust.

### Accessibility
- Target: WCAG AA compliance
- Keyboard-accessible tab navigation and ARIA attributes (already in place)
- Sufficient color contrast for all text on dark backgrounds
- No reliance on color alone to convey meaning — pair with icons or labels
- Respect `prefers-reduced-motion` for any remaining transitions

### Component Patterns
- **shadcn/ui** primitives for all standard controls (buttons, inputs, selects, dialogs, tables, tooltips)
- **Sonner** for toast notifications (dark theme, bottom-right)
- **Lucide** for iconography
- **Cards with left-edge accent** for major content sections
- **Horizontal pill tabs** for primary navigation (not numeric-prefixed)
- **Mono-font data display** for hostnames, IPs, PowerShell output, and counts
