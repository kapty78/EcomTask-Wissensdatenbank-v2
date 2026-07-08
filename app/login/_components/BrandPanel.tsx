"use client"

import Image from "next/image"
import { motion } from "motion/react"
import { HyperspeedBackground } from "@/components/ui/hyperspeed-background"

const TAGS = ["Dokumente", "Knowledge Graph", "Semantische Suche"]

/**
 * Linkes Brand-Panel der Login-Seite: schwebendes, abgerundetes Canvas mit
 * Hyperspeed-Partikeln, EcomTask-Logo und Produkt-Statement.
 * Der Text-Layer ist pointer-events-none, damit das Partikel-Easter-Egg
 * klickbar bleibt.
 */
export function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden rounded-3xl border border-white/[0.06] bg-[#1a1a1a] lg:flex lg:w-[46%] xl:w-1/2">
      <HyperspeedBackground
        contained
        color="#ff55c9"
        particleCount={90}
        speed={1.6}
        fadeColor="rgba(26, 26, 26, 0.45)"
      />

      {/* Atmosphäre: Brand-Glow unten links + Abdunklung für Textkontrast */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(85% 60% at 18% 112%, rgba(255,85,201,0.16) 0%, rgba(255,85,201,0) 60%), linear-gradient(to top, rgba(20,20,20,0.55) 0%, rgba(20,20,20,0) 38%)"
        }}
      />

      <div className="pointer-events-none relative z-[2] flex w-full flex-col justify-between p-10 xl:p-12">
        <div className="flex items-center">
          <Image
            src="/EcomTask.svg"
            alt="EcomTask Logo"
            width={140}
            height={56}
            style={{ height: "auto" }}
            priority
          />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="relative flex items-center justify-center">
            <div
              aria-hidden
              className="pointer-events-none absolute h-56 w-56 rounded-full blur-3xl animate-[pulse_4s_ease-in-out_infinite]"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,85,201,0.4) 0%, rgba(255,85,201,0) 70%)"
              }}
            />
            <motion.span
              className="pointer-events-auto"
              animate={{ y: [0, -10, 0], rotate: [0, 2, -2, 0] }}
              transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
            >
              <Image
                src="/wissensdatenbank-logo-v2.png"
                alt=""
                aria-hidden
                width={128}
                height={128}
                priority
                className="relative h-auto w-[128px] drop-shadow-[0_12px_36px_rgba(255,85,201,0.4)]"
              />
            </motion.span>
          </div>
        </div>

        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white xl:text-[34px]">
            Das Wissen hinter Ihren KI-Mitarbeitern.
          </h2>
          <p className="text-[15px] leading-relaxed text-white/55">
            Dokumente, Graph und semantische Suche in einer Plattform. Die
            Quelle für jede Antwort Ihrer Agenten.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {TAGS.map(tag => (
              <span
                key={tag}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/60"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
