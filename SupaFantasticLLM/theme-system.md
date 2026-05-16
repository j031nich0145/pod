# Universal Theme System
### A portable, schema-first design token architecture for every project you build

---

## Philosophy

Every app you build shares the same visual DNA — surfaces, text, accents, shapes, spacing, shadows. Instead of rewriting or copying styles between projects, the Universal Theme System defines a **single canonical JSON object** as the source of truth for all of it.

Drop the three theme files into any React project, wrap your root in `<ThemeProvider>`, and you get:

- 5 polished built-in themes out of the box
- System / Light / Dark auto modes
- A live theme editor with color pickers, shape controls, and typography fields
- Custom theme creation, saving, import, export, and download as `.json`
- Every token applied as CSS custom properties on `:root` — usable anywhere (vanilla CSS, styled-components, Tailwind, anything)
- Full persistence via `localStorage` with a race-condition-safe load guard

---

## File Structure

```
src/
└── theme/
    ├── themes.js          ← Schema, presets, helpers
    ├── ThemeProvider.jsx  ← React context, persistence, system detection
    └── ThemeEditor.jsx    ← UI panel: picker, editor, import/export
```

---

## The Theme Object Schema

Every theme is a plain JSON object with six namespaces. All fields are intentional — nothing is decorative.

```json
{
  "meta": { ... },
  "colors": { ... },
  "typography": { ... },
  "shape": { ... },
  "spacing": { ... },
  "effects": { ... }
}
```

### `meta` — Identity

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "author": "you",
  "description": "What this theme evokes",
  "tags": ["dark", "minimal"],
  "builtIn": false
}
```

`id` must be unique and kebab-case. `builtIn: true` prevents deletion in the UI.

---

### `colors` — The Full Palette

```json
{
  "bg":                  "#0a0a0a",
  "panel":               "#111111",
  "sidebar":             "#0d0d0d",
  "surface":             "#161616",
  "surfaceHover":        "#1e1e1e",

  "border":              "rgba(255,255,255,0.07)",
  "borderStrong":        "rgba(255,255,255,0.15)",

  "text":                "#e2e2e2",
  "textMuted":           "#888888",
  "textSubtle":          "#555555",

  "accent":              "#6366f1",
  "accentHover":         "#4f52d0",
  "accentFg":            "#ffffff",
  "accentSubtle":        "rgba(99,102,241,0.12)",

  "userBubble":          "#6366f1",
  "userBubbleFg":        "#ffffff",
  "assistantBubble":     "#161616",
  "assistantBubbleFg":   "#e2e2e2",

  "inputBg":             "#111111",
  "inputBorder":         "rgba(255,255,255,0.08)",
  "inputFocusBorder":    "rgba(99,102,241,0.6)",

  "danger":              "#ef4444",
  "dangerSubtle":        "rgba(239,68,68,0.12)",
  "success":             "#22c55e",
  "warning":             "#f59e0b",

  "scrollbar":           "#1f1f1f",
  "overlay":             "rgba(0,0,0,0.7)",
  "code":                "#1a1a1a"
}
```

**Accepts any valid CSS color string** — hex, rgb, rgba, hsl, `transparent`.

---

### `typography` — Font Stack

```json
{
  "fontFamily":        "'DM Sans', 'Segoe UI', sans-serif",
  "fontFamilyMono":    "'JetBrains Mono', 'Fira Code', monospace",
  "fontFamilyDisplay": "'Syne', 'DM Sans', sans-serif",
  "fontSizeBase":      "14px",
  "fontSizeSm":        "12px",
  "fontSizeLg":        "16px",
  "lineHeight":        "1.6",
  "letterSpacing":     "-0.01em",
  "fontWeightNormal":  400,
  "fontWeightMedium":  500,
  "fontWeightBold":    700
}
```

Three font stacks: `fontFamily` for UI, `fontFamilyMono` for code, `fontFamilyDisplay` for headings. You can point these at Google Fonts, system fonts, or local variable fonts.

---

### `shape` — Corner Radii

```json
{
  "cardRadius":        "12px",
  "buttonRadius":      "8px",
  "inputRadius":       "10px",
  "bubbleRadius":      "18px",
  "sidebarItemRadius": "8px",
  "modalRadius":       "16px",
  "pillRadius":        "999px",
  "avatarRadius":      "50%"
}
```

This is where the personality of a theme lives. Set everything to `"2px"` for Terminal mode. Set `pillRadius` to `"999px"` for a modern SaaS feel. Set `avatarRadius` to `"6px"` for a squircle-adjacent look.

---

### `spacing` — Layout Units

```json
{
  "xs":              "4px",
  "sm":              "8px",
  "md":              "16px",
  "lg":              "24px",
  "xl":              "32px",
  "sidebarPadding":  "12px",
  "messagePadding":  "20px"
}
```

Extend this with any app-specific spacing tokens you need (e.g. `"navHeight"`, `"cardGap"`).

---

### `effects` — Depth & Motion

```json
{
  "shadowSm":          "0 1px 4px rgba(0,0,0,0.3)",
  "shadowMd":          "0 4px 16px rgba(0,0,0,0.5)",
  "shadowLg":          "0 12px 40px rgba(0,0,0,0.6)",
  "shadowAccent":      "0 0 20px rgba(99,102,241,0.3)",
  "transitionSpeed":   "0.15s",
  "transitionEasing":  "cubic-bezier(0.4, 0, 0.2, 1)",
  "glassBg":           "rgba(255,255,255,0.03)",
  "blurAmount":        "12px",
  "gradientAccent":    "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
}
```

`shadowAccent` is used for glowing focus rings or hover effects on accent-colored elements. `glassBg` + `blurAmount` power glassmorphism cards when combined with `backdrop-filter`.

---

## Built-In Themes

| ID | Name | Vibe |
|----|------|------|
| `void` | **Void** | Ultra-dark, pure focus, indigo accent |
| `anthropic` | **Anthropic** | Warm dark, terracotta, serif-forward |
| `gemstone` | **Gemstone** | Deep teal, scientific, IBM Plex |
| `terminal` | **Terminal** | Amber phosphor CRT, monospace everything, no radius |
| `ivory` | **Ivory** | Warm light, paper-white, Lora serif |
| `light` | **Light** | System auto light |
| `dark` | **Dark** | System auto dark |

---

## CSS Custom Properties

`applyThemeToCSSVars(theme)` writes every token to `:root` as a CSS variable. This means themes work **outside React** too — in vanilla CSS, SCSS, or any component that reads CSS vars.

### Full Variable Reference

```css
/* Surfaces */
var(--color-bg)
var(--color-panel)
var(--color-sidebar)
var(--color-surface)
var(--color-surface-hover)

/* Borders */
var(--color-border)
var(--color-border-strong)

/* Text */
var(--color-text)
var(--color-text-muted)
var(--color-text-subtle)

/* Accent */
var(--color-accent)
var(--color-accent-hover)
var(--color-accent-fg)
var(--color-accent-subtle)

/* Chat */
var(--color-user-bubble)
var(--color-user-bubble-fg)
var(--color-assistant-bubble)
var(--color-assistant-bubble-fg)

/* Inputs */
var(--color-input-bg)
var(--color-input-border)
var(--color-input-focus-border)

/* Semantic */
var(--color-danger)
var(--color-danger-subtle)
var(--color-success)
var(--color-warning)
var(--color-scrollbar)
var(--color-overlay)
var(--color-code)

/* Typography */
var(--font-family)
var(--font-family-mono)
var(--font-family-display)
var(--font-size-base)
var(--font-size-sm)
var(--font-size-lg)
var(--line-height)
var(--letter-spacing)

/* Shape */
var(--radius-card)
var(--radius-button)
var(--radius-input)
var(--radius-bubble)
var(--radius-sidebar-item)
var(--radius-modal)
var(--radius-pill)
var(--radius-avatar)

/* Spacing */
var(--spacing-xs)
var(--spacing-sm)
var(--spacing-md)
var(--spacing-lg)
var(--spacing-xl)
var(--spacing-sidebar)
var(--spacing-message)

/* Effects */
var(--shadow-sm)
var(--shadow-md)
var(--shadow-lg)
var(--shadow-accent)
var(--transition-speed)
var(--transition-easing)
var(--glass-bg)
var(--blur-amount)
var(--gradient-accent)
```

---

## Setup: Drop Into Any React Project

### 1. Copy the files

```
your-project/src/theme/
├── themes.js
├── ThemeProvider.jsx
└── ThemeEditor.jsx
```

### 2. Wrap your root

```jsx
// index.js or main.jsx
import { ThemeProvider } from './theme/ThemeProvider';

root.render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
```

### 3. Use in any component

```jsx
import { useTheme } from './theme/ThemeProvider';

function MyComponent() {
  const { theme, switchTheme } = useTheme();

  return (
    <div style={{ background: theme.colors.bg, color: theme.colors.text }}>
      Hello
    </div>
  );
}
```

Or skip the hook entirely and use CSS vars directly:

```css
.my-card {
  background: var(--color-surface);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-md);
  color: var(--color-text);
  font-family: var(--font-family);
  transition: all var(--transition-speed) var(--transition-easing);
}
```

### 4. Add the theme editor button

```jsx
import { ThemeEditor } from './theme/ThemeEditor';
import { useTheme } from './theme/ThemeProvider';

function App() {
  const { editorOpen, setEditorOpen } = useTheme();

  return (
    <>
      <button onClick={() => setEditorOpen(true)}>🎨 Theme</button>
      {editorOpen && <ThemeEditor onClose={() => setEditorOpen(false)} />}
    </>
  );
}
```

---

## ThemeProvider API

```jsx
const {
  theme,                    // Active theme object
  mode,                     // "void" | "dark" | "light" | "system" | custom id
  allThemes,                // All themes (built-in + custom)
  builtInThemes,            // Built-in themes only
  customThemes,             // User-created themes
  editorOpen,               // boolean

  switchTheme(id),          // Switch to any theme by id or mode keyword
  setEditorOpen(bool),      // Open/close the editor panel
  saveCustomTheme(obj),     // Add or update a custom theme — immediately persists + applies
  deleteCustomTheme(id),    // Remove a custom theme
  importTheme(jsonString),  // Import one or many themes from JSON → { success, count, error }
  exportTheme(id),          // Returns a JSON string for the theme
  downloadTheme(id),        // Downloads theme as .json file
  downloadAllCustomThemes() // Downloads all custom themes as a bundle .json
} = useTheme();
```

---

## Helper Functions (from `themes.js`)

```js
import {
  findTheme,          // findTheme(themesArray, id) → theme object
  isValidTheme,       // isValidTheme(obj) → boolean
  createBlankTheme,   // createBlankTheme(baseTheme) → new custom theme scaffold
  applyThemeToCSSVars // applyThemeToCSSVars(theme) → writes all tokens to :root
} from './theme/themes';
```

`createBlankTheme(base)` is the entry point for programmatic theme generation — pass it any base theme and get a new editable copy with a fresh unique ID and `builtIn: false`.

---

## Sharing & Portability

Themes are just JSON. To share one:

```bash
# Copy to clipboard from the editor, or download as a file:
my-theme.json
```

To import in another project:

```js
import myTheme from './my-theme.json';
import { saveCustomTheme } from './theme/ThemeProvider'; // or via the editor UI
```

Or paste the JSON directly into the Import tab of the theme editor in any app using this system.

---

## Extending the Schema

The schema is designed to be extended per-project without breaking portability. Add new keys to any namespace:

```json
{
  "shape": {
    "cardRadius": "12px",
    "chartBarRadius": "4px",
    "mapMarkerRadius": "50% 50% 50% 0"
  },
  "colors": {
    "chartLine": "#6366f1",
    "chartFill": "rgba(99,102,241,0.15)",
    "mapHighlight": "#26d0ce"
  }
}
```

Apps that don't know about `chartLine` ignore it. Apps that do use it get consistent cross-theme coloring for free.

---

## localStorage Keys

| Key | Contents |
|-----|----------|
| `sf_theme_mode` | Active mode ID (e.g. `"void"`, `"my-custom-theme"`) |
| `sf_theme_custom` | JSON array of all custom theme objects |

Prefix `sf_` can be changed in `ThemeProvider.jsx` if you're running multiple apps on the same domain.

---

## Roadmap / Ideas

- **Theme inheritance** — `extends: "void"` to override only specific tokens
- **Animation presets** — `effects.animationPreset: "snappy" | "smooth" | "none"`
- **Dark/light variants per theme** — each theme object contains both a `dark` and `light` subtree, auto-selected by system preference
- **Figma export** — generate a Figma variable collection JSON from any theme
- **Tailwind config generator** — `generateTailwindTheme(theme)` → `tailwind.config.js` compatible object
- **Design token format** — export as W3C Design Token Community Group `.tokens.json`