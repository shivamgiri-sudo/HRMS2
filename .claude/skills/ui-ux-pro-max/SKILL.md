---
name: ui-ux-pro-max
description: "UI/UX design intelligence. 102 styles, 161 palettes, 73 font pairings, 28 motion patterns, 122 UX guidelines (incl. 8 HRMS-specific), 25 charts, 22 stacks. Use for: plan, build, create, design, implement, review, fix, improve, optimize UI/UX. Projects: dashboard, admin panel, SaaS, HRMS, landing page, mobile app. Elements: button, modal, navbar, sidebar, card, table, form, chart. Styles: glassmorphism, minimalism, brutalism, neubrutalism, bento grid, dark mode, AI-powered UX, dark/light adaptive theming, micro-interactions, scroll-driven animations, view transitions, OKLCH colors, command palette, collaborative UI, Rive/Lottie motion, variable fonts, progressive disclosure, AI copilot sidebar, fluid layouts."
---

# UI/UX Pro Max — Design Intelligence

Comprehensive design guide for web, mobile, and desktop. 84 UI styles, 161 color palettes, 73 font pairings, 99 UX guidelines, 25 chart types across 22 tech stacks. Searchable database with priority-based recommendations.

---

## Search Command

```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "<query>" --domain <domain> [-n <max_results>]
```

**Domains:**
- `product` — product type recommendations (SaaS, dashboard, e-commerce, portfolio)
- `style` — UI styles (glassmorphism, minimalism, brutalism) + CSS keywords + AI prompts
- `typography` — font pairings with Google Fonts imports
- `color` — color palettes by product type
- `landing` — page structure and CTA strategies
- `chart` — chart types and library recommendations
- `ux` — best practices and anti-patterns

**Stack search (22 stacks):**
```bash
python skills/ui-ux-pro-max/scripts/search.py "<query>" --stack shadcn
```
Available: `html-tailwind`, `react`, `nextjs`, `shadcn`, `astro`, `vue`, `nuxtjs`, `svelte`, `swiftui`, `react-native`, `flutter`, `angular`, `laravel`, `threejs`, `jetpack-compose`, `wpf`, `winui`, `avalonia`, `uno`, `uwp`

**Full design system (ALWAYS start here for new pages/features):**
```bash
python skills/ui-ux-pro-max/scripts/search.py "<product_type> <keywords>" --design-system -p "Project Name"
```

**With design dials:**
```bash
python skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system --variance <1-10> --motion <1-10> --density <1-10>
```
- `--variance` 1=centered/minimal → 10=bold/asymmetric
- `--motion` attaches matching GSAP animation snippet
- `--density` 1=spacious → 10=dense/dashboard

---

## When to Use

**MUST use** this skill for:
- Designing any new page or section (dashboard, landing, form, modal)
- Creating or refactoring UI components (button, card, table, sidebar, chart)
- Choosing color palettes, font systems, spacing, or layout patterns
- Reviewing UI code for UX quality, accessibility, or visual consistency
- Implementing navigation, animations, or responsive behaviour
- Making product-level design decisions (style, information hierarchy, branding)

**Skip** for: pure backend logic, API/DB design, infrastructure, non-visual scripts.

**Rule**: if the task changes how something *looks*, *feels*, *moves*, or *is interacted with* — use this skill.

---

## Workflow

### Step 1: Analyse Requirements
Extract: product type, target audience, style keywords, tech stack (this project: React + Tailwind + shadcn/ui).

### Step 2: Generate Design System
```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "hrms bpo dashboard enterprise" --design-system --stack shadcn -p "MAS PeopleOS"
```
Returns: pattern, style, colors, typography, effects, anti-patterns to avoid.

### Step 3: Domain Searches for Components
```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "data table recruiter" --domain ux --stack shadcn
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "kpi metric card" --domain style --stack shadcn
```

### Step 4: Implement with Stack Guidelines
Always use `--stack shadcn` for this project. The search returns ready-to-use component patterns for shadcn/ui + Tailwind.

---

## Priority Rules

| Priority | Category | Key Checks | Anti-Patterns |
|---|---|---|---|
| 1 | Accessibility | Contrast 4.5:1, Alt text, Keyboard nav, ARIA labels | No focus rings, icon-only buttons without labels |
| 2 | Touch & Interaction | Min 44×44px, 8px+ spacing, loading feedback | Hover-only, instant state changes |
| 3 | Performance | WebP, lazy load, CLS < 0.1 | Layout thrash, no space reservation |
| 4 | Style Selection | Match product type, consistency, SVG icons | Mixing styles randomly, emoji as icons |
| 5 | Layout & Responsive | Mobile-first, viewport meta, no horizontal scroll | Fixed px widths, disable zoom |
| 6 | Typography & Color | Base 16px, line-height 1.5, semantic tokens | Text < 12px, gray-on-gray, raw hex |
| 7 | Animation | 150–300ms, conveys meaning, reduced-motion | Decorative-only, animating width/height |
| 8 | Forms & Feedback | Visible labels, error near field, progressive disclosure | Placeholder-only label, errors at top only |
| 9 | Navigation | Predictable back, ≤5 bottom nav items | Overloaded nav, broken back |
| 10 | Charts | Legends, tooltips, accessible colours | Colour-only meaning |

---

## This Project Stack

**MAS PeopleOS / HRMS** uses:
- React 18 + TypeScript + Vite
- Tailwind CSS
- shadcn/ui + Radix primitives
- Lucide React icons

Always run searches with `--stack shadcn` for component patterns.
Base font: system-ui/Inter. Colour system: slate scale (950→50).
Border radius convention: `rounded-xl` inputs, `rounded-2xl` cards, `rounded-3xl` sections.

---

## MAS HRMS Design Patterns (FROZEN)

**MANDATORY** for all HRMS pages. Reference: `data/projects/mas-hrms.csv`

### Core Visual Language

| Pattern | Usage | Code |
|---------|-------|------|
| **GlassCard** | All containers | `rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md` |
| **GradientHeader** | Page headers | `bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white` |

### Section-Specific Gradients

| Section | Gradient | Header Class |
|---------|----------|--------------|
| Bank Account | Blue | `bg-gradient-to-r from-blue-600 to-indigo-600 text-white` |
| PF/UAN/Identity | Purple | `bg-gradient-to-r from-purple-600 to-violet-600 text-white` |
| Emergency Contact | Amber | `bg-gradient-to-r from-amber-500 to-orange-500 text-white` |
| Nominee Details | Emerald | `bg-gradient-to-r from-emerald-500 to-green-500 text-white` |
| Attendance Summary | Teal | `bg-gradient-to-r from-teal-500 to-cyan-500 text-white` |
| Request Leave | Pink/Purple | `bg-gradient-to-r from-pink-500 to-purple-600 text-white` |

### Leave Balance Cards (Color by Type)

| Leave Type | Background | Border |
|------------|------------|--------|
| Casual Leave (CL) | `from-blue-50 to-indigo-50` | `border-blue-200` |
| Earned Leave (EL) | `from-emerald-50 to-green-50` | `border-emerald-200` |
| Medical Leave (ML) | `from-purple-50 to-violet-50` | `border-purple-200` |
| Leave Without Pay (LWP) | `from-amber-50 to-orange-50` | `border-amber-200` |
| Maternity Leave | `from-cyan-50 to-teal-50` | `border-cyan-200` |
| Paternity Leave | `from-pink-50 to-rose-50` | `border-pink-200` |

### Component Patterns

- **Donut Charts**: 56px size, 5px stroke, color matches leave type, center shows remaining days
- **Icon Containers**: `w-8 h-8 rounded-lg flex items-center justify-center` with 15% opacity background
- **Status Badges**: `text-xs font-bold px-2 py-0.5 rounded-full` with colored backgrounds
- **Info Fields**: Compact layout with icon + label (10px uppercase) + value (bold text-gray-800)
- **Form Layout**: Grid with From/To labels for date pickers, inline selectors
- **Buttons**: Gradient with shadow `shadow-lg shadow-indigo-500/30`

### Design Rules

1. **Never white-only cards** — always add gradient backgrounds or colored sections
2. **Consistent icon containers** — match icon color to section theme
3. **Bold typography** — `font-bold` for values, `font-semibold` for labels
4. **High contrast** — `text-gray-800` or `text-gray-900` for readable text
5. **Smooth transitions** — `transition-all duration-200` on hover states

---

## Dashboard Design Patterns (Role-Based Pages)

**Applied patterns for HR/CEO/Manager/WFM dashboards:**

### #116 Employee Profile Card
- Avatar with initials fallback + department badge
- Quick action buttons (Change Manager, Password)
- No sensitive data exposed on card surface
- Gradient header with status badges

### #117 Leave Balance Widget
- Donut charts per leave type
- Color-coded: Green (EL), Blue (CL), Purple (ML), Amber (LWP)
- Progress bars showing used vs total
- "X days" in center of donut

### #118 Attendance Heatmap
- Color-coded grid cells: Present (green), Absent (red), Half-day (amber), Leave (purple), Weekend (gray), Holiday (blue)
- Weekly row view with day labels
- Intensity scale legend at bottom
- Hover tooltips with status details

### #120 Approval Workflow
- Timeline with stages (nodes connected by lines)
- Timestamps at each stage
- Approver names with avatars
- Animated progress indicator for current stage
- Completed stages: green checkmark

### #123 Dashboard KPI Tiles
- Animated counter numbers (count up on load)
- Sparklines for trend visualization
- Trend arrows: green up, red down
- Gradient backgrounds matching metric type
- Tone colors: blue (info), green (success), amber (warning), red (critical), violet (special)

### #39 Bento Grid Layout
- Modular cards with varied sizes (1x1, 2x1, 1x2)
- Asymmetric grid using `grid-cols-1 lg:grid-cols-2 xl:grid-cols-3`
- Soft shadows: `shadow-sm hover:shadow-md`
- Gap spacing: `gap-3 sm:gap-4`

### #3 Glassmorphism Cards
- Frosted glass: `bg-white/95 backdrop-blur-sm`
- Translucent borders: `border border-white/60`
- Rounded corners: `rounded-2xl`
- Subtle shadow on hover

### #98 Dark Glow Effects (Hero Sections)
- Ambient gradients on header
- Spotlight orbs: `radial-gradient(circle at 30% 20%, white, transparent 50%)`
- Neon accent borders on focus states
- Used sparingly on profile headers and feature banners

### ReferenceMetricGrid Pattern
```tsx
<ReferenceMetricGrid columns={5} loading={data.loading} metrics={[
  { label: "Selected Candidates", value: count, helper: "Vs Last 30 Days", icon: UserCheck, tone: "blue", trend: +5.2, href: "/ats/dashboard" },
  { label: "Onboarding Pending", value: pending, helper: "Awaiting completion", icon: Hourglass, tone: "amber" },
  { label: "BGV Pending", value: bgv, helper: "Verification open", icon: ShieldCheck, tone: "red" },
]} />
```

### Tone Color System (Dashboards)
| Tone | Icon BG | Value Text | Border | Use For |
|------|---------|------------|--------|---------|
| blue | `#edf4ff` | `#0b63e5` | `#dce8fb` | Info, headcount, selection |
| green | `#eaf8ef` | `#15803d` | `#d7f0df` | Success, completed, submitted |
| amber | `#fff4e8` | `#ea580c` | `#fee3c5` | Warning, pending, awaiting |
| red | `#fff0f1` | `#dc2626` | `#ffdadd` | Critical, stuck, overdue |
| violet | `#f3efff` | `#6d28d9` | `#e6ddff` | Special, DPDP, privacy |
| slate | `#f1f4f8` | `#0b1f44` | `#e3e9f2` | Neutral, default |

---

## Adaptive Design Intelligence

**The patterns above are examples, not limits.** Apply this design thinking to ANY new HRMS page:

### Pattern Selection Logic

| Page Contains | Apply These Patterns |
|---------------|---------------------|
| Employee data display | #116 Profile Card (avatar + badges, NO sensitive data exposed) |
| Leave/balance data | #117 Leave Widget (donut charts, color-coded by type) |
| Workflow/approval stages | #120 Approval Workflow (timeline nodes, timestamps, avatars) |
| KPI metrics/numbers | #123 KPI Tiles (sparklines, trend arrows, tone colors) |
| Multiple data sections | #39 Bento Grid (varied card sizes, asymmetric layout) |
| Cards/containers | #3 Glassmorphism (`bg-white/95 backdrop-blur-sm`) |
| Hero/header sections | #98 Dark Glow (gradient + spotlight orbs) |
| Calendar/schedule data | #118 Heatmap (color-coded grid, legend) |

### Color Assignment Logic

**Match gradient to data domain:**
| Domain | Gradient | Tone |
|--------|----------|------|
| Financial (salary, bank, billing) | Blue | `blue` |
| Statutory (PF, tax, compliance) | Purple | `violet` |
| Urgent/Emergency | Amber/Orange | `amber` |
| Success/Confirmed | Emerald/Green | `green` |
| Critical/Overdue | Red | `red` |
| Time/Attendance | Teal/Cyan | `blue` |
| Personal/HR | Pink/Rose | `violet` |

### New Page Checklist

Before implementing ANY new HRMS page:

1. **Identify data types** → Select matching gradients/tones
2. **Count sections** → Plan Bento grid (1x1, 2x1, 1x2 cards)
3. **Check for metrics** → Add KPI tiles with sparklines
4. **Check for workflows** → Add timeline with stages
5. **Check for lists** → Add avatars, badges, hover states
6. **Wrap everything** → GlassCard containers, gradient headers
7. **Never expose** → Salary, PAN, Aadhaar, bank details on surface

### Example: Applying to Unknown Page

**Payroll Summary Page** (never designed before):
- Financial data → Blue gradient header
- Monthly breakdown → Bento grid with 3 columns
- Earnings/Deductions → KPI tiles with green/red tones
- Approval status → Workflow timeline
- Employee list → Avatar circles, department badges
- Sensitive data → Masked (****1234), reveal on auth

**Recruitment Pipeline Page**:
- Hiring data → Blue/Violet gradient
- Funnel stages → Horizontal progress bars (like hiring funnel)
- Candidate cards → Avatar + status badges
- Interview schedule → Heatmap-style calendar
- Metrics → KPI tiles (Applications, Screened, Offered, Joined)

### Design Consistency Rules

1. **Same data type = Same color** across ALL pages
2. **Same component = Same styling** (a donut chart looks the same everywhere)
3. **Same interaction = Same feedback** (hover, click, loading states)
4. **Same layout density** for similar page types (dashboard=dense, profile=spacious)
5. **Same typography hierarchy** (h1=26px bold, h2=20px semibold, body=14px)

---

## MANDATORY: Responsive & Mobile-First

**EVERY UI must be responsive.** No exceptions.

### Breakpoint System
```css
/* Mobile first - base styles for 320px+ */
/* sm: 640px+  - Large phones, small tablets */
/* md: 768px+  - Tablets */
/* lg: 1024px+ - Small laptops */
/* xl: 1280px+ - Desktops */
/* 2xl: 1536px+ - Large screens */
```

### Responsive Grid Patterns
```tsx
// KPI Tiles: stack on mobile, row on desktop
className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"

// Bento Layout: single column mobile, multi-column desktop
className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"

// Side-by-side panels: stack on mobile
className="flex flex-col lg:flex-row gap-4"
```

### Mobile-Specific Rules

1. **Touch targets**: Minimum 44×44px for all buttons/links
2. **Font sizes**: Never below 14px on mobile
3. **Padding**: Use `p-4 sm:p-6` (more padding on desktop)
4. **Cards**: Full-width on mobile (`w-full`), constrained on desktop
5. **Tables**: Horizontal scroll wrapper OR card-based layout on mobile
6. **Modals**: Full-screen on mobile (`h-full sm:h-auto sm:max-h-[90vh]`)
7. **Forms**: Single column on mobile, multi-column on desktop
8. **Navigation**: Bottom nav or hamburger on mobile

### Never Do on Mobile

- ❌ Fixed pixel widths (use `w-full` or percentages)
- ❌ Horizontal scroll on main content
- ❌ Hover-only interactions (no hover on touch)
- ❌ Tiny close buttons or icons
- ❌ Multi-column forms that don't stack
- ❌ Tables with 5+ columns without scroll wrapper

### Implementation Rule

**FRONTEND ONLY**: When redesigning pages, NEVER modify:
- Backend API calls or endpoints
- Data fetching hooks or queries
- Business logic or validation
- Database connections

Only change: JSX structure, Tailwind classes, component layout, styling.
