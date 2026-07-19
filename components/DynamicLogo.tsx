"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { SIDEBAR_BRAND_MARK_SIZE } from "./sidebar-icon-styles";

/** Wissensdatenbank-Marke (transparent PNG — volle Auflösung für max. Schärfe). */
const LOGO_SRC = "/wissensdatenbank-logo-v2.png";

interface DynamicLogoProps {
  /** CSS-Klassen für zusätzliches Styling */
  className?: string;
  /** Alt-Text für Accessibility */
  alt?: string;
  /** Kantenlänge in px */
  size?: number;
  /**
   * „Lebendige" KI-Rotation: dreht organisch nach links/rechts (mal sanft,
   * mal ruckartig-schnell, dann abbremsend) und beruhigt sich bei Hover.
   * Respektiert prefers-reduced-motion.
   */
  living?: boolean;
}

/**
 * Sidebar-/Marken-Logo. Rendert das neue transparente Logo als Bild.
 * Mit `living` bekommt es eine organische, „lebendige" Eigenrotation.
 * In einen Span gekapselt, damit die `[&>svg]:size-5`-Regel des
 * SidebarMenuButton nicht greift.
 */
export function DynamicLogo({
  className = "",
  alt = "Wissensdatenbank",
  size = SIDEBAR_BRAND_MARK_SIZE,
  living = false,
}: DynamicLogoProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const hoveredRef = useRef(false);

  useEffect(() => {
    if (!living) return;
    const img = imgRef.current;
    if (!img) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let angle = 0; // Grad
    let vel = 0; // Grad/s
    let raf = 0;
    let wake: ReturnType<typeof setTimeout> | undefined;
    let last = performance.now();
    let nextImpulse = last + 600 + Math.random() * 1200;
    let inView = true;
    let pageVisible = typeof document === "undefined" || !document.hidden;
    let running = false;

    // Unterhalb dieser Schwellen gilt das Logo als „eingeschlafen": rAF stoppt
    // und will-change wird entfernt, damit der Browser den Compositor-Layer
    // freigibt. Eine dauerlaufende rAF-Schleife hielt den Layer sonst permanent
    // am Leben (Mit-Ursache fuer Flackern/schwarze Tiles beim Pinch-Zoom).
    const SETTLED_ANGLE_DEG = 0.05;
    const SETTLED_VEL_DEG_S = 0.5;

    const isActive = () => inView && pageVisible;

    const start = () => {
      if (running || !isActive()) return;
      running = true;
      img.style.willChange = "transform";
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    // Bis zum naechsten Impuls schlafen statt pro Frame zu pollen.
    const sleep = (now: number) => {
      running = false;
      img.style.willChange = "";
      if (nextImpulse - now < 60) {
        nextImpulse = now + 900 + Math.random() * 2400;
      }
      wake = setTimeout(wakeUp, nextImpulse - now);
    };

    const wakeUp = () => {
      if (!isActive()) return;
      if (hoveredRef.current) {
        // Beim Hover keine Impulse — spaeter erneut pruefen.
        nextImpulse = performance.now() + 900 + Math.random() * 2400;
        wake = setTimeout(wakeUp, nextImpulse - performance.now());
        return;
      }
      start();
    };

    const suspend = () => {
      cancelAnimationFrame(raf);
      clearTimeout(wake);
      running = false;
      img.style.willChange = "";
    };

    const resume = () => {
      if (!isActive() || running) return;
      clearTimeout(wake);
      if (nextImpulse < performance.now() + 200) {
        nextImpulse = performance.now() + 200 + Math.random() * 800;
      }
      start();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (hoveredRef.current) {
        // Beruhigt sich sanft und stellt sich aufrecht (kritisch gedämpft) —
        // „merkt", dass der Cursor da ist, und hält an.
        const k = 9;
        const d = 2 * Math.sqrt(k);
        vel += (-k * angle - d * vel) * dt;
      } else {
        // Reibung: bremst jeden Schwung organisch ab.
        vel *= Math.pow(0.12, dt);
        // Schwache Zentrierung → pendelt links/rechts statt wegzudriften.
        vel += -1.4 * angle * dt;
        // Gelegentliche Impulse: meist sanft, ab und zu ruckartig-schnell.
        if (now >= nextImpulse) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const jerky = Math.random() < 0.28;
          const mag = jerky
            ? 150 + Math.random() * 230
            : 30 + Math.random() * 110;
          vel += dir * mag;
          nextImpulse =
            now + (jerky ? 350 + Math.random() * 700 : 900 + Math.random() * 2400);
        }
      }

      angle += vel * dt;

      if (
        Math.abs(angle) < SETTLED_ANGLE_DEG &&
        Math.abs(vel) < SETTLED_VEL_DEG_S &&
        now < nextImpulse - 50
      ) {
        angle = 0;
        vel = 0;
        img.style.transform = "";
        sleep(now);
        return;
      }

      img.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      raf = requestAnimationFrame(frame);
    };

    // Offscreen (z.B. uebermalte Panels, gescrollte Listen) und versteckte
    // Tabs animieren nicht.
    const io = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true;
      if (isActive()) resume();
      else suspend();
    });
    io.observe(img);

    const onVisibilityChange = () => {
      pageVisible = !document.hidden;
      if (isActive()) resume();
      else suspend();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    start();

    return () => {
      suspend();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      img.style.transform = "";
    };
  }, [living]);

  return (
    <span
      className="inline-flex shrink-0"
      onPointerEnter={living ? () => { hoveredRef.current = true; } : undefined}
      onPointerLeave={living ? () => { hoveredRef.current = false; } : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={LOGO_SRC}
        width={size}
        height={size}
        alt={alt}
        draggable={false}
        className={cn(
          "block shrink-0 select-none",
          // will-change setzt der Animations-Effect nur waehrend echter Bewegung —
          // statisch gesetzt wuerde es den Compositor-Layer dauerhaft am Leben halten
          living && "[transform-origin:50%_50%]",
          className,
        )}
      />
    </span>
  );
}

interface LogoSpinnerProps {
  /** Kantenlänge in px */
  size?: number;
  className?: string;
}

/**
 * Marken-Logo als Lade-Indikator: dreht sich kontinuierlich, solange es
 * gerendert wird. Ersetzt generische Spinner (Loader2) überall dort, wo
 * "die KI arbeitet gerade" gemeint ist — z.B. im Agent-Trace des Chats.
 */
export function LogoSpinner({ size = 14, className }: LogoSpinnerProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("brand-logo-spin block shrink-0 select-none", className)}
    />
  );
}
