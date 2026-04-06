"use client"

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getSupabaseClient } from '@/lib/supabase-browser'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Search, Loader2 } from 'lucide-react'
import { getSavedCompany } from '@/lib/domain-manager'

interface SearchResult {
  id: string
  pagecontent: string
  source_chunk?: string
  document_id?: string
  chunk_content?: string // Vollständiger Chunk-Inhalt
  metadata: {
    chunk_id: string
    fact_type: string
    document_id?: string
    knowledge_base_id: string
    knowledge_item_id?: string // Optional für die neue Struktur
  }
  similarity: number
  title?: string
  file_name?: string
  search_source?: string // "vector", "graph", or "both"
  facts?: any[]
}

interface ChatInterfaceProps {
  knowledgeBaseId: string
  height?: string
  onOpenChunkDetails: (item: any) => void
}

export default function ChatInterface({ knowledgeBaseId, height = "600px", onOpenChunkDetails }: ChatInterfaceProps) {
  const supabase = getSupabaseClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [showSearchField, setShowSearchField] = useState(false)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const searchInputRef = useRef<HTMLTextAreaElement>(null)

  // Hole die User-ID und Company-ID beim Mount
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserId(user.id)
      }
    }
    getUser()
    
    const company = getSavedCompany()
    if (company?.id) {
      setCompanyId(company.id)
    }
  }, [supabase.auth])

  // Keine Speicherung mehr im sessionStorage - Daten verschwinden beim Neuladen

  // Suche nach ähnlichen Chunks
  const searchChunks = useCallback(async () => {
    if (!searchQuery.trim() || !userId || isLoading) return

    setIsLoading(true)
    setSearchResults([])
    setIsInitialLoad(true) // Neue Suche startet, Animation aktivieren
    setShowSearchField(false)

    try {
      const response = await fetch('https://outlook-ai-frontend-v3-2s1l.onrender.com/api/knowledge/retrieve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'vI+AipWnKo3EqyBRHblIx2lcVF3WxXZDSAB9w8tFh5M=',
        },
        body: JSON.stringify({
          company_id: companyId,
          kb_id: knowledgeBaseId,
          subject: searchQuery,
          body: '',
          enable_hybrid: true,
          max_results: 10,
          detect_language: true,
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      let rawSearchResults: SearchResult[] = []

      if (data && typeof data === 'object' && 'kb_results' in data && Array.isArray(data.kb_results)) {
        // Support-Backend /api/knowledge/retrieve response
        const kbResults = data.kb_results as Array<{
          chunk_id: string
          chunk_content: string
          ki_content: string
          question: string
          similarity: number
          fact_type?: string
          source_name?: string
          search_source?: string
        }>

        rawSearchResults = kbResults.map(item => ({
          id: item.chunk_id,
          pagecontent: item.ki_content || item.chunk_content,
          source_chunk: item.chunk_id,
          document_id: '',
          chunk_content: item.chunk_content,
          metadata: {
            chunk_id: item.chunk_id,
            fact_type: item.fact_type || 'Wissensdatenbank',
            document_id: '',
            knowledge_base_id: knowledgeBaseId,
            knowledge_item_id: item.chunk_id,
          },
          similarity: item.similarity,
          title: item.source_name || '',
          file_name: item.source_name || '',
          search_source: item.search_source || 'vector',
        }))
      } else if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && 'pagecontent' in data[0]) {
        // Alte Struktur (falls noch verwendet)
        rawSearchResults = data as SearchResult[]
      }

      if (rawSearchResults.length > 0) {
        // Die Webhook-Antwort enthält bereits alle nötigen Informationen
        // KORREKTUR: Setze Similarity auf 100% wenn Text identisch oder nahezu identisch ist
        const correctedResults = rawSearchResults.map(result => {
          // Normalisiere beide Texte für Vergleich (entferne Whitespace-Unterschiede)
          const normalizedQuery = searchQuery.trim().toLowerCase().replace(/\s+/g, ' ')
          const normalizedContent = result.pagecontent.trim().toLowerCase().replace(/\s+/g, ' ')
          
          // Exakter Match
          if (normalizedQuery === normalizedContent) {
            return { ...result, similarity: 1.0 }
          }
          
          // Nahezu identisch (z.B. eine Seite ist Teil der anderen)
          if (normalizedQuery.includes(normalizedContent) || normalizedContent.includes(normalizedQuery)) {
            const lengthRatio = Math.min(normalizedQuery.length, normalizedContent.length) / 
                               Math.max(normalizedQuery.length, normalizedContent.length)
            // Wenn mindestens 95% Übereinstimmung in der Länge, setze auf 100%
            if (lengthRatio > 0.95) {
              return { ...result, similarity: 1.0 }
            }
          }
          
          return result
        })
        setSearchResults(correctedResults)
        // Deaktiviere Animation nach 1 Sekunde (nach den ersten 10 Elementen)
        setTimeout(() => {
          setIsInitialLoad(false)
        }, 1000)
      } else {
        setSearchResults([])
        setIsInitialLoad(true) // Falls keine Ergebnisse, zurücksetzen für nächsten Versuch
      }
    } catch (error) {
      console.error('Fehler bei der Suche:', error)
      setSearchResults([])
    } finally {
      setIsLoading(false)
    }
  }, [searchQuery, knowledgeBaseId, userId, companyId, isLoading])

  // Suche bei Enter (am Ende der Eingabe)
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      searchChunks()
    }
  }

  // Navigation zu Chunk/Fakten-Modul
  const navigateToChunk = useCallback(async (result: SearchResult) => {
    onOpenChunkDetails(result)
  }, [onOpenChunkDetails])

  // Suchfeld wieder öffnen
  const openSearchField = useCallback(() => {
    setShowSearchField(true)
  }, [])

  // Suche zurücksetzen und Suchfeld schließen
  const resetSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults([])
    setIsInitialLoad(true) // Bei nächster Suche Animation aktivieren
    setShowSearchField(false)
  }, [])

  // Fokus automatisch setzen und Höhe anpassen wenn Feld geöffnet wird
  useEffect(() => {
    if (showSearchField && searchInputRef.current) {
      searchInputRef.current.focus()
      // Höhe sofort anpassen, wenn bereits Text vorhanden ist
      // Kleine Verzögerung, damit das DOM vollständig gerendert ist
      setTimeout(() => {
        if (searchInputRef.current && searchQuery) {
          searchInputRef.current.style.height = 'auto'
          searchInputRef.current.style.height = searchInputRef.current.scrollHeight + 'px'
        }
      }, 0)
    }
  }, [showSearchField, searchQuery])

  // Helper function to generate color based on chunk ID (pink/grey/white/black palette)
  const getChunkColor = (id: string) => {
    if (!id) return '#9f1239'; // Default rose-800
    
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Use hash to select from defined color buckets to ensure high contrast/distinction
    // but sticking to the requested palette: Pink, Grey, White, Black (accented)
    const buckets = [
      '#9f1239', // Dark pink/rose
      '#831843', // Darker pink
      '#be185d', // Medium dark pink
      '#4a0e2a', // Very dark pink
      '#111111', // Near black
      '#1a1a1a', // Dark gray
      '#2a2a2a', // Medium dark gray
      '#333333', // Gray
      '#0d0d0d', // Almost black
      '#3b0f26', // Dark pink-black
    ];

    const index = Math.abs(hash) % buckets.length;
    return buckets[index];
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header - nur wenn keine Suche aktiv */}
      {!searchQuery.trim() && (
        <div className="p-4">
        </div>
      )}

      {/* Suchfeld oder kompakter Preview */}
      {showSearchField ? (
          <div className="mb-2 px-2 sm:px-4 w-full overflow-hidden">
            <div className="relative overflow-hidden">
              {/* Moderne Eingabezeile mit Gradient-Hintergrund */}
              <div className="relative rounded-xl bg-gradient-to-r from-[#2a2a2a] via-[#252525] to-[#2a2a2a] p-[1px] shadow-lg overflow-hidden">
                <div className="relative rounded-xl bg-gradient-to-b from-[#1e1e1e] to-[#2a2a2a] p-3 overflow-hidden">
                  {/* Textarea Container */}
                  <div className="relative overflow-hidden">
                    <textarea
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value)
                        // Auto-resize
                        e.target.style.height = 'auto'
                        e.target.style.height = e.target.scrollHeight + 'px'
                      }}
                      onKeyDown={handleKeyPress}
                      onBlur={() => {
                        setShowSearchField(false)
                      }}
                      disabled={isLoading || !userId}
                      placeholder="Beschreiben Sie Ihre Kundenanfrage oder fügen Sie eine E-Mail ein..."
                      className="w-full bg-transparent text-sm text-white placeholder:text-gray-500 focus:outline-none resize-none min-h-[60px] max-h-[200px] leading-relaxed break-words overflow-x-hidden"
                      style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                      autoComplete="off"
                      rows={2}
                    />
                  </div>

                  {/* Footer mit Hinweisen */}
                  <div className="mt-3 flex items-center justify-end text-xs text-gray-500">
                    {searchQuery.length > 0 && (
                      <span className="text-pink-400">{searchQuery.length} Zeichen</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-2 px-2 sm:px-4 w-full overflow-hidden">
            <div
              className="relative rounded-xl bg-gradient-to-r from-[#2a2a2a] via-[#252525] to-[#2a2a2a] p-[1px] shadow-lg cursor-pointer transition-all duration-300 hover:shadow-xl group overflow-hidden"
              onClick={openSearchField}
              title="Klicken zum Bearbeiten"
            >
              <div className="relative rounded-xl bg-gradient-to-b from-[#1e1e1e] to-[#2a2a2a] p-2.5 group-hover:from-[#1a1a1a] group-hover:to-[#252525] transition-all duration-300 overflow-hidden">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start flex-1 min-w-0 overflow-hidden">
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="text-xs text-gray-400 mb-1">Aktuelle Anfrage</div>
                      <div className="text-xs sm:text-sm text-white font-medium max-w-full break-words line-clamp-2" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                        {searchQuery || <span className="text-gray-500">...</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-gray-500 group-hover:text-pink-400 transition-colors duration-300 flex-shrink-0 pt-5">
                    {searchQuery.trim() ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          resetSearch();
                        }}
                        title="Suche zurücksetzen"
                        className="p-1 -m-1 rounded-full hover:bg-white/10"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}


      <Separator />

      {/* Ergebnisse */}
      <div className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 w-full">
        <div className="space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <div className="text-center w-[60%] mx-auto">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-400">Suche läuft...</p>
              </div>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="flex items-center justify-center min-h-[200px] pt-12">
              <div className="text-center w-[45%] mx-auto opacity-70">
                <Search className="size-5 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-2 font-medium">
                  {searchQuery.trim() ? 'Keine passenden Einträge gefunden' : 'Wissenssuche - Test-Tool'}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {searchQuery.trim()
                    ? 'Versuchen Sie eine andere Formulierung oder kürzen Sie Ihre Anfrage'
                    : 'Geben Sie eine Kundenmail oder Anfrage ein, um zu testen, welche Wissenseinträge die KI bei dieser Anfrage erhalten würde. So können Sie überprüfen, ob Ihre Wissensdatenbank korrekt auf Kundenanfragen antworten würde.'
                  }
                </p>
              </div>
            </div>
          ) : (
            <>
              {searchResults.map((result, index) => {
                const isQuestion = result.pagecontent.includes('?')
                const previewText = result.pagecontent.length > 150
                  ? result.pagecontent.substring(0, 150) + '...'
                  : result.pagecontent

                return (
                  <div
                    key={result.id}
                    className={`mb-2.5 rounded-lg border border-[#333333] bg-[#242424] p-3 transition-all duration-300 ease-in-out hover:border-[#444444] hover:bg-[#2a2a2a] cursor-pointer ${index < 10 ? 'animate-fade-in-up' : ''}`}
                    style={index < 10 ? {
                      animationDelay: `${index * 50}ms`,
                      animationFillMode: 'both'
                    } : {}}
                    onClick={() => navigateToChunk(result)}
                  >
                    <div className="flex gap-2">
                      <div className="flex-1 flex flex-col gap-2">
                        {isQuestion && (
                          <p className="text-[12px] text-gray-400 mt-2 line-clamp-2">
                            Frage
                          </p>
                        )}

                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-white line-clamp-3 flex-1">
                            {previewText}
                          </p>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {result.search_source && result.search_source !== 'vector' && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                                result.search_source === 'both'
                                  ? 'text-primary/70 border-primary/20 bg-primary/5'
                                  : 'text-white/40 border-white/10 bg-white/[0.03]'
                              }`} title={
                                result.search_source === 'graph' ? 'Gefunden über Knowledge Graph'
                                : result.search_source === 'both' ? 'Gefunden über Vektor + Knowledge Graph'
                                : ''
                              }>
                                {result.search_source === 'graph' ? 'Graph' : 'Vektor + Graph'}
                              </span>
                            )}
                            <div className="flex items-center gap-2 text-[10px] text-gray-400 font-medium bg-[#1e1e1e] px-2 py-1 rounded-full border border-[#333]">
                              <div
                                className="w-4 h-4 rounded-full border border-white/10 shadow-sm flex items-center justify-center text-[9px] font-bold text-white"
                                style={{ backgroundColor: getChunkColor(result.metadata?.chunk_id || `idx-${index}`) }}
                                title={result.metadata?.chunk_id ? `Chunk-Gruppe: ${result.metadata.chunk_id.substring(0, 8)}...` : `Ergebnis ${index + 1}`}
                              >
                                {String.fromCharCode(65 + index)}
                              </div>
                              {Math.round(result.similarity * 100)}%
                            </div>
                          </div>
                        </div>

                        {/* Chunk-Preview in kleiner Schrift */}
                        {result.chunk_content && (
                          <div className="mt-3 pt-3 border-t border-[#333333]">
                            <p className="text-[9px] text-gray-500 mb-1"> Vorschau Chunk:</p>
                            <div className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed [&_strong]:font-bold [&_em]:italic">
                              {(() => {
                                const processedContent = result.chunk_content
                                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                  .replace(/\*(.*?)\*/g, '<em>$1</em>');
                                console.log('Original:', result.chunk_content);
                                console.log('Processed:', processedContent);
                                return (
                                  <div dangerouslySetInnerHTML={{ __html: processedContent }} />
                                );
                              })()}
                            </div>
                          </div>
                        )}

                        {/* Fußzeile kompakt und klein */}
                        <div className="flex items-center justify-between text-[10px] text-gray-500 mt-2">
                          <span>{result.file_name || 'Unknown'}</span>
                          <span>{new Date().toLocaleDateString('de-DE')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
