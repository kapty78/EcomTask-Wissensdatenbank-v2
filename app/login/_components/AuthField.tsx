"use client"

import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface AuthFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  error?: string | null
  /** Statisches Suffix im Feld, z. B. ".app.ecomtask.cloud" */
  suffix?: string
  /** Interaktives Element rechts im Feld, z. B. Passwort-Toggle */
  trailing?: ReactNode
  /** Aktion rechts neben dem Label, z. B. "Passwort vergessen?" */
  labelAction?: ReactNode
  placeholder?: string
  autoComplete?: string
  autoFocus?: boolean
  inputMode?: "text" | "email" | "numeric"
  inputClassName?: string
}

export function AuthField({
  id,
  label,
  value,
  onChange,
  type = "text",
  error,
  suffix,
  trailing,
  labelAction,
  placeholder,
  autoComplete,
  autoFocus,
  inputMode,
  inputClassName
}: AuthFieldProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="block text-[13px] font-medium text-white/60"
        >
          {label}
        </label>
        {labelAction}
      </div>
      <div
        className={cn(
          "flex h-11 items-center overflow-hidden rounded-xl border bg-white/[0.04] transition-all duration-150",
          "focus-within:border-[#ff55c9]/50 focus-within:bg-white/[0.05] focus-within:ring-[3px] focus-within:ring-[#ff55c9]/10",
          error ? "border-red-400/40" : "border-white/[0.08]"
        )}
      >
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          inputMode={inputMode}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            "auth-input h-full w-full min-w-0 flex-1 bg-transparent px-3.5 text-[15px] text-white outline-none placeholder:text-white/25",
            inputClassName
          )}
        />
        {suffix && (
          <span className="select-none pr-3.5 text-sm text-white/30">
            {suffix}
          </span>
        )}
        {trailing && <div className="flex items-center pr-1.5">{trailing}</div>}
      </div>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1.5 text-[13px] text-red-300/90"
        >
          {error}
        </p>
      )}
    </div>
  )
}
