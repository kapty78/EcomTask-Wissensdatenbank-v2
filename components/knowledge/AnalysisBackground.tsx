"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "motion/react";

const PHRASES = [
  // Deutsch
  "Semantische Vektoren werden verglichen...",
  "Ähnlichkeitsmatrix wird berechnet...",
  "Duplikate in Embedding-Clustern identifiziert",
  "Cosine-Similarity > 0.92 erkannt",
  "Kontextfenster wird analysiert...",
  "Wissensknoten werden traversiert",
  "Redundante Informationscluster gefunden",
  "Kreuzreferenzen werden geprüft...",
  "Token-Overlap wird kalkuliert...",
  "Faktenkonsistenz wird validiert",
  "Chunk-Grenzen werden optimiert...",
  "Embeddings werden normalisiert",
  "Hierarchische Cluster werden gebildet",
  "Quellenzuordnung wird verifiziert...",
  "Wissensgraph wird aktualisiert...",
  "Thematische Gruppierung läuft...",
  "Konfidenzwerte werden berechnet",
  "Zusammenführungsvorschläge generiert",
  "Vektorraum-Indexierung aktiv...",
  "Semantische Distanzberechnung...",
  "TF-IDF Gewichtung wird angepasst",
  "Bi-Encoder Matching gestartet...",
  "Cross-Encoder Re-Ranking...",
  "Hybrid-Search Pipeline aktiv",
  "Precision-Optimierung läuft",
  // Englisch
  "Retrieving semantic embeddings...",
  "Knowledge graph traversal in progress",
  "Document similarity threshold reached",
  "Fact extraction pipeline running...",
  "Neural ranking model inference...",
  "Contextual relevance scoring",
  // Latein
  "Scientia potentia est...",
  "Veritas lux in tenebris",
  "Cogito ergo sum",
  "Ex nihilo nihil fit",
  "Ad fontes — zu den Quellen",
  "Corpus linguisticum processatur",
];

// Slot grid — positioned around edges, avoiding center (30-70% x, 30-70% y)
// Each slot has a unique Y band to prevent vertical overlaps
const SLOTS: { x: number; y: number }[] = [
  // Top band (y: 3-8)
  { x: 3, y: 4 }, { x: 30, y: 3 }, { x: 68, y: 5 },
  // Upper band (y: 12-17)
  { x: 5, y: 13 }, { x: 82, y: 15 }, { x: 50, y: 12 },
  // Upper-mid band (y: 22-27)
  { x: 3, y: 23 }, { x: 75, y: 25 }, { x: 18, y: 26 },
  // Mid-upper band (y: 32-36) — left/right only
  { x: 3, y: 33 }, { x: 80, y: 35 },
  // Mid band (y: 42-46) — left/right only
  { x: 4, y: 43 }, { x: 78, y: 45 },
  // Mid-lower band (y: 52-56) — left/right only
  { x: 3, y: 53 }, { x: 82, y: 55 },
  // Lower-mid band (y: 62-66) — left/right only
  { x: 5, y: 63 }, { x: 76, y: 65 },
  // Lower band (y: 72-77)
  { x: 3, y: 73 }, { x: 68, y: 75 }, { x: 20, y: 74 },
  // Bottom band (y: 82-88)
  { x: 4, y: 83 }, { x: 40, y: 85 }, { x: 75, y: 84 },
  // Very bottom (y: 91-95)
  { x: 8, y: 92 }, { x: 60, y: 93 },
];

const PHRASE_STYLE = "text-base font-normal";

type Phase = "typing" | "pausing" | "deleting" | "done";

interface FloatingPhrase {
  id: number;
  text: string;
  x: number;
  y: number;
  displayText: string;
  phase: Phase;
  pauseTicks: number;
  pauseLimit: number;
  opacity: number;
  typeSpeed: number;
  tickAccum: number;
}

export const AnalysisBackground: React.FC = () => {
  const [phrases, setPhrases] = useState<FloatingPhrase[]>([]);
  const nextId = useRef(0);
  const usedPhrases = useRef<Set<number>>(new Set());
  const slotQueue = useRef<number[]>([]);
  const gridId = useRef(
    `analysis-grid-${Math.random().toString(36).slice(2, 8)}`
  );

  const getRandomPhrase = useCallback(() => {
    if (usedPhrases.current.size >= PHRASES.length) usedPhrases.current.clear();
    let idx: number;
    do {
      idx = Math.floor(Math.random() * PHRASES.length);
    } while (usedPhrases.current.has(idx));
    usedPhrases.current.add(idx);
    return PHRASES[idx];
  }, []);

  // Minimum vertical distance (in %) between any two active phrases
  // text-base = 16px, on a ~700px tall container that's ~2.3%, we use 7% for safe spacing
  const MIN_Y_GAP = 7;

  const getSlot = useCallback((activePhrases: FloatingPhrase[]) => {
    // Shuffle all slot indices
    const indices = SLOTS.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // Collect Y positions of all active (non-done) phrases
    const activeYs = activePhrases
      .filter((p) => p.phase !== "done")
      .map((p) => p.y);

    // Try each slot — pick the first one that doesn't overlap vertically
    for (const idx of indices) {
      const slot = SLOTS[idx];
      const candidateY = slot.y + (Math.random() - 0.5) * 3;
      const tooClose = activeYs.some((ay) => Math.abs(ay - candidateY) < MIN_Y_GAP);
      if (!tooClose) {
        return {
          x: slot.x + (Math.random() - 0.5) * 5,
          y: candidateY,
        };
      }
    }

    // Fallback: if everything is occupied, pick random slot anyway (rare)
    const fallbackSlot = SLOTS[indices[0]];
    return {
      x: fallbackSlot.x + (Math.random() - 0.5) * 5,
      y: fallbackSlot.y + (Math.random() - 0.5) * 3,
    };
  }, []);

  const spawn = useCallback(() => {
    const id = nextId.current++;
    const text = getRandomPhrase();

    // Need current phrases to check Y overlap + max 3 active limit
    setPhrases((prev) => {
      const activePhrases = prev.filter((p) => p.phase !== "done");
      // Max 3 visible at once — skip spawn if already at limit
      if (activePhrases.length >= 3) return prev;
      const { x, y } = getSlot(activePhrases);
      // Extreme range: 0.3 = blazing fast, 6 = very slow typewriter
      const r = Math.random();
      const typeSpeed = r < 0.2 ? 0.3 + Math.random() * 0.4   // 20% blazing fast (0.3-0.7)
                      : r < 0.5 ? 0.8 + Math.random() * 1.2   // 30% fast (0.8-2.0)
                      : r < 0.8 ? 2.0 + Math.random() * 1.5   // 30% medium (2.0-3.5)
                      :           3.5 + Math.random() * 2.5;   // 20% very slow (3.5-6.0)
      const pauseLimit = 20 + Math.floor(Math.random() * 35);

      return [
        ...activePhrases.slice(-14),
        {
          id,
          text,
          x,
          y,
          displayText: "",
          phase: "typing" as const,
          pauseTicks: 0,
          pauseLimit,
          opacity: 0,
          typeSpeed,
          tickAccum: 0,
        },
      ];
    });
  }, [getRandomPhrase, getSlot]);

  // Stagger initial 3 spawns, then continuous
  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // Only 3 initial spawns, well staggered
    const initialDelays = [400, 1600, 3200];
    for (const delay of initialDelays) {
      timeouts.push(setTimeout(spawn, delay));
    }

    // Then continuous spawns every 2.5-4.5s (the max-3 check inside spawn handles the cap)
    let intervalId: ReturnType<typeof setInterval>;
    timeouts.push(
      setTimeout(() => {
        const scheduleNext = () => {
          intervalId = setTimeout(() => {
            spawn();
            scheduleNext();
          }, 2500 + Math.random() * 2000);
        };
        scheduleNext();
      }, 4500)
    );

    return () => {
      timeouts.forEach(clearTimeout);
      if (intervalId) clearTimeout(intervalId);
    };
  }, [spawn]);

  // Typewriter animation loop
  useEffect(() => {
    const tick = setInterval(() => {
      setPhrases((prev) =>
        prev
          .map((p) => {
            if (p.phase === "typing") {
              const newAccum = p.tickAccum + 1;
              if (newAccum < p.typeSpeed) {
                const newOpacity = Math.min(
                  p.opacity + (0.28 - p.opacity) * 0.1,
                  0.28
                );
                return { ...p, tickAccum: newAccum, opacity: newOpacity };
              }
              const nextLen = p.displayText.length + 1;
              const newDisplay = p.text.slice(0, nextLen);
              const newOpacity = Math.min(
                p.opacity + (0.45 - p.opacity) * 0.1,
                0.45
              );
              if (nextLen >= p.text.length) {
                return {
                  ...p,
                  displayText: newDisplay,
                  opacity: newOpacity,
                  phase: "pausing" as const,
                  pauseTicks: 0,
                  tickAccum: 0,
                };
              }
              return {
                ...p,
                displayText: newDisplay,
                opacity: newOpacity,
                tickAccum: 0,
              };
            }
            if (p.phase === "pausing") {
              const newTicks = p.pauseTicks + 1;
              if (newTicks > p.pauseLimit) {
                return { ...p, phase: "deleting" as const, pauseTicks: 0 };
              }
              return { ...p, pauseTicks: newTicks };
            }
            if (p.phase === "deleting") {
              const nextLen = Math.max(0, p.displayText.length - 2);
              const newDisplay = p.text.slice(0, nextLen);
              const newOpacity = p.opacity - 0.005;
              if (nextLen <= 0 || newOpacity <= 0) {
                return { ...p, phase: "done" as const, opacity: 0 };
              }
              return { ...p, displayText: newDisplay, opacity: newOpacity };
            }
            return null;
          })
          .filter(Boolean) as FloatingPhrase[]
      );
    }, 60);

    return () => clearInterval(tick);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Grid pattern */}
      <svg className="absolute inset-0 h-full w-full" style={{ zIndex: 0 }}>
        <defs>
          <pattern
            id={gridId.current}
            width={40}
            height={40}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M.5 40V.5H40`}
              fill="none"
              stroke="currentColor"
              className="text-white/[0.008]"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gridId.current})`} />
      </svg>

      {/* Floating typewriter phrases */}
      {phrases.map((p) => (
        <div
          key={p.id}
          className="absolute select-none whitespace-nowrap pointer-events-none"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            opacity: p.opacity,
            filter: "blur(0.3px)",
          }}
        >
          <motion.span
            className={`${PHRASE_STYLE} bg-clip-text text-transparent`}
            style={{
              backgroundImage: "linear-gradient(110deg, #555, 35%, #bbb, 50%, #555, 75%, #555)",
              backgroundSize: "200% 100%",
            }}
            initial={{ backgroundPosition: "200% 0" }}
            animate={{ backgroundPosition: "-200% 0" }}
            transition={{
              repeat: Infinity,
              duration: 3 + Math.random() * 2,
              ease: "linear",
            }}
          >
            {p.displayText}
          </motion.span>
          {(p.phase === "typing" || p.phase === "pausing") && (
            <span
              className="inline-block w-[2px] h-[17px] ml-[2px] align-middle"
              style={{
                backgroundColor: "hsl(var(--primary) / 0.5)",
                animation: "pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
};
