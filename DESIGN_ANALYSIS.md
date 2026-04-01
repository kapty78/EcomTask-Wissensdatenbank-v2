# Design-System Analyse: EcomTask AI

Diese Analyse dokumentiert die Implementierung des Design-Systems ("Design Kit") der EcomTask AI Anwendung. Das System basiert auf einem modernen Stack mit Next.js, Tailwind CSS und Radix UI (Shadcn-Architektur), wurde jedoch stark angepasst ("Customized").

## 1. Technologie-Stack & Architektur

*   **Framework:** Next.js 14 (App Directory)
*   **Styling Engine:** Tailwind CSS v3.3
*   **UI Primitives:** Radix UI (Headless UI Components)
*   **Komponenten-Bibliothek:** Custom Implementierung basierend auf Shadcn UI + NextUI Einflüsse
*   **Icons:** Lucide React, Tabler Icons, FontAwesome (via CDN)
*   **Animationen:** Framer Motion, Tailwindcss-Animate

## 2. Farbpalette & Design-Tokens

Das Farbsystem ist eine Mischung aus Tailwind-Utility-Klassen und harten CSS-Variablen-Overrides.

### Primärfarben (aus `globals.css`)
Die Anwendung erzwingt ein spezifisches Dark-Mode-Theme durch globale CSS-Variablen, die teilweise die Standard-Tailwind-Konfiguration überschreiben.

| Token | Wert | Verwendung |
| :--- | :--- | :--- |
| `--primary-color` | `#E94F96` (Pink) | Haupt-Akzentfarbe, Branding |
| `--secondary-color` | `#FF72B6` | Sekundäre Akzente, Hover-States |
| `--bg-primary` | `#1e1e1e` | Haupthintergrund (Dark Mode) |
| `--bg-secondary` | `#252525` | Panels, Cards |
| `--text-color` | `#ffffff` | Standard Textfarbe |

### Chat-Spezifische Farben
Für das Kern-Feature (Chat) gibt es ein dediziertes Farbschema:

*   **Bot Hintergrund:** `#1e1e1e` (`--chat-bot-bg`)
*   **User Hintergrund:** `#ffffff` (`--chat-user-bg`) – *Hinweis: Im CSS als Weiß definiert, aber im Dark Mode oft transparent/angepasst.*
*   **Support Bot Primary:** `#3a8eff` (Blau) – Unterscheidung zwischen "AI Mitarbeiter" und "Support".

### Diskrepanz-Hinweis
Es existiert eine Inkonsistenz zwischen `tailwind.config.ts` und `globals.css`.
*   **Tailwind Config** erwartet Shadcn-Standard-Variablen (z.B. `hsl(var(--primary))`).
*   **Globals CSS** definiert eigene Variablen (z.B. `--primary-color`).
*   *Folge:* Standard Shadcn-Komponenten, die `bg-primary` nutzen, könnten fehlerhaft aussehen, sofern keine Fallbacks greifen oder die Variablen an anderer Stelle (z.B. inline) injiziert werden.

## 3. Typografie

*   **Hauptschriftart:** `Inter` (Google Font via Next.js Optimization).
*   **Fallback/System:** `Söhne`, `system-ui`, `Helvetica Neue`.
*   **Besonderheiten:**
    *   Globale Schriftgröße: `16px`.
    *   Spezifische Utility-Klassen wie `.line-clamp-3` für Textkürzungen.

## 4. UI Komponenten-Bibliothek (`components/ui`)

Die Anwendung verfügt über eine umfangreiche Sammlung atomarer Komponenten.

### Core Components (Shadcn/Radix Basis)
*   **Inputs:** `Button`, `Input`, `Textarea`, `Checkbox`, `Switch`, `Slider`, `RadioGroup`.
*   **Feedback:** `Toast`, `Sonner` (Advanced Toasts), `Alert`, `Progress`, `Skeleton`.
*   **Layout & Overlay:** `Card`, `Dialog`, `Sheet`, `Popover`, `Accordion`, `Tabs`, `ScrollArea`.
*   **Navigation:** `DropdownMenu`, `Menubar`, `NavigationMenu`.

### "Fancy" / High-End Komponenten
Diese Komponenten dienen speziellen visuellen Effekten (wahrscheinlich für Landing Pages oder Dashboards):
*   **`hyperspeed-background.tsx`**: Aufwendiger Hintergrund-Effekt.
*   **`squares-background.tsx`**: Geometrischer Hintergrund.
*   **`animated-list.tsx`**: Animierte Listen-Darstellung.
*   **`dock.jsx` / `Dock.css`**: macOS-artiges Dock-Menü.
*   **`screen-loader.tsx`**: Fullscreen Lade-Animation.

## 5. Visuelle Effekte & Animationen

Das Design setzt stark auf Bewegung und Glasmorphismus-Effekte:

1.  **Chat-Fade:** Ein starker Overlay-Effekt (`.chat-message-container::before/after`) erzeugt weiche Übergänge oben und unten im Chat-Fenster mit `backdrop-filter: blur(4px)`.
2.  **Glow-Effekte:** Animationen wie `@keyframes glow` erzeugen pulsierende Schatten.
3.  **Typing Indicators:** Mehrstufige Animationen (`typingAnimation`, `fadeIn`) für das "Nachdenken" der KI.
4.  **Custom Scrollbars:** Dünne, dunkelgraue Scrollbalken (`.custom-scrollbar`), um das native OS-Design zu verbergen.
5.  **Reasoning Steps:** Spezielles Styling für "Gedankenschritte" der KI mit Einrückungen und Verbindungslinien.

## 6. Assets & Branding

*   **Logo:** SVG-basiertes Logo (`components/icons/chatbotui-svg.tsx`), gesteuert durch die `Brand`-Komponente.
*   **Name:** "EcomTask AI".
*   **Favicon:** Vorhanden als `.svg` und `.png` in `public/`.

## Zusammenfassung für Entwickler

Das "Design Kit" ist vollständig im Code implementiert (Code-First Design System). Um Änderungen vorzunehmen:
1.  **Globale Farben:** `app/globals.css` (für harte Werte wie den pinken Akzent).
2.  **Komponenten-Struktur:** `components/ui/[component].tsx` (Radix/Tailwind Logik).
3.  **Animationen:** `tailwind.config.ts` (Extend Theme) und `globals.css` (Keyframes).

