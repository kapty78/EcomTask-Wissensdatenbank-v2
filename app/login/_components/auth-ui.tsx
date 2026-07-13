"use client"

import { ReactNode } from "react"
import { Loader2 } from "lucide-react"

interface PrimaryButtonProps {
  children: ReactNode
  loading?: boolean
  loadingLabel?: string
}

export function PrimaryButton({
  children,
  loading = false,
  loadingLabel
}: PrimaryButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-semibold text-[#161616] transition-all duration-150 hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1c1c] disabled:opacity-60"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  )
}

interface SecondaryButtonProps {
  children: ReactNode
  onClick: () => void
  loading?: boolean
  loadingLabel?: string
}

export function SecondaryButton({
  children,
  onClick,
  loading = false,
  loadingLabel
}: SecondaryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-[15px] font-medium text-white/90 transition-all duration-150 hover:border-white/[0.14] hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1c1c] disabled:opacity-60"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  )
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3.5 py-2.5 text-sm leading-relaxed text-red-300/90"
    >
      {children}
    </div>
  )
}

export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <div className="h-px flex-1 bg-white/[0.08]" />
      <span className="text-xs text-white/30">{label}</span>
      <div className="h-px flex-1 bg-white/[0.08]" />
    </div>
  )
}

interface MicrosoftButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

export function MicrosoftButton({
  label,
  onClick,
  disabled = false
}: MicrosoftButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-[15px] font-medium text-white/90 transition-all duration-150 hover:border-white/[0.14] hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1c1c] disabled:opacity-60"
    >
      <svg
        className="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="1" y="1" width="10" height="10" fill="#F35325" />
        <rect x="13" y="1" width="10" height="10" fill="#81BC06" />
        <rect x="1" y="13" width="10" height="10" fill="#05A6F0" />
        <rect x="13" y="13" width="10" height="10" fill="#FFBA08" />
      </svg>
      <span>{label}</span>
    </button>
  )
}
