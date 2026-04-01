"use client"

import React, { useState, useRef, useEffect } from "react"
import clsx from "clsx"
import Image from "next/image"
import { Search, X, ArrowLeft, ArrowRight } from "lucide-react"

interface ChunkModalHeaderProps {
  title: string
  subtitle?: string
  onClose: () => void
  headerSearchQuery: string
  onHeaderSearchChange: (value: string) => void
  onResetHeaderSearch: () => void
  showHeaderSearchResults: boolean
  onShowHeaderSearchResults: (value: boolean) => void
  headerSearchResults: {
    chunks: Array<any>
    facts: Array<any>
  }
  relatedChunks: Array<any>
  currentChunkIndex: number
  onNavigateToChunk: (index: number) => void
  onHeaderSearchResultClick: (type: "chunk" | "fact", item: any) => void
}

function SearchResultsDropdown({
  headerSearchResults,
  relatedChunks,
  onHeaderSearchResultClick,
}: {
  headerSearchResults: { chunks: Array<any>; facts: Array<any> }
  relatedChunks: Array<any>
  onHeaderSearchResultClick: (type: "chunk" | "fact", item: any) => void
}) {
  return (
    <div className="absolute left-0 right-0 top-full mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-zinc-900 shadow-2xl z-[100]">
      {headerSearchResults.chunks.length > 0 ? (
        <div className="p-3 border-b border-border">
          <p className="text-xs text-muted-foreground mb-2">
            Chunks ({headerSearchResults.chunks.length})
          </p>
          <div className="space-y-2">
            {headerSearchResults.chunks.map((chunk: any) => (
              <button
                key={chunk.id}
                className="w-full rounded bg-card hover:bg-muted p-2 text-left transition-colors"
                onClick={() => onHeaderSearchResultClick("chunk", chunk)}
              >
                <span className="block text-xs text-primary mb-1">
                  Chunk {Math.max(1, relatedChunks.findIndex((item) => item.id === chunk.id) + 1)}
                </span>
                <span className="block text-xs text-muted-foreground line-clamp-2">
                  {chunk.content.substring(0, 120)}...
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {headerSearchResults.facts.length > 0 ? (
        <div className="p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Fakten ({headerSearchResults.facts.length})
          </p>
          <div className="space-y-2">
            {headerSearchResults.facts.map((fact: any) => (
              <button
                key={fact.id}
                className="w-full rounded bg-card hover:bg-muted p-2 text-left transition-colors"
                onClick={() => onHeaderSearchResultClick("fact", fact)}
              >
                {fact.question ? (
                  <span className="block text-xs text-muted-foreground mb-1">
                    {fact.question}
                  </span>
                ) : null}
                <span className="block text-xs text-muted-foreground line-clamp-2">
                  {fact.content}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ChunkModalHeader({
  title,
  subtitle,
  onClose,
  headerSearchQuery,
  onHeaderSearchChange,
  onResetHeaderSearch,
  showHeaderSearchResults,
  onShowHeaderSearchResults,
  headerSearchResults,
  relatedChunks,
  currentChunkIndex,
  onNavigateToChunk,
  onHeaderSearchResultClick
}: ChunkModalHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasSearchResults =
    headerSearchResults.chunks.length > 0 || headerSearchResults.facts.length > 0

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [searchOpen])

  const handleCloseSearch = () => {
    setSearchOpen(false)
    onResetHeaderSearch()
    onShowHeaderSearchResults(false)
  }

  return (
    <div className="relative z-50 bg-[#1a1a1a] border-b border-white/10 shrink-0 rounded-t-xl">
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3">
        {/* Linker Bereich: Titel */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
          <div className="hidden sm:flex h-7 w-7 items-center justify-center rounded border-border bg-card flex-shrink-0 relative overflow-hidden">
            <Image
              src="/favicon.svg"
              alt="Logo"
              fill
              className="object-contain p-1"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xs sm:text-sm font-medium text-foreground truncate">
              {title}
            </h2>
            {subtitle ? (
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {/* Rechter Bereich: Suche-Button, Navigation & Close */}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Suche-Button (Lupe) */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Suche in Chunks und Fakten"
          >
            <Search className="size-3.5 sm:size-4" />
          </button>

          {relatedChunks.length > 1 ? (
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => onNavigateToChunk(currentChunkIndex - 1)}
                disabled={currentChunkIndex === 0}
                className="p-1 rounded hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground transition-colors"
                title="Vorheriger Chunk"
              >
                <ArrowLeft className="size-3.5 sm:size-4" />
              </button>
              <span className="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline whitespace-nowrap">
                {currentChunkIndex + 1}/{relatedChunks.length}
              </span>
              <span className="text-[10px] sm:hidden text-muted-foreground">
                {currentChunkIndex + 1}/{relatedChunks.length}
              </span>
              <button
                type="button"
                onClick={() => onNavigateToChunk(currentChunkIndex + 1)}
                disabled={currentChunkIndex === relatedChunks.length - 1}
                className="p-1 rounded hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground transition-colors"
                title="Nächster Chunk"
              >
                <ArrowRight className="size-3.5 sm:size-4" />
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="p-1 sm:p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label="Schließen"
          >
            <X className="size-3.5 sm:size-4" />
          </button>
        </div>
      </div>

      {/* Expandierbarer Suchbereich - unter dem Header */}
      {searchOpen && (
        <div className="border-t border-white/10 bg-[#1a1a1a] px-3 py-2">
          <div className="relative">
            <div className="flex items-center gap-2 bg-muted border border-border rounded px-3 py-1.5">
              <Search className="size-3.5 text-muted-foreground flex-shrink-0" />
              <input
                ref={searchInputRef}
                className="w-full bg-transparent text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                placeholder="Suche in Chunks und Fakten..."
                value={headerSearchQuery}
                onChange={(event) => onHeaderSearchChange(event.target.value)}
                onFocus={() => onShowHeaderSearchResults(hasSearchResults)}
                onBlur={() => setTimeout(() => onShowHeaderSearchResults(false), 180)}
              />
              <button
                type="button"
                onClick={handleCloseSearch}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {showHeaderSearchResults && hasSearchResults ? (
              <SearchResultsDropdown
                headerSearchResults={headerSearchResults}
                relatedChunks={relatedChunks}
                onHeaderSearchResultClick={onHeaderSearchResultClick}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

interface ChunkCardProps {
  title: string
  previewHtml: string
  isActive?: boolean
  hasInstructions?: boolean
  onClick?: () => void
  actionSlot?: React.ReactNode
}

export function ChunkCard({
  title,
  previewHtml,
  isActive,
  hasInstructions,
  onClick,
  actionSlot
}: ChunkCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "relative w-full rounded border-border bg-card p-3 text-left cursor-pointer hover:bg-muted hover:border-border/50 transition-all duration-200",
        isActive && "bg-muted border-border/30 shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-0 bottom-0 w-1 bg-white/40 rounded-l" />
      )}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={clsx("text-sm", isActive ? "text-foreground font-semibold" : "text-foreground")}>
            {title}
          </span>
          {hasInstructions ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/20 text-primary border-primary/30">
              KI
            </span>
          ) : null}
        </div>
        {actionSlot}
      </div>
      <div
        className="text-xs text-muted-foreground line-clamp-4 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
    </button>
  )
}

