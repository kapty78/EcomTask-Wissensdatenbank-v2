"use client"

import React, { useState, useEffect, useRef, useCallback, memo } from "react"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { User } from "@supabase/supabase-js"
import { logger } from "@/lib/utils/logger"
import { KnowledgeBaseList } from "@/components/knowledge/KnowledgeBaseList"
import { KnowledgeItemUpload } from "@/components/knowledge/KnowledgeItemUpload"
import { MismatchFinder } from "@/components/knowledge/MismatchFinder"
import { ChunkCombiner } from "@/components/knowledge/ChunkCombiner"
import dynamic from 'next/dynamic'
import { ChunkModalHeader, ChunkCard } from "@/components/knowledge/ChunkModalElements"

// Dynamischer Import für Chat-Komponente
const ChatInterface = dynamic(
  () => import('@/components/knowledge/ChatInterface'),
  { ssr: false }
)
import { CreateKnowledgeBaseModal } from "@/components/knowledge/CreateKnowledgeBaseModal"
import { getSavedCompany } from "@/lib/domain-manager"
import { WithTooltip } from "@/components/ui/with-tooltip"
import {
  Database as DatabaseIcon,
  BookText,
  BrainCircuit,
  PlusCircle,
  BarChart2,
  Sparkles,
  Users,
  Upload,
  List,
  Search,
  Calendar,
  Filter,
  X,
  ChevronDown,
  GitCompare,
  GitMerge,
  Boxes,
  Loader2,
  Settings,
  FileText,
  Info,
  Trash2,
  Network,
  MessageCircle,
  Download,
  Undo2,
  Printer,
  ClipboardList,
  RotateCcw
} from "lucide-react"
import { format, subDays, subWeeks, subMonths, isAfter } from "date-fns"
import { toast } from "sonner"
import { playSuccess, playError, playWarning } from "@/lib/sounds"
import { highlightToastMessage } from "@/lib/toast-message"
import { de } from "date-fns/locale"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// UI-Button: Bestätigungsdialog für Chunk-Löschung im App-Stil
const DeleteChunkButton: React.FC<{ onConfirm: () => void; onClick?: (e: React.MouseEvent) => void }> = ({ onConfirm, onClick }: { onConfirm: () => void; onClick?: (e: React.MouseEvent) => void }) => {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          onClick={onClick}
          className="p-1 rounded hover:bg-white/10 text-foreground/40 hover:text-foreground transition-colors"
          title="Chunk löschen"
        >
          <Trash2 className="size-3" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-border bg-card text-foreground">
        <AlertDialogHeader>
          <AlertDialogTitle>Chunk wirklich löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Dieser Vorgang entfernt den ausgewählten Chunk und alle zugehörigen Fakten. Diese Aktion kann nicht rückgängig gemacht werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-primary hover:bg-pink-600">Löschen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// Separater memoizierter Filter außerhalb der Hauptkomponente
interface KnowledgeItemsFilterProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sourceFilter: string | null;
  onSourceFilterChange: (source: string | null) => void;
  dateFilter: string | null;
  onDateFilterChange: (dateFilter: string | null) => void;
  onClearAllFilters: () => void;
  availableSources: string[];
  filteredItemsCount: number;
  hasMoreItems: boolean;
  totalItemsCount: number;
  // ✅ NEU: Massenauswahl-Props
  isSelectMode: boolean;
  onToggleSelectMode: () => void;
  selectedCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkDelete: () => void;
}

const KnowledgeItemsFilter = memo(({
  searchQuery,
  onSearchChange,
  sourceFilter,
  onSourceFilterChange,
  dateFilter,
  onDateFilterChange,
  onClearAllFilters,
  availableSources,
  filteredItemsCount,
  hasMoreItems,
  totalItemsCount,
  // ✅ NEU: Massenauswahl-Props
  isSelectMode,
  onToggleSelectMode,
  selectedCount,
  onSelectAll,
  onDeselectAll,
  onBulkDelete
}: KnowledgeItemsFilterProps) => {
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // WICHTIG: Lokaler Handler der das Neuer-Rendering verhindert
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  };

  const clearSearch = () => {
    onClearAllFilters();
    // Fokus sofort zurücksetzen
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 0);
  };

  return (
    <div className="mb-3 space-y-2">
      {/* Suchfeld */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          placeholder="Einträge durchsuchen..."
          className="w-full rounded-lg border border-border bg-muted py-2.5 sm:py-2 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-white/20 focus:outline-none"
          autoComplete="off"
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            type="button"
          >
            <X size={16} />
          </button>
        )}
      </div>
      
      {/* Filter-Zeile mit Dropdown-Buttons - Responsive */}
      <div className="flex flex-wrap gap-2">
        {/* ✅ NEU: Auswählen-Button */}
        <button
          onClick={onToggleSelectMode}
          className={`flex items-center gap-1.5 rounded-lg border px-2 sm:px-3 py-1.5 text-xs sm:text-sm transition-colors ${
            isSelectMode 
              ? 'border-white/20 bg-white/10 text-foreground' 
              : 'border-border bg-card text-muted-foreground hover:bg-muted'
          }`}
        >
          <input
            type="checkbox"
            readOnly
            checked={isSelectMode}
            className="h-3 w-3 rounded border-border bg-card accent-primary focus:ring-primary focus:ring-offset-0"
            style={{ accentColor: '#ff55c9' }}
          />
          <span className="hidden sm:inline">{isSelectMode ? 'Auswahl beenden' : 'Auswählen'}</span>
          <span className="sm:hidden">{isSelectMode ? 'Ende' : 'Ausw.'}</span>
        </button>
        
        {/* ✅ NEU: Bulk-Aktionen wenn im Auswahlmodus */}
        {isSelectMode && (
          <>
            <button
              onClick={selectedCount === filteredItemsCount ? onDeselectAll : onSelectAll}
              className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              {selectedCount === filteredItemsCount ? 'Alle abwählen' : 'Alle auswählen'}
            </button>
            {selectedCount > 0 && (
              <button
                onClick={onBulkDelete}
                className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-foreground/40 hover:bg-muted transition-colors"
              >
                <Trash2 className="size-3" />
                <span className="hidden sm:inline">{selectedCount} löschen</span>
                <span className="sm:hidden">{selectedCount}</span>
              </button>
            )}
          </>
        )}
        
        {/* Quellen-Filter */}
        <div className="relative">
          <button
            onClick={() => {
              setShowSourceDropdown(!showSourceDropdown);
              setShowDateDropdown(false);
            }}
            className={`flex items-center gap-1 rounded-lg border px-2 sm:px-3 py-1.5 text-xs sm:text-sm transition-colors ${
              sourceFilter 
                ? 'border-primary bg-primary/10 text-foreground' 
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
            type="button"
          >
            <Filter size={12} className="sm:size-[14px]" />
            <span className="hidden sm:inline">{sourceFilter || "Quelle"}</span>
            <span className="sm:hidden">{sourceFilter ? (sourceFilter.length > 8 ? sourceFilter.substring(0, 8) + '...' : sourceFilter) : "Quelle"}</span>
            <ChevronDown size={12} className={`ml-1 sm:size-[14px] transition-transform ${showSourceDropdown ? 'rotate-180' : ''}`} />
          </button>
          
          {showSourceDropdown && (
            <div className="absolute left-0 top-full z-10 mt-1 min-w-72 max-w-[28rem] max-h-96 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg">
              <div 
                className="cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-secondary truncate"
                onClick={() => {
                  onSourceFilterChange(null);
                  setShowSourceDropdown(false);
                }}
              >
                Alle Quellen
              </div>
              <div className="mx-3 my-1 border-t border-border"></div>
              {availableSources.map(source => (
                <div
                  key={source}
                  className="cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-secondary truncate"
                  onClick={() => {
                    onSourceFilterChange(source);
                    setShowSourceDropdown(false);
                  }}
                >
                  <span title={source}>{source}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Datum-Filter */}
        <div className="relative">
          <button
            onClick={() => {
              setShowDateDropdown(!showDateDropdown);
              setShowSourceDropdown(false);
            }}
            className={`flex items-center gap-1 rounded-lg border px-2 sm:px-3 py-1.5 text-xs sm:text-sm transition-colors ${
              dateFilter 
                ? 'border-primary bg-primary/10 text-foreground' 
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
            type="button"
          >
            <Calendar size={12} className="sm:size-[14px]" />
            <span className="hidden sm:inline">
              {dateFilter === 'today'
                ? 'Heute'
                : dateFilter === 'week'
                ? 'Diese Woche'
                : dateFilter === 'month'
                ? 'Dieser Monat'
                : dateFilter === 'three_months'
                ? 'Letzte 3 Monate'
                : "Zeitraum"}
            </span>
            <span className="sm:hidden">
              {dateFilter === 'today'
                ? 'Heute'
                : dateFilter === 'week'
                ? 'Woche'
                : dateFilter === 'month'
                ? 'Monat'
                : dateFilter === 'three_months'
                ? '3 Mon'
                : "Zeit"}
            </span>
            <ChevronDown size={12} className={`ml-1 sm:size-[14px] transition-transform ${showDateDropdown ? 'rotate-180' : ''}`} />
          </button>
          
          {showDateDropdown && (
            <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-lg border border-border bg-card py-1 shadow-lg">
              <div 
                className="cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-secondary"
                onClick={() => {
                  onDateFilterChange(null);
                  setShowDateDropdown(false);
                }}
              >
                Alle Zeiten
              </div>
              <div className="mx-3 my-1 border-t border-border"></div>
              <div 
                className="cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-secondary"
                onClick={() => {
                  onDateFilterChange('today');
                  setShowDateDropdown(false);
                }}
              >
                Heute
              </div>
              <div 
                className="cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-secondary"
                onClick={() => {
                  onDateFilterChange('week');
                  setShowDateDropdown(false);
                }}
              >
                Diese Woche
              </div>
              <div 
                className="cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-secondary"
                onClick={() => {
                  onDateFilterChange('month');
                  setShowDateDropdown(false);
                }}
              >
                Dieser Monat
              </div>
              <div 
                className="cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-secondary"
                onClick={() => {
                  onDateFilterChange('three_months');
                  setShowDateDropdown(false);
                }}
              >
                Letzte 3 Monate
              </div>
            </div>
          )}
        </div>
        
        {/* Filter zurücksetzen, nur anzeigen wenn Filter aktiv */}
        {(sourceFilter || dateFilter || searchQuery) && (
          <button
            onClick={clearSearch}
            className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-muted-foreground hover:bg-muted"
            type="button"
          >
            <X size={12} className="sm:size-[14px]" />
            <span className="hidden sm:inline">Filter zurücksetzen</span>
            <span className="sm:hidden">Reset</span>
          </button>
        )}
      </div>
      
      {/* Ergebnis-Zähler */}
      <div className="text-xs text-muted-foreground">
        {totalItemsCount > 0 
          ? `${filteredItemsCount} von ${totalItemsCount} ${totalItemsCount === 1 ? 'Eintrag' : 'Einträgen'}`
          : hasMoreItems
            ? `${filteredItemsCount}+ ${filteredItemsCount === 1 ? 'Eintrag' : 'Einträge'}`
            : `${filteredItemsCount} ${filteredItemsCount === 1 ? 'Eintrag' : 'Einträge'}`
        }
      </div>
    </div>
  );
});

KnowledgeItemsFilter.displayName = 'KnowledgeItemsFilter';

// ✅ NEU: Erweiterte ChunkDetailsModal mit Chunk-Navigation
interface ChunkDetailsModalProps {
  showChunkModal: boolean;
  selectedItem: any;
  chunkDetails: any;
  chunkFacts: any[];
  loadingChunkDetails: boolean;
  isEditingChunk: boolean;
  editedChunkContent: string;
  editingFactIds: Set<string>;
  editedFacts: {[key: string]: string};
  newFacts: string[];
  setEditedChunkContent: (content: string) => void;
  globalFacts: any[];
  setGlobalFacts: (facts: any[]) => void;
  savingChanges: boolean;
  // ✅ NEU: Chunk-Navigations-Props
  relatedChunks: any[];
  currentChunkIndex: number;
  loadingRelatedChunks: boolean;
     // ✅ NEU: Markdown-Formatierungs-Props
   isMarkdownFormatting: boolean;
   // ✅ NEU: Fakten-Regenerierungs-Props
   isRegeneratingFacts: boolean;
   onClose: () => void;
  onEditChunk: (editing: boolean) => void;
  onChunkContentChange: (content: string) => void;
  onToggleFactEdit: (factId: string, content: string) => void;
  onFactContentChange: (factId: string, content: string) => void;
  onAddNewFact: () => void;
  onRemoveNewFact: (index: number) => void;
  onNewFactChange: (index: number, content: string) => void;
  onSaveChanges: () => void;
  // ✅ NEU: Chunk-Navigations-Handler
  onNavigateToChunk: (chunkIndex: number) => void;
  // ✅ NEU: Fakten-Löschungs-Handler
  onDeleteFact: (factId: string) => void;
  // ✅ NEU: Chunk-Löschungs-Handler
  onDeleteChunk: (chunkId: string) => void;
     // ✅ NEU: Markdown-Formatierungs-Handler
   onMarkdownFormat: () => void;
   // ✅ NEU: Fakten-Regenerierungs-Handler
   onRegenerateFacts: () => void;
   // ✅ NEU: Hilfe-Modal-Handler
  onShowHelp: () => void;
  // ✅ NEU: Header-Such-Props
  headerSearchQuery: string;
  headerSearchResults: {chunks: any[], facts: any[]};
  showHeaderSearchResults: boolean;
  onHeaderSearchChange: (query: string) => void;
  onShowHeaderSearchResults: (show: boolean) => void;
  onHeaderSearchResultClick: (type: 'chunk' | 'fact', item: any) => void;
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void;
  // ✅ NEU: Chunk-Erstellungs-Props
  onShowCreateChunkModal: () => void;
}

const ChunkDetailsModal = memo(({
  showChunkModal,
  selectedItem,
  chunkDetails,
  chunkFacts,
  loadingChunkDetails,
  isEditingChunk,
  editedChunkContent,
  editingFactIds,
  editedFacts,
  newFacts,
  setEditedChunkContent,
  globalFacts,
  setGlobalFacts,
  savingChanges,
  relatedChunks,
  currentChunkIndex,
     loadingRelatedChunks,
   isMarkdownFormatting,
   isRegeneratingFacts,
   onClose,
  onEditChunk,
  onChunkContentChange,
  onToggleFactEdit,
  onFactContentChange,
  onAddNewFact,
  onRemoveNewFact,
  onNewFactChange,
  onSaveChanges,
  onNavigateToChunk,
  onDeleteFact,
     onDeleteChunk,
   onMarkdownFormat,
   onRegenerateFacts,
   onShowHelp,
  headerSearchQuery,
  headerSearchResults,
  showHeaderSearchResults,
  onHeaderSearchChange,
  onShowHeaderSearchResults,
  onHeaderSearchResultClick,
  addToast,
  onShowCreateChunkModal
}: ChunkDetailsModalProps) => {
  const newFactTextareaRef = useRef<HTMLTextAreaElement>(null);
  const factsContainerRef = useRef<HTMLDivElement>(null);
  const [previousNewFactsLength, setPreviousNewFactsLength] = useState(newFacts.length);
  const [showFactSearch, setShowFactSearch] = useState(false);
  const [factSearchQuery, setFactSearchQuery] = useState("");
  const [loadingGlobalFacts, setLoadingGlobalFacts] = useState(false);

  // ✅ NEU: Supabase Client für die Modal-Komponente
  const supabase = createClientComponentClient();

  // ✅ NEU: Responsiver Tab-Navigations-Zustand
  const [activeModalTab, setActiveModalTab] = useState<'chunks' | 'content' | 'facts'>('content');
  
  // ✅ NEU: Anweisungs-States
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState(chunkDetails?.instructions || '');
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  
  // Synchronisiere instructions mit chunkDetails (ohne showInstructions automatisch zu aktivieren)
  useEffect(() => {
    if (chunkDetails?.instructions) {
      setInstructions(chunkDetails.instructions);
    } else {
      setInstructions('');
    }
  }, [chunkDetails?.id]);

  // Setze Anweisungs-States zurück wenn Modal geöffnet oder geschlossen wird
  useEffect(() => {
    setShowInstructions(false);
    setIsEditingInstructions(false);
  }, [showChunkModal]);
  
  // Zustände für veränderbare Seitenleisten
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(320); // 80 * 4 = 320px (w-80)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(384); // 96 * 4 = 384px (w-96)
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  
  // Min/Max Werte für Seitenleisten-Breiten
  const MIN_LEFT_SIDEBAR_WIDTH = 250;
  const MIN_RIGHT_SIDEBAR_WIDTH = 270; // Höher für Fakten-Seitenleiste
  const MAX_SIDEBAR_WIDTH = 500;

  // Automatischer Fokus und Scroll zum neuesten Fakt
  useEffect(() => {
    if (newFacts.length > previousNewFactsLength && newFactTextareaRef.current && factsContainerRef.current) {
      // Scroll nach oben zum neuen Fakt
      factsContainerRef.current.scrollTop = 0;

      // Focus auf das neue Textarea
      setTimeout(() => {
        newFactTextareaRef.current?.focus();
      }, 100);
    }
    setPreviousNewFactsLength(newFacts.length);
  }, [newFacts.length, previousNewFactsLength]);


  // Gefilterte Fakten basierend auf Suche
  const filteredChunkFacts = factSearchQuery.trim() === ""
    ? chunkFacts
    : (globalFacts.length > 0 ? globalFacts : chunkFacts).filter(fact => {
        const query = factSearchQuery.toLowerCase();
        return (fact.content && fact.content.toLowerCase().includes(query)) ||
               (fact.question && fact.question.toLowerCase().includes(query));
      });

  const modalTitle = selectedItem?.originalFileName || 'Dokument-Chunks';

  const handleResetHeaderSearch = useCallback(() => {
    onHeaderSearchChange('');
    onShowHeaderSearchResults(false);
  }, [onHeaderSearchChange, onShowHeaderSearchResults]);

  const buildChunkPreview = useCallback((rawContent: string) => {
    if (!rawContent) return "";
    const trimmed = rawContent.trim();
    const snippet = trimmed.length > 260 ? trimmed.slice(0, 260) : trimmed;
    const sanitized = snippet
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n-\s/g, '\n• ');

    return `${sanitized}${trimmed.length > snippet.length ? '…' : ''}`;
  }, []);



  // Mouse handlers for resizing
  const handleMouseDownLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
  }, []);

  const handleMouseDownRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRight(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingLeft) {
      const modalElement = document.querySelector('[data-modal="chunk-details"]') as HTMLElement;
      if (modalElement) {
        const modalRect = modalElement.getBoundingClientRect();
        const newWidth = Math.max(MIN_LEFT_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, e.clientX - modalRect.left));
        setLeftSidebarWidth(newWidth);
      }
    }
    if (isDraggingRight) {
      const modalElement = document.querySelector('[data-modal="chunk-details"]') as HTMLElement;
      if (modalElement) {
        const modalRect = modalElement.getBoundingClientRect();
        const newWidth = Math.max(MIN_RIGHT_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, modalRect.right - e.clientX));
        setRightSidebarWidth(newWidth);
      }
    }
  }, [isDraggingLeft, isDraggingRight, MIN_LEFT_SIDEBAR_WIDTH, MIN_RIGHT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingLeft(false);
    setIsDraggingRight(false);
  }, []);

  // Event listeners for mouse move and up
  useEffect(() => {
    if (isDraggingLeft || isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
      };
    }
  }, [isDraggingLeft, isDraggingRight, handleMouseMove, handleMouseUp]);

  if (!showChunkModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 sm:p-4">
      <div
        className="mx-2 sm:mx-4 h-[calc(100vh-16px)] sm:h-[calc(95vh-64px)] max-h-[calc(100vh-16px)] sm:max-h-[calc(100vh-80px)] w-full sm:w-[90vw] rounded-xl border border-white/10 bg-background shadow-xl flex flex-col overflow-hidden"
        data-modal="chunk-details"
      >
        <ChunkModalHeader
          title={modalTitle}
          subtitle="Chunk-Navigation & Fakten-Extraktion"
          onClose={onClose}
          headerSearchQuery={headerSearchQuery}
          onHeaderSearchChange={onHeaderSearchChange}
          onResetHeaderSearch={handleResetHeaderSearch}
          showHeaderSearchResults={showHeaderSearchResults}
          onShowHeaderSearchResults={onShowHeaderSearchResults}
          headerSearchResults={headerSearchResults}
          relatedChunks={relatedChunks}
          currentChunkIndex={currentChunkIndex}
          onNavigateToChunk={onNavigateToChunk}
          onHeaderSearchResultClick={onHeaderSearchResultClick}
        />

        <div className="lg:hidden px-3 sm:px-5 pb-2 sm:pb-4 pt-2 sm:pt-5">
          <div className="inline-flex w-full rounded-full border border-white/10 bg-white/5 p-0.5 sm:p-1 shadow-[0_18px_45px_-25px_rgba(236,72,153,0.45)] gap-0.5 sm:gap-1">
            {relatedChunks.length > 1 && (
                <button
                type="button"
                onClick={() => setActiveModalTab('chunks')}
                className={`flex-1 rounded-full px-2 sm:px-3 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition min-w-0 ${
                  activeModalTab === 'chunks'
                    ? 'bg-gradient-to-r from-primary to-primary/80 text-foreground shadow-[0_12px_32px_-18px_rgba(236,72,153,0.6)]'
                    : 'text-foreground/70 hover:text-foreground'
                }`}
              >
                <div className="text-center truncate">
                  <div className="truncate">Chunks</div>
                  <div className="text-[9px] sm:text-[11px] uppercase tracking-[0.1em] sm:tracking-[0.18em] text-foreground/70 truncate">
                    ({relatedChunks.length})
                  </div>
                </div>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveModalTab('content')}
              className={`flex-1 rounded-full px-2 sm:px-3 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition min-w-0 ${
                activeModalTab === 'content'
                  ? 'bg-gradient-to-r from-primary to-primary/80 text-foreground shadow-[0_12px_32px_-18px_rgba(236,72,153,0.6)]'
                  : 'text-foreground/70 hover:text-foreground'
              }`}
            >
              <div className="text-center truncate">
                <div className="truncate">Inhalt</div>
                <div className="text-[9px] sm:text-[11px] uppercase tracking-[0.1em] sm:tracking-[0.18em] text-foreground/70 truncate">
                  {relatedChunks.length > 1 ? `Chunk ${currentChunkIndex + 1}` : 'CHUNK'}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveModalTab('facts')}
              className={`flex-1 rounded-full px-2 sm:px-3 py-1 sm:py-2 text-[10px] sm:text-xs font-medium transition min-w-0 ${
                activeModalTab === 'facts'
                  ? 'bg-gradient-to-r from-primary to-primary/80 text-foreground shadow-[0_12px_32px_-18px_rgba(236,72,153,0.6)]'
                  : 'text-foreground/70 hover:text-foreground'
              }`}
            >
              <div className="text-center truncate">
                <div className="truncate">Fakten</div>
                <div className="text-[9px] sm:text-[11px] uppercase tracking-[0.1em] sm:tracking-[0.18em] text-foreground/70 truncate">
                  ({chunkFacts.length + newFacts.length})
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Main Content - Responsive Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Desktop: 3-Spalten Layout (lg+) */}
          
          {/* Linke Spalte: Chunk-Navigation - nur Desktop */}
          {relatedChunks.length > 1 && (
            <>
              <div
                className="hidden lg:flex flex-col overflow-hidden bg-card border border-white/10 rounded-lg"
                style={{ width: `${leftSidebarWidth}px` }}
              >
                <div className="p-4 border-b border-border">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-base font-medium text-foreground">Alle Chunks</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {relatedChunks.length} Chunks aus diesem Dokument
                      </p>
                    </div>
                    <button
                      onClick={onShowCreateChunkModal}
                      className="rounded px-3 py-1 text-lg text-primary hover:text-primary/80 transition-colors duration-200"
                      title="Chunk hinzufügen"
                    >
                      +
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto px-3 py-4">
                  {loadingRelatedChunks ? (
                    <div className="flex items-center justify-center p-8">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="size-6 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">Lade Chunks...</span>
                      </div>
                    </div>
                  ) : (
                    <div data-chunk-list className="space-y-3">
                      {relatedChunks.map((chunk, index) => (
                        <div key={chunk.id} data-chunk-item={index}>
                          <ChunkCard
                            title={`Chunk ${index + 1}`}
                            previewHtml={buildChunkPreview(chunk.content || '')}
                            isActive={currentChunkIndex === index}
                            hasInstructions={Boolean(chunk.instructions)}
                          onClick={() => onNavigateToChunk(index)}
                            actionSlot={
                            <DeleteChunkButton
                                onClick={(event: React.MouseEvent) => event.stopPropagation()}
                              onConfirm={() => onDeleteChunk(chunk.id)}
                            />
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Left Resize Handle - nur Desktop */}
              <div
                className="hidden lg:block w-0.5 bg-border hover:bg-border/50 cursor-col-resize flex-shrink-0 self-stretch"
                style={{ marginTop: '0.75rem', marginBottom: '0.75rem', borderRadius: '2px' }}
                onMouseDown={handleMouseDownLeft}
              />
            </>
          )}

          {/* Mobile/Tablet: Chunks Tab */}
          {activeModalTab === 'chunks' && relatedChunks.length > 1 && (
            <div className="lg:hidden flex-1 flex flex-col bg-card border border-white/10 rounded-lg m-2">
              <div className="p-4 border-b border-border">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-base font-medium text-foreground">Alle Chunks</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {relatedChunks.length} Chunks aus diesem Dokument
                    </p>
                  </div>
                  <button
                    onClick={onShowCreateChunkModal}
                    className="rounded px-3 py-1 text-lg text-primary hover:text-primary/80 transition-colors duration-200"
                    title="Chunk hinzufügen"
                  >
                    +
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto px-3 py-4">
                {loadingRelatedChunks ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="size-6 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">Lade Chunks...</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {relatedChunks.map((chunk, index) => (
                      <div key={chunk.id} data-chunk-item={index}>
                        <ChunkCard
                          title={`Chunk ${index + 1}`}
                          previewHtml={buildChunkPreview(chunk.content || '')}
                          isActive={currentChunkIndex === index}
                          hasInstructions={Boolean(chunk.instructions)}
                        onClick={() => {
                          onNavigateToChunk(index);
                            setActiveModalTab('content');
                          }}
                          actionSlot={
                          <DeleteChunkButton
                              onClick={(event: React.MouseEvent) => event.stopPropagation()}
                            onConfirm={() => onDeleteChunk(chunk.id)}
                          />
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Desktop: Mittlere Spalte & Mobile/Tablet: Content Tab */}
          <div className={`${activeModalTab === 'content' ? 'flex' : 'hidden'} lg:flex flex-1 flex-col relative border border-white/10 rounded-lg min-w-0`}>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-foreground">
                    Chunk-Inhalt
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Aus diesem Dokument-Abschnitt
                  </p>
                </div>
                <button
                  onClick={() => onEditChunk(!isEditingChunk)}
                  disabled={savingChanges}
                  className="rounded px-3 py-1 text-sm bg-muted text-foreground hover:bg-secondary/80 disabled:opacity-50"
                >
                  {isEditingChunk ? 'Abbrechen' : 'Bearbeiten'}
                </button>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto pb-24">
              {loadingChunkDetails ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <span className="text-muted-foreground">Lade Chunk-Details...</span>
                  </div>
                </div>
              ) : chunkDetails ? (
                isEditingChunk ? (
                  <textarea
                    value={editedChunkContent}
                    onChange={(e) => onChunkContentChange(e.target.value)}
                    className="w-full min-h-full resize-none rounded border border-border bg-transparent p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-white/20 focus:outline-none"
                    placeholder="Chunk-Inhalt bearbeiten..."
                    autoFocus
                  />
                ) : (
                  <div className="prose prose-invert max-w-none">
                    <div
                      data-chunk-content
                      className="whitespace-pre-wrap text-sm text-foreground leading-relaxed bg-transparent p-3 rounded border border-border/50"
                      dangerouslySetInnerHTML={{
                        __html: chunkDetails.content
                          .replace(/&/g, '&amp;')
                          .replace(/</g, '&lt;')
                          .replace(/>/g, '&gt;')
                          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\*(.*?)\*/g, '<em>$1</em>')
                          .replace(/\n-\s/g, '\n• ')
                      }}
                    />
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <FileText className="mx-auto mb-4 size-16 text-muted-foreground" />
                    <p className="text-muted-foreground">Kein Chunk-Inhalt verfügbar.</p>
                  </div>
                </div>
              )}
              
              {/* ✅ NEU: Anweisungsfeld unterhalb des Chunk-Inhalts */}
              {showInstructions && chunkDetails && (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-foreground">Anweisungen für KI-Modell</h4>
                    <button
                      onClick={() => setIsEditingInstructions(true)}
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Bearbeiten"
                    >
                      <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                  
                  {isEditingInstructions ? (
                    <div className="relative">
                      <textarea
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        className="w-full resize-none rounded border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none pr-24"
                        placeholder="Beispiel: Nutze das Tool 'CRM', falls du dem User eine Rechnung zuschicken musst."
                        rows={4}
                        autoFocus
                      />
                      <div className="absolute bottom-3 right-2 flex gap-1">
                        <button
                          onClick={() => {
                            setIsEditingInstructions(false);
                            setInstructions(chunkDetails?.instructions || '');
                          }}
                          className="px-2 py-1 text-xs rounded bg-transparent border border-border text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                        >
                          Abbrechen
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const { data, error } = await supabase
                                .from('document_chunks')
                                .update({ instructions: instructions.trim() || null })
                                .eq('id', chunkDetails.id)
                                .select()
                                .single();

                              if (error) {
                                console.error('Supabase error:', error);
                                throw error;
                              }

                              addToast('success', 'Anweisungen erfolgreich gespeichert');
                              setIsEditingInstructions(false);

                              // Update chunkDetails mit den Daten aus der DB
                              if (chunkDetails && data) {
                                chunkDetails.instructions = data.instructions;
                              }
                            } catch (error: any) {
                              console.error('Fehler beim Speichern der Anweisungen:', error);
                              addToast('error', error?.message || 'Fehler beim Speichern der Anweisungen');
                            }
                          }}
                          className="px-2 py-1 text-xs rounded bg-primary text-foreground hover:bg-pink-600 transition-colors"
                        >
                          Speichern
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded border border-border/50 bg-background/50 p-3">
                      {instructions.trim() ? (
                        <p className="text-sm text-foreground whitespace-pre-wrap">{instructions}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Keine Anweisungen vorhanden. Klicke auf das Stift-Symbol zum Hinzufügen.</p>
                      )}
                    </div>
                  )}
                  
                  <p className="mt-2 text-xs text-muted-foreground">
                    Diese Anweisungen werden an das KI-Modell weitergegeben, wenn dieser Chunk bei einer Anfrage relevant ist.
                  </p>
                </div>
              )}
            </div>
            
            {/* Chunk-Aktionen - Toolbar fixiert am unteren Rand */}
            <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-4 z-10 pointer-events-none">
              <TooltipProvider>
                <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 shadow-lg">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        onClick={() => {
                          const content = chunkDetails?.content || '';
                          const blob = new Blob([content], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `chunk-${currentChunkIndex + 1}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Download className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Exportieren</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        onClick={() => {
                          setEditedChunkContent(chunkDetails.content);
                          addToast('success', 'Änderungen wurden rückgängig gemacht');
                        }}
                      >
                        <Undo2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Rückgängig</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        onClick={() => {
                          const printContent = `
                            <h1>${selectedItem?.originalFileName || 'Dokument-Chunk'}</h1>
                            <h2>Chunk ${currentChunkIndex + 1} von ${relatedChunks.length}</h2>
                            <hr/>
                            <pre style="white-space: pre-wrap; font-family: Arial, sans-serif;">${chunkDetails?.content || ''}</pre>
                            <hr/>
                            <h3>Fakten:</h3>
                            <ul>
                              ${chunkFacts.map(fact => `<li>${fact.content}</li>`).join('')}
                            </ul>
                          `;
                          const printWindow = window.open('', '_blank');
                          printWindow?.document.write(`
                            <html>
                              <head><title>Chunk ${currentChunkIndex + 1}</title></head>
                              <body>${printContent}</body>
                            </html>
                          `);
                          printWindow?.document.close();
                          printWindow?.print();
                        }}
                      >
                        <Printer className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Drucken</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        onClick={onMarkdownFormat}
                        disabled={isMarkdownFormatting}
                      >
                        {isMarkdownFormatting ? (
                          <RotateCcw className="size-4 animate-spin" />
                        ) : (
                          <FileText className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Strukturieren</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={showInstructions ? "secondary" : "ghost"}
                        size="icon"
                        className="size-9"
                        onClick={() => {
                          setShowInstructions(!showInstructions);
                          if (!showInstructions) {
                            setIsEditingInstructions(true);
                          }
                        }}
                      >
                        <ClipboardList className={`size-4 ${showInstructions ? 'text-primary' : ''}`} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Anweisungen</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
          </div>

          {/* Right Resize Handle - nur Desktop */}
          <div
            className="hidden lg:block w-0.5 bg-border hover:bg-border/50 cursor-col-resize flex-shrink-0 self-stretch"
            style={{ marginTop: '0.75rem', marginBottom: '0.75rem', borderRadius: '2px' }}
            onMouseDown={handleMouseDownRight}
          />
          
          {/* Desktop: Rechte Spalte */}
          <div
            className="hidden lg:flex flex-col overflow-hidden bg-card border border-white/10 rounded-lg"
            style={{ width: `${rightSidebarWidth}px` }}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
                  <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-medium text-foreground">Fakten</h3>
                      <button
                        onClick={() => {
                          setShowFactSearch(!showFactSearch);
                          if (showFactSearch) {
                            setFactSearchQuery("");
                          }
                        }}
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                    title="Fakten durchsuchen"
                      >
                        <Search className="size-4" />
                      </button>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                      {factSearchQuery.trim() === "" 
                        ? `${chunkFacts.length + newFacts.length} aus diesem Chunk extrahiert`
                    : `${filteredChunkFacts.length} gefunden`}
                    </p>
                  </div>

              <div className="flex items-center gap-2">
                  <button
                    onClick={onRegenerateFacts}
                    disabled={isRegeneratingFacts}
                  className="p-2 rounded hover:bg-primary/20 text-primary hover:text-primary/70 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Fakten neu generieren"
                  >
                    {isRegeneratingFacts ? (
                    <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                      <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={onAddNewFact}
                  className="rounded px-3 py-1 text-lg text-primary hover:text-primary/80 transition-colors duration-200"
                  >
                    +
                  </button>
                </div>
              </div>
              
              {showFactSearch && (
              <div className="px-4 pb-3">
                  <input
                    type="text"
                    value={factSearchQuery}
                    onChange={(e) => setFactSearchQuery(e.target.value)}
                    placeholder="Fakten durchsuchen..."
                  className="w-full px-3 py-2 text-sm bg-card border border-border rounded text-foreground placeholder:text-muted-foreground focus:border-white/20 focus:outline-none"
                    autoFocus
                  />
                </div>
              )}
            
            <div className="flex-1 overflow-y-auto p-4" ref={factsContainerRef}>
              <div className="space-y-3">
                {newFacts.map((newFact, index) => (
                  <div
                    key={`new-${index}`}
                    className="rounded border border-border bg-card p-3"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm text-foreground">
                        Neuer Fakt
                      </span>
                      <button
                        onClick={() => onRemoveNewFact(index)}
                        className="text-foreground/40 hover:text-foreground transition-colors duration-200"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                    <textarea
                      ref={index === 0 ? newFactTextareaRef : undefined}
                      value={newFact}
                      onChange={(e) => onNewFactChange(index, e.target.value)}
                      className="w-full resize-none rounded border border-border bg-background p-2 text-sm text-foreground focus:border-white/20 focus:outline-none"
                      placeholder="Neuen Fakt eingeben..."
                      rows={3}
                    />
                  </div>
                ))}

                {filteredChunkFacts.map((fact) => (
                  <div
                    key={fact.id}
                    id={`fact-${fact.id}`}
                    className="rounded border border-border bg-card p-3"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {fact.tokens} Tokens
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onToggleFactEdit(fact.id, fact.content)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {editingFactIds.has(fact.id) ? 'Abbrechen' : 'Bearbeiten'}
                        </button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              className="text-foreground/40 hover:text-foreground transition-colors duration-200"
                              onClick={(e) => e.stopPropagation()}
                              title="Fakt löschen"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="border-border bg-card text-foreground">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Fakt wirklich löschen?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Dieser Vorgang entfernt den ausgewählten Fakt dauerhaft.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDeleteFact(fact.id)} className="bg-primary hover:bg-pink-600">
                                Löschen
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    {fact.question && (
                      <p className="text-xs text-muted-foreground mb-2">
                        {fact.question}
                      </p>
                    )}
                    {editingFactIds.has(fact.id) ? (
                      <textarea
                        value={editedFacts[fact.id] || fact.content}
                        onChange={(e) => onFactContentChange(fact.id, e.target.value)}
                        className="w-full resize-none rounded border border-border bg-background p-2 text-sm text-foreground focus:border-white/20 focus:outline-none"
                        rows={3}
                      />
                    ) : (
                      <p className="text-sm text-foreground leading-relaxed">{fact.content}</p>
                    )}
                  </div>
                ))}

                {chunkFacts.length === 0 && newFacts.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">Keine Fakten aus diesem Chunk extrahiert.</p>
                    <p className="text-sm text-muted-foreground mt-2">
                      Klicken Sie auf "+" um manuell einen Fakt hinzuzufügen.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile/Tablet: Facts Tab */}
          {activeModalTab === 'facts' && (
            <div className="lg:hidden flex-1 flex flex-col bg-card border border-white/10 rounded-lg m-2">
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between">
                    <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-medium text-foreground">Fakten</h3>
                        <button
                          onClick={() => {
                            setShowFactSearch(!showFactSearch);
                            if (showFactSearch) {
                              setFactSearchQuery("");
                            }
                          }}
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                        >
                          <Search className="size-4" />
                        </button>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {factSearchQuery.trim() === "" 
                          ? `${chunkFacts.length + newFacts.length} aus diesem Chunk extrahiert`
                        : `${filteredChunkFacts.length} gefunden`}
                      </p>
                    </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onRegenerateFacts}
                      disabled={isRegeneratingFacts}
                      className="p-2 rounded hover:bg-primary/20 text-primary hover:text-primary/70 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Fakten neu generieren"
                    >
                      {isRegeneratingFacts ? (
                        <Loader2 className="size-4 animate-spin text-primary" />
                      ) : (
                        <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={onAddNewFact}
                      className="rounded px-3 py-1 text-lg text-primary hover:text-primary/80 transition-colors duration-200"
                    >
                      +
                    </button>
                  </div>
                </div>
                
                {showFactSearch && (
                  <div className="mt-3">
                    <input
                      type="text"
                      value={factSearchQuery}
                      onChange={(e) => setFactSearchQuery(e.target.value)}
                      placeholder="Fakten durchsuchen..."
                      className="w-full px-3 py-2 text-sm bg-background border border-white/20 rounded text-foreground placeholder:text-muted-foreground focus:border-white/40 focus:outline-none"
                      autoFocus
                    />
                  </div>
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {newFacts.map((newFact, index) => (
                    <div
                      key={`new-mobile-${index}`}
                      className="rounded border border-border bg-card p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm text-foreground">
                          Neuer Fakt
                        </span>
                        <button
                          onClick={() => onRemoveNewFact(index)}
                          className="text-foreground/40 hover:text-foreground transition-colors duration-200"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <textarea
                        ref={index === 0 ? newFactTextareaRef : undefined}
                        value={newFact}
                        onChange={(e) => onNewFactChange(index, e.target.value)}
                        className="w-full resize-none rounded border border-border bg-background p-3 text-sm text-foreground focus:border-white/20 focus:outline-none"
                        placeholder="Neuen Fakt eingeben..."
                        rows={3}
                      />
                    </div>
                  ))}

                  {filteredChunkFacts.map((fact) => (
                    <div
                      key={`mobile-${fact.id}`}
                      id={`fact-mobile-${fact.id}`}
                      className="rounded border border-border bg-card p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">
                            {fact.tokens} Tokens
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onToggleFactEdit(fact.id, fact.content)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            {editingFactIds.has(fact.id) ? 'Abbrechen' : 'Bearbeiten'}
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Möchten Sie diesen Fakt wirklich löschen?')) {
                                onDeleteFact(fact.id);
                              }
                            }}
                            className="text-foreground/40 hover:text-foreground transition-colors duration-200"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                      {fact.question && (
                        <p className="text-xs text-muted-foreground mb-2">
                          {fact.question}
                        </p>
                      )}
                      {editingFactIds.has(fact.id) ? (
                        <textarea
                          value={editedFacts[fact.id] || fact.content}
                          onChange={(e) => onFactContentChange(fact.id, e.target.value)}
                          className="w-full resize-none rounded border border-border bg-background p-3 text-sm text-foreground focus:border-white/20 focus:outline-none"
                          rows={3}
                        />
                      ) : (
                        <p className="text-sm text-foreground leading-relaxed">{fact.content}</p>
                      )}
                    </div>
                  ))}

                  {chunkFacts.length === 0 && newFacts.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">Keine Fakten aus diesem Chunk extrahiert.</p>
                      <p className="text-sm text-muted-foreground mt-2">
                        Klicken Sie auf "+" um manuell einen Fakt hinzuzufügen.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer - Informationen */}
        <div className="p-3 border-t border-border shrink-0">
          {/* Desktop Layout - horizontal */}
          <div className="hidden lg:flex justify-between items-center">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div>
                {chunkFacts.length + newFacts.length} Fakten
              </div>
              {chunkDetails && (
                <div>
                  {chunkDetails.content?.length || 0} Zeichen
                </div>
              )}
              {chunkDetails && chunkDetails.content && (
                <div>
                  {chunkDetails.content.trim().split(/\s+/).filter((word: string) => word.length > 0).length} Wörter
                </div>
              )}
              {chunkDetails && chunkDetails.content && (
                <div>
                  ~{Math.ceil(chunkDetails.content.trim().split(/\s+/).filter((word: string) => word.length > 0).length * 1.33)} Tokens
                </div>
              )}
                </div>
            <div className="flex gap-2">
              {(isEditingChunk || editingFactIds.size > 0 || newFacts.length > 0) && (
                <button
                  onClick={onSaveChanges}
                  disabled={savingChanges}
                  className="rounded px-3 py-1 text-xs bg-primary text-foreground hover:bg-pink-600 disabled:opacity-50 flex items-center gap-1"
                >
                  {savingChanges ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Speichern...
                    </>
                  ) : (
                    'Speichern'
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Mobile Layout - kompakt in Zeilen */}
          <div className="lg:hidden space-y-2">
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <div className="flex items-center gap-3 text-xs">
                <div>{chunkFacts.length + newFacts.length} Fakten</div>
                {chunkDetails && (
                  <div>{chunkDetails.content?.length || 0} Zeichen</div>
                )}
                {chunkDetails && chunkDetails.content && (
                  <div>
                    {chunkDetails.content.trim().split(/\s+/).filter((word: string) => word.length > 0).length} Wörter
                  </div>
                )}
                {chunkDetails && chunkDetails.content && (
                  <div>
                    ~{Math.ceil(chunkDetails.content.trim().split(/\s+/).filter((word: string) => word.length > 0).length * 1.33)} Tokens
                  </div>
                )}
              </div>
              {(isEditingChunk || editingFactIds.size > 0 || newFacts.length > 0) && (
                <button
                  onClick={onSaveChanges}
                  disabled={savingChanges}
                  className="rounded px-3 py-1 text-xs bg-primary text-foreground hover:bg-pink-600 disabled:opacity-50 flex items-center gap-1"
                >
                  {savingChanges ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Speichern...
                    </>
                  ) : (
                    'Speichern'
                  )}
                </button>
              )}
            </div>
            {selectedItem && (
              <div className="text-xs text-muted-foreground truncate">
                Quelle: {selectedItem.source_name || "Unbekannt"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

ChunkDetailsModal.displayName = 'ChunkDetailsModal';

// Diese Komponente ist eine Variante der KnowledgeBasePage, die direkt im Dashboard verwendet werden kann
export default function KnowledgeComponentDashboard() {
  const supabase = createClientComponentClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<
    string | null
  >(null)
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<any | null>(null)
  const [companyName, setCompanyName] = useState<string>("")
  const [activeTab, setActiveTab] = useState<'upload' | 'entries' | 'graph'>('upload')
  const [knowledgeItems, setKnowledgeItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  
  // Filter-States
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<string | null>(null)
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [showSourceDropdown, setShowSourceDropdown] = useState(false)
  const [showDateDropdown, setShowDateDropdown] = useState(false)
  const [filteredItems, setFilteredItems] = useState<any[]>([])
  const [globalFacts, setGlobalFacts] = useState<any[]>([])

  // ✅ NEU: Enhanced Search States
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchPagination, setSearchPagination] = useState({
    offset: 0,
    limit: 100,
    total: 0,
    hasMore: false
  })
  const [isSearchMode, setIsSearchMode] = useState(false) // Whether we're showing search results

  // Pagination states
  const [currentPage, setCurrentPage] = useState(0)
  const [pageSize] = useState(100) // Load 100 items initially and for pagination
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreItems, setHasMoreItems] = useState(true)
  const [totalItemsCount, setTotalItemsCount] = useState(0) // ✅ NEU: Gesamtzahl aller Einträge in der DB
  const [allItemsLoaded, setAllItemsLoaded] = useState<any[]>([]) // Keep track of all loaded items for filtering

  // ✅ NEU: Modal-States für Chunk-Details
  const [selectedItem, setSelectedItem] = useState<any | null>(null)
  const [showChunkModal, setShowChunkModal] = useState(false)
  const [chunkDetails, setChunkDetails] = useState<any | null>(null)
  const [chunkFacts, setChunkFacts] = useState<any[]>([])
  const [loadingChunkDetails, setLoadingChunkDetails] = useState(false)

  // ✅ NEU: Chunk-Navigation States
  const [relatedChunks, setRelatedChunks] = useState<any[]>([])
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const [loadingRelatedChunks, setLoadingRelatedChunks] = useState(false)

  // ✅ NEU: Edit-Modi und States
  const [isEditingChunk, setIsEditingChunk] = useState(false)
  const [editedChunkContent, setEditedChunkContent] = useState("")
  const [editingFactIds, setEditingFactIds] = useState<Set<string>>(new Set())
  const [editedFacts, setEditedFacts] = useState<{[key: string]: string}>({})
  const [newFacts, setNewFacts] = useState<string[]>([])
  const [savingChanges, setSavingChanges] = useState(false)

  // ✅ NEU: Mismatch Finder States
  const [showMismatchFinder, setShowMismatchFinder] = useState(false)
  const [showChunkCombiner, setShowChunkCombiner] = useState(false)

  // ✅ NEU: Chunk-Erstellungs-States
  const [showCreateChunkModal, setShowCreateChunkModal] = useState(false)
  const [newChunkContent, setNewChunkContent] = useState('')
  const [creatingChunk, setCreatingChunk] = useState(false)

  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [isUploading, setIsUploading] = useState(false)

  // ✅ NEU: Info-Hover State für magische Transformation
  const [isInfoHovered, setIsInfoHovered] = useState(false)
  const [isLeftInfoHovered, setIsLeftInfoHovered] = useState(false)

  // ✅ NEU: Bulk-Delete States
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [confirmingItemId, setConfirmingItemId] = useState<string | null>(null)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [isDeletingBulk, setIsDeletingBulk] = useState(false)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [isRightInfoHovered, setIsRightInfoHovered] = useState(false)

  // ✅ NEU: Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // ✅ NEU: Trigger, um die KnowledgeBaseList nach Erstellung sofort zu aktualisieren
  const [triggerListUpdate, setTriggerListUpdate] = useState<any>(null)

     // ✅ NEU: Markdown-Formatierung States
   const [isMarkdownFormatting, setIsMarkdownFormatting] = useState(false)
   const [aiSummaryResult, setAiSummaryResult] = useState<{summary: string, originalText: string, originalLength: number, summaryLength: number} | null>(null)
   
   // ✅ NEU: Fakten-Regenerierung States
   const [isRegeneratingFacts, setIsRegeneratingFacts] = useState(false)
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  
  // ✅ NEU: Hilfe Modal State
  const [showHelpModal, setShowHelpModal] = useState(false)
  
  // ✅ NEU: Header-Suche States
  const [headerSearchQuery, setHeaderSearchQuery] = useState('')
  const [headerSearchResults, setHeaderSearchResults] = useState<{chunks: any[], facts: any[]}>({chunks: [], facts: []})
  const [showHeaderSearchResults, setShowHeaderSearchResults] = useState(false)

  // ✅ Toast via Sonner (shadcn)
  const addToast = useCallback((type: 'success' | 'error' | 'info' | 'warning', message: string, duration = 5000) => {
    if (type === "success") playSuccess();
    else if (type === "error") playError();
    else if (type === "warning") playWarning();

    const options = { duration: duration > 0 ? duration : undefined };
    if (type === "success") toast.success(highlightToastMessage(message, "success"), options);
    else if (type === "error") toast.error(message, options);
    else if (type === "warning") toast.warning(message, options);
    else toast.info(message, options);
  }, []);

  // ✅ NEU: Enhanced Search Function
  const performEnhancedSearch = useCallback(async (
    searchTerm: string,
    source: string | null = null,
    date: string | null = null,
    offset: number = 0,
    shouldReset: boolean = true
  ) => {
    if (!selectedKnowledgeBaseId || !user) return;

    // If search term is empty, exit search mode
    if (!searchTerm.trim() && !source && !date) {
      setIsSearchMode(false);
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    if (shouldReset) {
      setSearchResults([]);
      setSearchPagination(prev => ({ ...prev, offset: 0 }));
    }

    try {
      const response = await fetch('/api/knowledge/search-enhanced', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          knowledge_base_id: selectedKnowledgeBaseId,
          search_term: searchTerm.trim() || undefined,
          source_filter: source,
          date_filter: date,
          limit: 100,
          offset: offset
        })
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();

      if (shouldReset) {
        setSearchResults(data.results || []);
      } else {
        setSearchResults(prev => [...prev, ...(data.results || [])]);
      }

      setSearchPagination(data.pagination || {
        offset: 0,
        limit: 100,
        total: 0,
        hasMore: false
      });

      setIsSearchMode(true);

      logger.verbose(`Enhanced search found ${data.results?.length || 0} results`);

    } catch (error) {
      logger.error('Enhanced search error', error);
      addToast('error', 'Fehler bei der Suche');
    } finally {
      setIsSearching(false);
    }
  }, [selectedKnowledgeBaseId, user, supabase, addToast]);

  // ✅ NEU: Load More Knowledge Items
  const loadMoreKnowledgeItems = useCallback(async () => {
    if (!selectedKnowledgeBase?.id || !hasMoreItems || loadingMore) return;

    const nextPage = currentPage + 1;
    await fetchKnowledgeItems(selectedKnowledgeBase.id, nextPage, true);
  }, [selectedKnowledgeBase, hasMoreItems, loadingMore, currentPage]);

  // ✅ NEU: Load More Search Results
  const loadMoreSearchResults = useCallback(async () => {
    if (!searchPagination.hasMore || isSearching) return;

    await performEnhancedSearch(
      debouncedSearchQuery,
      sourceFilter,
      dateFilter,
      searchPagination.offset + searchPagination.limit,
      false // Don't reset results
    );
  }, [searchPagination, isSearching, debouncedSearchQuery, sourceFilter, dateFilter, performEnhancedSearch]);

  // ✅ NEU: Intersection Observer für unendliches Scrollen
  const observer = useRef<IntersectionObserver>()
  const lastItemRef = useCallback(
    (node: HTMLDivElement) => {
      if (loadingMore || isSearching) return
      if (observer.current) observer.current.disconnect()
      observer.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && entries[0].intersectionRatio > 0) {
          if (isSearchMode) {
            if (searchPagination.hasMore) {
              loadMoreSearchResults()
            }
          } else {
            if (hasMoreItems) {
              loadMoreKnowledgeItems()
            }
          }
        }
      }, {
        rootMargin: '100px', // Trigger 100px vor dem Erreichen des Elements
        threshold: 0.1 // Mindestens 10% des Elements müssen sichtbar sein
      })
      if (node) observer.current.observe(node)
    },
    [
      loadingMore,
      isSearching,
      isSearchMode,
      hasMoreItems,
      searchPagination.hasMore,
      loadMoreKnowledgeItems,
      loadMoreSearchResults
    ]
  )

  const itemsToRender = isSearchMode
    ? searchResults
    : (filteredItems.length > 0 ? filteredItems : allItemsLoaded)

  // ✅ NEU: Header-Suche Handler
  const performHeaderSearch = useCallback(async (query: string) => {
    if (!query.trim() || !selectedItem) {
      setHeaderSearchResults({chunks: [], facts: []});
      setShowHeaderSearchResults(false);
      return;
    }

    const searchTerm = query.toLowerCase();

    // Suche in allen verwandten Chunks
    const foundChunks = relatedChunks.filter(chunk =>
      chunk.content.toLowerCase().includes(searchTerm)
    ).slice(0, 5); // Limitiere auf 5 Ergebnisse

    let foundFacts: any[] = [];

    // Verwende globale Fakten falls verfügbar, sonst lade sie
    if (globalFacts.length > 0) {
      foundFacts = globalFacts.filter(fact => {
        const query = searchTerm.toLowerCase();
        return (fact.content && fact.content.toLowerCase().includes(query)) ||
               (fact.question && fact.question.toLowerCase().includes(query));
      }).slice(0, 5);
    } else {
      // Lade alle Fakten aus allen Chunks des Dokuments
      try {
        const { data: allFacts, error } = await supabase
          .from('knowledge_items')
          .select(`
            *,
            chunks!inner(content)
          `)
          .eq('chunks.document_id', selectedItem.document_id)
          .order('created_at', { ascending: false });

        if (!error && allFacts) {
          setGlobalFacts(allFacts);
          foundFacts = allFacts.filter(fact => {
            const query = searchTerm.toLowerCase();
            return (fact.content && fact.content.toLowerCase().includes(query)) ||
                   (fact.question && fact.question.toLowerCase().includes(query));
          }).slice(0, 5);
        } else {
          // Fallback auf lokale Fakten falls globale Fakten nicht geladen werden können
          foundFacts = chunkFacts.filter(fact => {
            const query = searchTerm.toLowerCase();
            return (fact.content && fact.content.toLowerCase().includes(query)) ||
                   (fact.question && fact.question.toLowerCase().includes(query));
          }).slice(0, 5);
        }
      } catch (err) {
        logger.error('Fehler beim Laden der globalen Fakten für Suche', err);
        // Fallback auf lokale Fakten
        foundFacts = chunkFacts.filter(fact => {
          const query = searchTerm.toLowerCase();
          return (fact.content && fact.content.toLowerCase().includes(query)) ||
                 (fact.question && fact.question.toLowerCase().includes(query));
        }).slice(0, 5);
      }
    }

    setHeaderSearchResults({chunks: foundChunks, facts: foundFacts});
    setShowHeaderSearchResults(foundChunks.length > 0 || foundFacts.length > 0);
  }, [relatedChunks, chunkFacts, globalFacts, selectedItem, supabase]);

  // ✅ NEU: Funktion zum Laden aller Fakten aus allen Chunks
  const loadGlobalFacts = useCallback(async () => {
    if (!selectedItem?.id) return;

    try {
      // Lade alle Fakten aus allen Chunks des Dokuments
      const { data: allFacts, error } = await supabase
        .from('knowledge_items')
        .select('*')
        .eq('document_id', selectedItem.document_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setGlobalFacts(allFacts || []);
    } catch (err) {
      logger.error('Fehler beim Laden der globalen Fakten', err);
    }
  }, [selectedItem?.id, supabase]);

  // ✅ NEU: Markdown-Formatierungs-Handler
  const handleMarkdownFormat = useCallback(async () => {
    // Verwende editedChunkContent wenn im Edit-Modus, sonst original content
    const contentToFormat = isEditingChunk ? editedChunkContent : (chunkDetails?.content || '');
    
    if (!contentToFormat.trim()) {
      addToast('warning', 'Kein Text vorhanden für Markdown-Formatierung.');
      return;
    }
    
    // WICHTIG: Bearbeitungsmodus aktivieren BEVOR wir beginnen
    if (!isEditingChunk) {
      setIsEditingChunk(true);
      setEditedChunkContent(contentToFormat); // Original Content setzen
    }
    
    setIsMarkdownFormatting(true);
    
    try {
      const response = await fetch('/api/knowledge/format-markdown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: contentToFormat,
          chunkId: chunkDetails?.id || 'unknown'
        }),
      });

      if (!response.ok) {
        throw new Error('Markdown-Formatierung fehlgeschlagen');
      }

      const result = await response.json();
      
      // Den Chunk-Content direkt mit dem formatierten Markdown ersetzen
      setEditedChunkContent(result.formattedMarkdown);
      
      // Sicherstellen, dass Edit-Modus aktiviert ist
      if (!isEditingChunk) {
        setIsEditingChunk(true);
      }
      
      addToast('success', 'Chunk wurde aufbereitet. Bitte speichern Sie die Änderungen.');
      
    } catch (error) {
      // console.error('Fehler bei Markdown-Formatierung:', error);
      addToast('error', 'Fehler bei der Markdown-Formatierung. Bitte versuchen Sie es später erneut.');
    } finally {
      setIsMarkdownFormatting(false);
    }
     }, [chunkDetails, editedChunkContent, isEditingChunk, addToast, setIsEditingChunk, setEditedChunkContent]);

   // ✅ NEU: Fakten-Regenerierung Handler
  const handleRegenerateFacts = useCallback(async () => {
    if (!chunkDetails?.content || !chunkDetails?.id) {
       addToast('warning', 'Kein Chunk-Inhalt zum Regenerieren verfügbar.');
       return;
     }
    if (!selectedKnowledgeBaseId) {
      addToast('error', 'Bitte wähle zuerst eine Wissensdatenbank aus.');
      return;
    }
     
         setIsRegeneratingFacts(true);
    
    // ✅ NEU: Bestehende Fakten SOFORT aus dem UI entfernen (VOR dem API-Call)
    
    // ✅ CRITICAL: Delete facts from DATABASE first (like bulk delete does)
    // First, get IDs of facts that belong to this chunk
    const chunkFactIds = new Set(
      knowledgeItems
        .filter(item => item.source_chunk === chunkDetails.id)
        .map(item => item.id)
    );
    

    
    // ✅ DELETE FROM DATABASE first
    if (chunkFactIds.size > 0) {
      try {
        const deleteResponse = await fetch('/api/knowledge/bulk-delete', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ itemIds: Array.from(chunkFactIds) }),
        });

        if (!deleteResponse.ok) {
          const errorData = await deleteResponse.json();
          throw new Error(errorData.error || 'Failed to delete existing facts');
        }
      } catch (error) {
        // console.error('Error deleting existing facts:', error);
        addToast('error', 'Fehler beim Löschen der bestehenden Fakten');
        return;
      }
    }
    
    // Remove from frontend state (like bulk delete does)
    setKnowledgeItems(prevItems => 
      prevItems.filter(item => !chunkFactIds.has(item.id))
    );
    
    // Also clear chunkFacts
    setChunkFacts([]);
    
    addToast('success', 'Fakten-Regenerierung wurde gestartet. Bestehende Fakten wurden gelöscht, neue werden generiert.');
    
    try {
      const response = await fetch('/api/knowledge/regenerate-facts', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           chunkId: chunkDetails.id,
           chunkContent: isEditingChunk ? editedChunkContent : chunkDetails.content,
           documentId: chunkDetails.document_id,
           knowledgeBaseId: selectedKnowledgeBaseId
         }),
       });

             if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Fakten-Regenerierung fehlgeschlagen');
      }
       
             // ✅ NEU: Polling für Fakten-Updates starten (gibt Promise zurück)
      const pollForFactsUpdate = () => {
        return new Promise<void>(resolve => {
          let attempts = 0;
          const maxAttempts = 30; // 30 Sekunden polling
          
          const poll = async () => {
            if (attempts >= maxAttempts) {
              // console.log('[facts-regeneration] Polling timeout reached');
              setIsRegeneratingFacts(false); // Spinner stoppen bei Timeout
              addToast('warning', 'Zeitüberschreitung bei der Fakten-Regenerierung. Bitte prüfen Sie später, ob neue Fakten generiert wurden.');
              resolve(); // Promise auflösen
              return;
            }
            
            try {
              // Lade aktuelle Fakten für den Chunk
              const { data: updatedFacts, error: factsError } = await supabase
                .from("knowledge_items")
                .select("*")
                .eq("source_chunk", chunkDetails.id)
                .order("created_at", { ascending: true });

              if (!factsError && updatedFacts && updatedFacts.length > 0) {
                // Neue Fakten sind verfügbar!
                setChunkFacts(updatedFacts);
                
                // Aktualisiere auch die globale Knowledge Items Liste
                setKnowledgeItems(prevItems => {
                  const otherItems = prevItems.filter(item => item.source_chunk !== chunkDetails.id);
                  return [...otherItems, ...updatedFacts];
                });
                
                addToast('success', `Fakten-Regenerierung abgeschlossen! ${updatedFacts.length} neue Fakten generiert.`);
                
                setIsRegeneratingFacts(false); // Spinner stoppen wenn Fakten gefunden wurden
                resolve(); // Promise auflösen
                return;
              }
              
              attempts++;
              setTimeout(poll, 1000); // Alle 1 Sekunde prüfen
            } catch (error) {
              // console.error('[facts-regeneration] Polling error:', error);
              attempts++;
              setTimeout(poll, 1000);
            }
          };
          
          // Start polling nach 2 Sekunden (Server braucht Zeit)
          setTimeout(poll, 2000);
        });
       };
       
             // Starte das Polling und setze isRegeneratingFacts erst am Ende zurück
      await pollForFactsUpdate();
      
    } catch (error) {
      // console.error('Fehler bei Fakten-Regenerierung:', error);
      addToast('error', 'Fehler bei der Fakten-Regenerierung. Bitte versuchen Sie es später erneut.');
      // Bei Fehler den Spinner stoppen
      setIsRegeneratingFacts(false);
    }
    // Kein finally-Block mehr, da wir isRegeneratingFacts im Polling zurücksetzen
  }, [
    chunkDetails,
    editedChunkContent,
    isEditingChunk,
    addToast,
    chunkFacts,
    supabase,
    setChunkFacts,
    setKnowledgeItems,
    selectedKnowledgeBaseId,
    knowledgeItems
  ]);



  // ✅ NEU: Stabilisierte Event-Handler für Modal
  const handleCloseModal = useCallback(() => {
    setShowChunkModal(false);
    setSelectedItem(null);
    setChunkDetails(null);
    setChunkFacts([]);
    // Reset Edit-States
    setIsEditingChunk(false);
    setEditedChunkContent("");
    setEditingFactIds(new Set());
    setEditedFacts({});
    setNewFacts([]);
    // ✅ NEU: Reset Chunk-Navigation States
    setRelatedChunks([]);
    setCurrentChunkIndex(0);
    setLoadingRelatedChunks(false);
  }, []);

  // ✅ NEU: Handler für Chunk-Navigation
  const onNavigateToChunk = useCallback(async (chunkIndex: number) => {
    if (chunkIndex < 0 || chunkIndex >= relatedChunks.length) return;
    
    const targetChunk = relatedChunks[chunkIndex];
    setCurrentChunkIndex(chunkIndex);
    setLoadingChunkDetails(true);
    
    try {
      // Lade Details des Ziel-Chunks
      const { data: chunkData, error: chunkError } = await supabase
        .from("document_chunks")
        .select("*")
        .eq("id", targetChunk.id)
        .single();

      if (chunkError) throw chunkError;
      setChunkDetails(chunkData);
      setEditedChunkContent(chunkData.content || "");

      // Lade Fakten für den neuen Chunk
      const { data: factsData, error: factsError } = await supabase
        .from("knowledge_items")
        .select("*")
        .eq("source_chunk", targetChunk.id)
        .order("created_at", { ascending: true });

      if (factsError) throw factsError;
      setChunkFacts(factsData || []);

      // Reset Edit-States für neuen Chunk
      setIsEditingChunk(false);
      setEditingFactIds(new Set());
      setEditedFacts({});
      setNewFacts([]);

    } catch (err) {
      // console.error("Error loading chunk details:", err);
    } finally {
      setLoadingChunkDetails(false);
    }
  }, [relatedChunks, supabase]);

  const handleEditChunk = useCallback((editing: boolean) => {
    if (editing) {
      setIsEditingChunk(true);
    } else {
      setIsEditingChunk(false);
      setEditedChunkContent(chunkDetails?.content || "");
    }
  }, [chunkDetails]);

  const handleChunkContentChange = useCallback((content: string) => {
    setEditedChunkContent(content);
  }, []);

  const handleToggleFactEdit = useCallback((factId: string, content: string) => {
    const newEditingIds = new Set(editingFactIds);
    if (editingFactIds.has(factId)) {
      newEditingIds.delete(factId);
      const newEditedFacts = {...editedFacts};
      delete newEditedFacts[factId];
      setEditedFacts(newEditedFacts);
    } else {
      newEditingIds.add(factId);
      setEditedFacts({...editedFacts, [factId]: content});
    }
    setEditingFactIds(newEditingIds);
  }, [editingFactIds, editedFacts]);

  const handleFactContentChange = useCallback((factId: string, content: string) => {
    setEditedFacts(prev => ({
      ...prev,
      [factId]: content
    }));
  }, []);

  const handleAddNewFact = useCallback(() => {
    // console.log('🆕 Neuen Fakt hinzufügen');
    setNewFacts(prev => {
      const updated = [...prev, ""];
      // console.log('📝 Neue Fakten Array:', updated);
      return updated;
    });
  }, []);

  const handleRemoveNewFact = useCallback((index: number) => {
    setNewFacts(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleNewFactChange = useCallback((index: number, content: string) => {
    // console.log(`✏️ Fakt ${index} ändern:`, content);
    setNewFacts(prev => {
      const updated = [...prev];
      updated[index] = content;
      // console.log('📝 Aktualisierte Fakten Array:', updated);
      return updated;
    });
  }, []);

  const handleDeleteFact = useCallback(async (factId: string) => {
    try {
      const response = await fetch('/api/knowledge/delete-item', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemId: factId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete knowledge item');
      }

      // Remove from local chunkFacts state
      setChunkFacts(prevFacts => prevFacts.filter(fact => fact.id !== factId));

      // Remove from main knowledgeItems list if it exists there
      setKnowledgeItems(prevItems => prevItems.filter(item => item.id !== factId));
      setAllItemsLoaded(prevItems => prevItems.filter(item => item.id !== factId));
      
      // ✅ NEU: Toast-Notification für erfolgreiche Löschung
      addToast('success', 'Fakt erfolgreich gelöscht');
      // console.log('Fact deleted successfully');
    } catch (error) {
      // console.error('Error deleting fact:', error);
      // ✅ NEU: Toast-Notification für Fehler
      addToast('error', 'Fehler beim Löschen des Fakts');
    }
  }, []);



  // Handler für Suchfeldfokus-Probleme - mit useCallback stabilisieren
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  // Stable handlers für Filter
  const handleSourceFilterChange = useCallback((source: string | null) => {
    setSourceFilter(source);
    setShowSourceDropdown(false);
  }, []);

  const handleDateFilterChange = useCallback((dateFilter: string | null) => {
    setDateFilter(dateFilter);
    setShowDateDropdown(false);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setSourceFilter(null);
    setDateFilter(null);
    setSearchQuery("");
    setIsSearchMode(false);
    setSearchResults([]);
  }, []);

  // Debounce-Mechanismus für die Suche mit Enhanced Search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      
      // Trigger enhanced search when search query changes
      if (selectedKnowledgeBaseId) {
        performEnhancedSearch(searchQuery, sourceFilter, dateFilter);
      }
    }, 300); // 300ms Verzögerung
    
    return () => clearTimeout(timer);
  }, [searchQuery, sourceFilter, dateFilter, selectedKnowledgeBaseId, performEnhancedSearch]);

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (session) {
        setUser(session.user)
        setIsAdmin(true) // Placeholder: Assume admin for now
        
        // Get company name from saved company info
        const company = getSavedCompany()
        if (company && company.name) {
          setCompanyName(company.name)
        }
      } else {
        // console.log("User not logged in in KnowledgeComponentDashboard")
      }
      setLoading(false)
    }
    getUser()
  }, [supabase])

  useEffect(() => {
    // Fetch the selected knowledge base details when the ID changes
    const fetchKnowledgeBaseDetails = async () => {
      if (!selectedKnowledgeBaseId || !user) return;
      
      try {
        const { data, error } = await supabase
          .from("knowledge_bases")
          .select("*")
          .eq("id", selectedKnowledgeBaseId)
          .single();
          
        if (error) throw error;
        setSelectedKnowledgeBase(data);
        
        // Fetch knowledge items for this knowledge base
        fetchKnowledgeItems(selectedKnowledgeBaseId);
        
      } catch (err) {
        // console.error("Error fetching knowledge base details:", err);
      }
    };
    
    fetchKnowledgeBaseDetails();
  }, [selectedKnowledgeBaseId, user, supabase]);

  // ✅ NEU: Lade globale Fakten wenn ein Item ausgewählt wird
  useEffect(() => {
    if (selectedItem?.id) {
      setGlobalFacts([]); // Reset globale Fakten
      // Lade globale Fakten beim nächsten Such-Event
    }
  }, [selectedItem?.id]);

  // ✅ NEU: Lade globale Fakten wenn Suche aktiviert wird
  useEffect(() => {
    if (selectedItem?.id && globalFacts.length === 0) {
      // Lade globale Fakten nur wenn noch nicht geladen
      loadGlobalFacts();
    }
  }, [selectedItem?.id, globalFacts.length, loadGlobalFacts]);

  // ✅ NEU: Debounced Header Search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (headerSearchQuery.trim()) {
        performHeaderSearch(headerSearchQuery);
      } else {
        setHeaderSearchResults({chunks: [], facts: []});
        setShowHeaderSearchResults(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [headerSearchQuery, performHeaderSearch]);

  // Funktion zum Laden aller verfügbaren Quellen
  const fetchAvailableSources = async (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      if (!authToken) {
        logger.error('No auth token available for sources request');
        return;
      }

      const response = await fetch('/api/knowledge/sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          knowledge_base_id: knowledgeBaseId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Sources API error: ${response.status}`);
      }

      const data = await response.json();
      const sources = data.sources || [];
      
      logger.verbose(`Loaded ${sources.length} available sources`);
      setAvailableSources(sources);
      
    } catch (error) {
      logger.error('Error fetching available sources', error);
      setAvailableSources([]);
    }
  };

  // Funktion zum Laden der Wissenseinträge
  const fetchKnowledgeItems = useCallback(async (knowledgeBaseId: string, page: number = 0, append: boolean = false) => {
    if (!knowledgeBaseId) return;

    if (page === 0 && !append) {
      setLoadingItems(true);
      // Reset pagination state when loading first page
      setCurrentPage(0);
      setHasMoreItems(true);
      setAllItemsLoaded([]);
      // Reset filters when loading new items
      setSearchQuery("");
      setDebouncedSearchQuery("");
      setSourceFilter(null);
      setDateFilter(null);
      
      // Lade alle verfügbaren Quellen separat
      fetchAvailableSources(knowledgeBaseId);
    } else if (append) {
      setLoadingMore(true);
    }

    try {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      // ✅ NEU: Gesamtzahl abrufen (nur beim ersten Laden)
      if (page === 0 && !append) {
        const { count, error: countError } = await supabase
          .from("knowledge_items")
          .select("*", { count: 'exact', head: true })
          .eq("knowledge_base_id", knowledgeBaseId);
        
        if (!countError && count !== null) {
          setTotalItemsCount(count);
        }
      }

      // Load data with pagination
      const { data, error } = await supabase
        .from("knowledge_items")
        .select("*")
        .eq("knowledge_base_id", knowledgeBaseId)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      const items = data || [];
      // Wenn wir weniger als pageSize Items bekommen, gibt es keine weiteren
      // Nur wenn wir genau pageSize (100) Items bekommen, könnte es noch mehr geben
      const hasMore = items.length === pageSize;

      if (append) {
        // Append new items to existing ones
        setAllItemsLoaded(prev => [...prev, ...items]);
        setKnowledgeItems(prev => [...prev, ...items]);
        setFilteredItems(prev => [...prev, ...items]);
        setCurrentPage(page);
      } else {
        // Replace items (first load)
        setAllItemsLoaded(items);
        setKnowledgeItems(items);
        setFilteredItems(items);
        setCurrentPage(0);
      }

      setHasMoreItems(hasMore);

    } catch (err) {
      // console.error("Error fetching knowledge items:", err);
      if (page === 0 && !append) {
        setKnowledgeItems([]);
        setFilteredItems([]);
        setAllItemsLoaded([]);
      }
    } finally {
      if (page === 0 && !append) {
        setLoadingItems(false);
      } else if (append) {
        setLoadingMore(false);
      }
    }
  }, [supabase, pageSize, fetchAvailableSources]);

  // Funktion zum Löschen eines Wissenseintrags
  const deleteKnowledgeItem = async (itemId: string) => {
    try {
      const response = await fetch('/api/knowledge/delete-item', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete knowledge item');
      }

      // Remove the item from local state
      setKnowledgeItems(prevItems => prevItems.filter(item => item.id !== itemId));
      setAllItemsLoaded(prevItems => prevItems.filter(item => item.id !== itemId));

      // ✅ NEU: Toast-Notification für erfolgreiche Löschung
      addToast('success', 'Wissensentrag erfolgreich gelöscht');
      // console.log('Knowledge item deleted successfully');
    } catch (error) {
      // console.error('Error deleting knowledge item:', error);
      // ✅ NEU: Toast-Notification für Fehler
      addToast('error', 'Fehler beim Löschen des Wissenseintrags');
    }
  };

  // ✅ NEU: Bulk-Delete Handler
  const handleBulkDelete = async () => {
    if (selectedItemIds.size === 0) return;
    
    setIsDeletingBulk(true);
    try {
      const response = await fetch('/api/knowledge/bulk-delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemIds: Array.from(selectedItemIds) }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete items');
      }

      // Remove items from local state
      setKnowledgeItems(prevItems =>
        prevItems.filter(item => !selectedItemIds.has(item.id))
      );
      setAllItemsLoaded(prevItems =>
        prevItems.filter(item => !selectedItemIds.has(item.id))
      );

      // Reset selection
      setSelectedItemIds(new Set());
      setIsSelectMode(false);
      setShowBulkDeleteConfirm(false);
      
      addToast('success', `${selectedItemIds.size} Wissenseinträge erfolgreich gelöscht`);
    } catch (error) {
      // console.error('Error bulk deleting items:', error);
      addToast('error', 'Fehler beim Löschen der Wissenseinträge');
    } finally {
      setIsDeletingBulk(false);
    }
  };

  // ✅ NEU: Toggle Select Mode
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    setSelectedItemIds(new Set());
  };

  // ✅ NEU: Toggle Item Selection
  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(itemId)) {
        newSelection.delete(itemId);
      } else {
        newSelection.add(itemId);
      }
      return newSelection;
    });
  };

  // ✅ NEU: Select All Items
  const selectAllItems = () => {
    const allVisibleIds = new Set(filteredItems.map(item => item.id));
    setSelectedItemIds(allVisibleIds);
  };

  // ✅ NEU: Deselect All Items
  const deselectAllItems = () => {
    setSelectedItemIds(new Set());
  };

  // Funktion zum Bearbeiten eines Wissenseintrags
  const updateKnowledgeItem = async (itemId: string, newContent: string) => {
    try {
      const { error } = await supabase
        .from("knowledge_items")
        .update({ content: newContent })
        .eq("id", itemId);
        
      if (error) throw error;
      
      // Nach erfolgreicher Aktualisierung die Liste neu laden
      if (selectedKnowledgeBaseId) {
        fetchKnowledgeItems(selectedKnowledgeBaseId);
      }
    } catch (err) {
      // console.error("Error updating knowledge item:", err);
    }
  };

  // ✅ NEU: Funktion zum Laden der Chunk-Details
  const fetchChunkDetails = async (item: any) => {
    if (!item.source_chunk) {
      logger.error("No source_chunk found for item", { item_id: item.id });
      return;
    }

    setLoadingChunkDetails(true);
    setLoadingRelatedChunks(true); // ✅ NEU: Loading für verwandte Chunks
    setSelectedItem(item);
    setShowChunkModal(true);
    
    // ✅ Reset Edit-States
    setIsEditingChunk(false);
    setEditedChunkContent("");
    setEditingFactIds(new Set());
    setEditedFacts({});
    setNewFacts([]);

    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      if (!authToken) {
        throw new Error('No auth token available for chunk details request');
      }

      // Use the new API route to get chunk details
      const response = await fetch('/api/knowledge/chunk-details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          chunk_id: item.source_chunk,
          knowledge_base_id: selectedKnowledgeBaseId
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API error: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const data = await response.json();

      // Set the loaded data
      setChunkDetails(data.chunk);
      setEditedChunkContent(data.chunk?.content || "");
      setChunkFacts(data.facts || []);
      setRelatedChunks(data.relatedChunks || []);
      setCurrentChunkIndex(data.currentChunkIndex || 0);
      setLoadingRelatedChunks(false);

    } catch (err) {
      logger.error("Error fetching chunk details", {
        error: err,
        item_id: item.id,
        source_chunk: item.source_chunk,
        document_id: item.document_id,
        message: (err as Error)?.message || 'Unknown error'
      });
      setChunkDetails(null);
      setChunkFacts([]);
      setRelatedChunks([]);
      setCurrentChunkIndex(0);
      setLoadingRelatedChunks(false);
    } finally {
      setLoadingChunkDetails(false);
    }
  };
  
  // ✅ NEU: Chunk-Löschungs-Handler
  const handleDeleteChunk = async (chunkId: string) => {
    try {
      const response = await fetch('/api/knowledge/delete-chunk', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chunkId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete chunk');
      }

      // Remove chunk from relatedChunks
      setRelatedChunks(prevChunks => {
        const newChunks = prevChunks.filter(chunk => chunk.id !== chunkId);
        
        // Wenn das der aktuelle Chunk war, navigiere zum ersten verfügbaren
        if (prevChunks[currentChunkIndex]?.id === chunkId) {
          if (newChunks.length === 0) {
            // Keine Chunks mehr übrig - Modal schließen
            setShowChunkModal(false);
            setSelectedItem(null);
            setChunkDetails(null);
            setChunkFacts([]);
          } else {
            // Zum ersten Chunk navigieren
            setCurrentChunkIndex(0);
            fetchChunkDetails(newChunks[0]);
          }
        } else {
          // Aktuellen Index anpassen falls nötig
          const currentChunkStillExists = newChunks.find(chunk => chunk.id === prevChunks[currentChunkIndex]?.id);
          if (!currentChunkStillExists && currentChunkIndex >= newChunks.length) {
            setCurrentChunkIndex(Math.max(0, newChunks.length - 1));
          }
        }
        
        return newChunks;
      });

      // Remove all facts from this chunk from knowledgeItems
      setKnowledgeItems(prevItems => 
        prevItems.filter(item => item.source_chunk !== chunkId)
      );

      addToast('success', 'Chunk und alle zugehörigen Fakten erfolgreich gelöscht');
    } catch (error) {
      // console.error('Error deleting chunk:', error);
      addToast('error', 'Fehler beim Löschen des Chunks');
    }
  };

  
  
  // ✅ ÜBERARBEITET: Neue Funktion für lokale Filterung (nur noch für Fallback ohne Suche)
  useEffect(() => {
    // Wenn wir im Suchmodus sind, verwende Suchergebnisse
    if (isSearchMode) {
      // Wenn wir gerade suchen oder mehr laden, behalte die aktuellen Ergebnisse bei
      if (isSearching || loadingMore) {
        return;
      }

      // Ansonsten aktualisiere nur wenn searchResults Daten enthält
      setFilteredItems(searchResults);
      return;
    }

    // Fallback: Lokale Filterung für normale Ansicht (nur bei Datumsfilter ohne Suchbegriff)
    if (allItemsLoaded.length === 0 && !loadingItems && !loadingMore) {
      setFilteredItems([]);
      return;
    }

    let filtered = [...allItemsLoaded];
    
    // Nur noch Datum-Filter lokal anwenden, wenn keine Suche aktiv ist
    if (dateFilter && !debouncedSearchQuery.trim()) {
      const now = new Date();
      let dateThreshold: Date;
      
      switch (dateFilter) {
        case 'today':
          dateThreshold = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          dateThreshold = subWeeks(now, 1);
          break;
        case 'month':
          dateThreshold = subMonths(now, 1);
          break;
        case 'three_months':
          dateThreshold = subMonths(now, 3);
          break;
        default:
          dateThreshold = new Date(0);
      }
      
      filtered = filtered.filter(item => {
        const itemDate = new Date(item.created_at);
        return isAfter(itemDate, dateThreshold);
      });
    }
    
    // Quelle lokal filtern, wenn keine Suche aktiv ist
    if (sourceFilter && !debouncedSearchQuery.trim()) {
      filtered = filtered.filter(item => 
        (item.source_name || "Unbekannt") === sourceFilter
      );
    }
    
    setFilteredItems(filtered);
  }, [allItemsLoaded, isSearchMode, searchResults, sourceFilter, dateFilter, debouncedSearchQuery, loadingItems, loadingMore, isSearching]);

  // ✅ NEU: Funktion zum Speichern der Änderungen
  const saveChunkChanges = async () => {
    if (!chunkDetails) {
      // console.error('Keine Chunk-Details verfügbar');
      return;
    }

    setSavingChanges(true);
    // console.log('🚀 Starte Speicherung der Chunk-Änderungen...');
    // console.log('📋 Aktuelle newFacts:', newFacts);

    try {
      // Sammle alle Änderungen
      const updatedFacts: {[key: string]: string} = {};
      editingFactIds.forEach(factId => {
        if (editedFacts[factId]) {
          updatedFacts[factId] = editedFacts[factId];
        }
      });

      const hasChunkChanges = editedChunkContent !== chunkDetails.content;
      const hasFactChanges = Object.keys(updatedFacts).length > 0;
      const hasNewFacts = newFacts.filter(f => f.trim()).length > 0;

      // console.log('📊 Detaillierte Änderungsanalyse:', {
      //   hasChunkChanges,
      //   hasFactChanges,
      //   hasNewFacts,
      //   editedFactsCount: Object.keys(updatedFacts).length,
      //   newFactsCount: newFacts.filter(f => f.trim()).length,
      //   debugChunkComparison: {
      //     editedChunkContent: `"${editedChunkContent}"`,
      //     originalChunkContent: `"${chunkDetails.content}"`,
      //     areEqual: editedChunkContent === chunkDetails.content,
      //     editedLength: editedChunkContent.length,
      //     originalLength: chunkDetails.content?.length || 0
      //   }
      // });

      if (!hasChunkChanges && !hasFactChanges && !hasNewFacts) {
        // console.log('ℹ️ Keine Änderungen zu speichern');
        // Keine Änderungen, aber räume leere neue Fakten auf
        setIsEditingChunk(false);
        setEditingFactIds(new Set());
        setNewFacts([]); // ✅ Entferne leere neue Fakten
        return;
      }

      const requestBody = {
        chunkId: chunkDetails.id,
        knowledgeBaseId: selectedKnowledgeBaseId,
        newChunkContent: hasChunkChanges ? editedChunkContent : undefined,
        updatedFacts: hasFactChanges ? updatedFacts : undefined,
        newFacts: hasNewFacts ? newFacts.filter(f => f.trim()) : undefined
      };

      // console.log('📤 API-Request Body:', requestBody);

      const response = await fetch('/api/cursor/update-chunk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        credentials: 'include' // Wichtig für Auth
      });

      // console.log('📥 API Response Status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        // console.error('❌ API Error Response:', errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        throw new Error(errorData.error || `HTTP ${response.status}: Update fehlgeschlagen`);
      }

      const responseData = await response.json();
      // console.log('✅ API Success Response:', responseData);

      // Optimistisch die lokalen Daten aktualisieren, bevor neu geladen wird
      if (hasChunkChanges) {
        // console.log('🔄 Aktualisiere Chunk-Details optimistisch...');
        setChunkDetails((prev: any) => prev ? { ...prev, content: editedChunkContent } : prev);
      }

      // Exit edit modes
      setIsEditingChunk(false);
      setEditingFactIds(new Set());
      setNewFacts([]);

      // Kurze Verzögerung, dann neu laden (um DB-Propagation zu gewährleisten)
      setTimeout(async () => {
        // console.log('🔄 Lade Chunk-Details neu nach Verzögerung...');
        await fetchChunkDetails(selectedItem);
        
        // Refresh auch die Hauptliste
        if (selectedKnowledgeBaseId) {
          // console.log('🔄 Lade Knowledge-Items neu...');
          fetchKnowledgeItems(selectedKnowledgeBaseId);
        }
      }, 500); // 500ms Verzögerung

      // console.log('✨ Chunk-Änderungen erfolgreich gespeichert!');
      
      // Keine Alert-Meldung mehr - nur console log für debugging

    } catch (error: any) {
      // console.error('💥 Error saving chunk changes:', error);
      alert(`Fehler beim Speichern: ${error.message}`);
    } finally {
      setSavingChanges(false);
    }
  };

  // ✅ NEU: Funktion zum Erstellen neuer Chunks
  const handleCreateChunk = async () => {
    if (!newChunkContent.trim()) {
      addToast('error', 'Bitte geben Sie einen Chunk-Inhalt ein');
      return;
    }

    if (!selectedItem?.document_id) {
      addToast('error', 'Kein Dokument ausgewählt');
      return;
    }

    setCreatingChunk(true);
    try {
      const response = await fetch('/api/knowledge/create-chunk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentId: selectedItem.document_id,
          content: newChunkContent.trim(),
          knowledgeBaseId: selectedKnowledgeBaseId,
          userId: user?.id
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Fehler beim Erstellen des Chunks');
      }

      const result = await response.json();
      
      addToast('success', 'Chunk erfolgreich erstellt');
      
      // Modal schließen und zurücksetzen
      setShowCreateChunkModal(false);
      setNewChunkContent('');
      
      // Reload chunks und items
      if (selectedKnowledgeBaseId) {
        fetchKnowledgeItems(selectedKnowledgeBaseId);
      }
      
      // Lade den neu erstellten Chunk und zeige ihn in der linken Seitenleiste
      setTimeout(async () => {
        // Erstelle ein Item-Objekt für fetchChunkDetails
        const newChunkItem = {
          id: result.chunk.id,
          source_chunk: result.chunk.id,
          document_id: selectedItem.document_id
        };
        
        // Lade Chunk-Details und related chunks neu
        await fetchChunkDetails(newChunkItem);
        
        // Modal ist bereits durch fetchChunkDetails geöffnet
      }, 500);

    } catch (error: any) {
      addToast('error', `Fehler: ${error.message}`);
    } finally {
      setCreatingChunk(false);
    }
  };

  if (loading) {
    return (
      <div className="flex size-full items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="h-8 w-8 rounded-full border-4 border-t-primary border-r-transparent border-b-primary border-l-transparent animate-spin mb-4"></div>
        </div>
      </div>
    )
  };

  if (!user) {
    return (
      <div className="flex size-full items-center justify-center">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center gap-4">
            <DatabaseIcon className="size-12 text-foreground" />
            <h2 className="text-xl font-medium text-foreground">
              Anmeldung erforderlich
            </h2>
            <p className="text-center text-muted-foreground">
              Bitte melden Sie sich an, um auf die Wissensdatenbank zuzugreifen.
            </p>
          </div>
        </div>
      </div>
    )
  };

  if (!isAdmin) {
    return (
      <div className="flex size-full items-center justify-center">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center gap-4">
            <DatabaseIcon className="size-12 text-muted-foreground" />
            <h2 className="text-xl font-medium text-foreground">
              Zugriff verweigert
            </h2>
            <p className="text-center text-muted-foreground">
              Sie haben keine Berechtigung, Wissensdatenbanken zu verwalten.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const handleSelectKnowledgeBase = (id: string | null) => {
    // console.log("Ausgewählte Wissensdatenbank-ID in Dashboard-Komponente:", id)
    setSelectedKnowledgeBaseId(id)
  }

  const handleKnowledgeBaseDeleted = (deletedKbId: string) => {
    // console.log(`Knowledge base deleted: ${deletedKbId}. Updating Dashboard state.`);
    // If the deleted KB was the selected one, reset the selection
    if (selectedKnowledgeBaseId === deletedKbId) {
      setSelectedKnowledgeBaseId(null);
      setSelectedKnowledgeBase(null); // Also clear the detailed KB data
      // Optionally switch the active tab back to upload or a default view
      setActiveTab('upload'); 
    }
    // The list component already updated its internal state, 
    // so no need to force a re-fetch here unless absolutely necessary.
  };
  
  // ✅ NEU: Create Knowledge Base Handlers
  const handleCreateNew = () => {
    setIsCreateModalOpen(true)
  }
  
  const handleCreateModalClose = () => {
    setIsCreateModalOpen(false)
  }
  
  const handleKnowledgeBaseCreated = (newKb: any) => {
    // console.log('New knowledge base created:', newKb)
    setIsCreateModalOpen(false)
    // Optionally select the newly created knowledge base
    setSelectedKnowledgeBaseId(newKb.id)
    // Trigger the list to update by passing the new KB data
    setTriggerListUpdate(newKb)
  }



  // Tab Navigation Buttons
  const renderTabButtons = () => {
    if (!selectedKnowledgeBaseId) return null;
    
    return (
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex gap-1 sm:gap-2 flex-1 min-w-0">
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-1 sm:gap-2 rounded-lg px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all duration-200 ease-in-out ${
              activeTab === 'upload' 
                ? 'bg-primary text-foreground shadow-lg transform scale-[1.005]' 
                : 'bg-muted text-muted-foreground hover:bg-secondary/80 hover:transform hover:scale-[1.0025]'
            }`}
          >
            <Upload className="size-3 sm:size-4" />
            <span className="hidden sm:inline">Inhalt hochladen</span>
            <span className="sm:hidden">Upload</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('entries')
              // ✅ NEU: Automatisches Neuladen der Wissenseinträge beim Tab-Wechsel
              if (selectedKnowledgeBaseId) {
                fetchKnowledgeItems(selectedKnowledgeBaseId)
              }
            }}
            className={`flex items-center gap-1 sm:gap-2 rounded-lg px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all duration-200 ease-in-out ${
              activeTab === 'entries' 
                ? 'bg-primary text-foreground shadow-lg transform scale-[1.005]' 
                : 'bg-muted text-muted-foreground hover:bg-secondary/80 hover:transform hover:scale-[1.0025]'
            }`}
          >
            <List className="size-3 sm:size-4" />
            <span className="hidden sm:inline">Wissenseinträge</span>
            <span className="sm:hidden">Einträge</span>
          </button>
          <button
            onClick={() => setActiveTab('graph')}
            className={`flex items-center gap-1 sm:gap-2 rounded-lg px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all duration-200 ease-in-out ${
              activeTab === 'graph' 
                ? 'bg-primary text-foreground shadow-lg transform scale-[1.005]' 
                : 'bg-muted text-muted-foreground hover:bg-secondary/80 hover:transform hover:scale-[1.0025]'
            }`}
          >
            <Search className="size-3 sm:size-4" />
            <span className="hidden sm:inline">Wissenssuche</span>
            <span className="sm:hidden">Suche</span>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowChunkCombiner(true)}
            className="rounded-lg border border-border bg-card p-1.5 sm:p-2 text-foreground transition-colors hover:bg-secondary"
            title="Combine - Ähnliche Chunks zusammenführen"
          >
            <GitMerge className="size-4 sm:size-5" />
          </button>
          <button
            onClick={() => setShowMismatchFinder(true)}
            className="rounded-lg border border-border bg-card p-1.5 sm:p-2 text-foreground transition-colors hover:bg-secondary"
            title="Mismatch Finder - Widersprüchliche Informationen erkennen"
          >
            <GitCompare className="size-4 sm:size-5" />
          </button>
        </div>
      </div>
    );
  };
  
  // Komponente zum Anzeigen und Löschen eines Wissenseintrags
  function KnowledgeItemCard({ item, index = 0 }: { item: any; index?: number }) {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

    const handleDelete = () => {
      deleteKnowledgeItem(item.id)
      setShowDeleteConfirm(false)
    }

    const formattedDate = item.created_at
      ? format(new Date(item.created_at), 'dd.MM.yyyy, HH:mm', { locale: de })
      : 'Unbekannt'

    const isSelected = selectedItemIds.has(item.id)

    return (
      <div
        className={`mb-3 ml-1 rounded-lg border ${
          isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card'
        } p-3 sm:p-4 transition-all duration-300 ease-in-out hover:border-border hover:bg-muted hover:transform hover:scale-[1.005] ${
          isSelectMode ? 'cursor-default' : 'cursor-pointer'
        }`}
        onClick={() => {
          if (isSelectMode) {
            toggleItemSelection(item.id)
          } else {
            fetchChunkDetails(item)
          }
        }}
      >
        <div className="flex gap-2">
          {isSelectMode && (
            <div className="flex items-start pt-1">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleItemSelection(item.id)}
                className="mt-0.5 h-4 w-4 rounded border-border bg-background accent-black focus:ring-black focus:ring-offset-0"
                style={{ accentColor: 'black' }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          <div className="flex flex-1 flex-col gap-2">
            <div className="text-[10px] uppercase tracking-wide inline-flex w-fit items-center rounded px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30">
              {String((item as any).fact_type || 'fact')}
            </div>

            {item.question && (
              <p className="text-[11px] sm:text-xs text-muted-foreground mt-2 line-clamp-2">{item.question}</p>
            )}

            <p className="text-xs sm:text-sm text-foreground line-clamp-3">{item.content}</p>

            <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
              <div className="flex flex-wrap gap-1 sm:gap-2 text-xs text-muted-foreground">
                <span>Quelle: {item.source_name || 'Unbekannt'}</span>
                <span>•</span>
                <span>Erstellt: {formattedDate}</span>
              </div>

              <div className="flex gap-1 sm:gap-2 flex-shrink-0">
                {showDeleteConfirm ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowDeleteConfirm(false)
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-200 px-1"
                    >
                      <span className="hidden sm:inline">Abbrechen</span>
                      <span className="sm:hidden">×</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete()
                      }}
                      className="text-xs text-foreground hover:text-foreground/90 transition-colors duration-200 px-1"
                    >
                      <span className="hidden sm:inline">Bestätigen</span>
                      <span className="sm:hidden">✓</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowDeleteConfirm(true)
                    }}
                    className="text-foreground/40 hover:text-foreground transition-colors duration-200 p-1"
                    >
                    <Trash2 className="size-3 sm:size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Main Content - Responsive Layout mit dynamischer Positionierung */}
        <div className={`${
          selectedKnowledgeBaseId ? '' : 'justify-center items-center min-h-[60vh]'
        }`}>
          {/* Flexible Layout für unterschiedliche Panel-Höhen */}
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
            {/* Knowledge Base List - Angepasste Höhe je nach Inhalt */}
            <div className="lg:w-1/3 order-first lg:order-none">
              <div className="rounded-xl border border-white/10 p-4 sm:p-5 shadow-sm bg-background/50 backdrop-blur-sm">
                {/* ✅ NEU: Linkes Panel mit eigenem Info-Hover */}
                {isLeftInfoHovered ? (
                  <div className="flex flex-col">
                    {/* Header mit Info-Icon bleibt sichtbar */}
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-base sm:text-lg font-medium text-foreground">
                        <span className="hidden sm:inline">Meine Datenbanken</span>
                        <span className="sm:hidden">Datenbanken</span>
                      </h2>
                      <button 
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setIsLeftInfoHovered(!isLeftInfoHovered)}
                      >
                        <Info className="size-4" />
                      </button>
                    </div>
                    
                    {/* Erklärung */}
                    <div className="p-4">
                      <div className="max-w-sm space-y-3">
                        <div className="space-y-1 text-left">
                          <h3 className="text-lg font-bold text-foreground">Meine Datenbanken</h3>
                          <h4 className="text-sm font-medium text-primary">Wissensorganisation</h4>
                        </div>
                        
                        <div className="space-y-2 text-foreground text-xs leading-relaxed text-left">
                          <p>
                            Organisieren Sie Ihr Wissen in separaten Datenbanken für unterschiedliche Themen oder Projekte.
                          </p>
                          <p>
                            Jede Datenbank kann spezifische Dokumente, Informationen und Datenstrukturen enthalten.
                          </p>
                          <p>
                            Wählen Sie eine Datenbank aus, um mit der Verwaltung Ihrer Wissensinhalte zu beginnen.
                          </p>
                        </div>
                        
                        <div className="pt-2 border-t border-border text-left">
                          <p className="text-muted-foreground text-xs italic">
                            Erstellen Sie neue Datenbanken oder verwalten Sie bestehende.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col">
                      <div className="mb-4 flex items-center justify-between">
                        <h2 className="flex items-center gap-2 text-base sm:text-lg font-medium text-foreground">
                          <span className="hidden sm:inline">Meine Datenbanken</span>
                          <span className="sm:hidden">Datenbanken</span>
                        </h2>
                        <button 
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => setIsLeftInfoHovered(!isLeftInfoHovered)}
                        >
                          <Info className="size-4" />
                        </button>
                      </div>

                      {/* ✅ FIXED: Scrollbare Liste mit natürlicher Höhe */}
                      <div className="mb-4">
                        <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                          {user && (
                            <KnowledgeBaseList
                              userId={user.id}
                              selectedKnowledgeBaseId={selectedKnowledgeBaseId}
                              onSelectKnowledgeBase={handleSelectKnowledgeBase}
                              onKnowledgeBaseDeleted={handleKnowledgeBaseDeleted}
                              externalNewKb={triggerListUpdate}
                              onExternalNewKbProcessed={() => setTriggerListUpdate(null)}
                            />
                          )}
                        </div>
                      </div>
                      
                      {/* ✅ FIXED: Create Button am Ende */}
                      <div>
                        <button 
                          onClick={handleCreateNew}
                          className="w-full rounded-lg bg-primary px-4 py-3 text-foreground font-medium hover:bg-pink-600 transition-colors"
                        >
                          + Neue Datenbank
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Content Section - Flexible Höhe */}
            <div className="lg:flex-1 order-last lg:order-none">
              <div className="rounded-xl border border-white/10 p-4 sm:p-5 shadow-sm bg-background/50 backdrop-blur-sm">
                {/* ✅ NEU: Rechtes Panel mit eigenem Info-Hover */}
                {isRightInfoHovered ? (
                  <div className="h-full flex flex-col">
                    {/* Header mit Info-Icon bleibt sichtbar */}
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-lg font-medium text-foreground">
                        <PlusCircle className="size-5 text-primary" />
                        Dokumente in Wissensdatenbank hochladen
                      </h2>
                      <button 
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setIsRightInfoHovered(!isRightInfoHovered)}
                      >
                        <Info className="size-4" />
                      </button>
                    </div>
                    
                    {/* Erklärung */}
                    <div className="flex-1 flex flex-col justify-center p-6">
                      <div className="max-w-xl space-y-4">
                        <div className="space-y-2 text-left">
                          <h1 className="text-xl font-bold text-foreground">Dokumenten-Verwaltung</h1>
                          <h2 className="text-base font-semibold text-primary">Upload & Wissensverarbeitung</h2>
                        </div>
                        
                        <div className="space-y-3 text-foreground text-sm leading-relaxed text-left">
                          <p>
                            <strong>Dokument-Upload:</strong> Laden Sie PDFs, Word-Dokumente, Text-Dateien und andere Formate hoch.
                          </p>
                          <p>
                            <strong>Text-Upload:</strong> Fügen Sie direkt Textinhalte ein oder bearbeiten Sie bestehende Informationen.
                          </p>
                          <p>
                            <strong>Chunk-Verwaltung:</strong> Ihre Inhalte werden automatisch in durchsuchbare Abschnitte (Chunks) unterteilt.
                          </p>
                          <p>
                            <strong>Fakten-Extraktion:</strong> Die KI extrahiert wichtige Fakten und Informationen aus Ihren Dokumenten.
                          </p>
                        </div>
                        
                        <div className="pt-3 border-t border-border text-left">
                          <p className="text-muted-foreground text-xs italic">
                            Alle Ihre Inhalte werden intelligent strukturiert und für präzise KI-Abfragen optimiert.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Tab Navigation */}
                    {renderTabButtons()}
                    
                    {/* Tab Content */}
                    {/* ✅ AKTUALISIERT: Entferne alten isInfoHovered, verwende isRightInfoHovered */}
                    {activeTab === 'upload' && (
                      <div className="h-full flex flex-col">
                        <div className="mb-4 flex items-center justify-between">
                          <h2 className="flex items-center gap-2 text-lg font-medium text-foreground">
                            <PlusCircle className="size-5 text-primary" />
                            Dokumente in Wissensdatenbank hochladen
                          </h2>
                          <button 
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setIsRightInfoHovered(!isRightInfoHovered)}
                          >
                            <Info className="size-4" />
                          </button>
                        </div>
                      
                        <div className="flex-grow min-h-0 max-h-[calc(100vh-300px)] overflow-y-auto">
                          {selectedKnowledgeBaseId ? (
                            <KnowledgeItemUpload
                                userId={user.id}
                                knowledgeBaseId={selectedKnowledgeBaseId}
                                onUploadComplete={() => {
                                  // ✅ NEU: Refresh Wissenseinträge nach erfolgreichem Upload
                                  if (selectedKnowledgeBaseId) {
                                    fetchKnowledgeItems(selectedKnowledgeBaseId)
                                  }
                                }}
                                onCancel={() => {
                                  // Optionale Cancel-Logik
                                }}
                            />
                          ) : (
                            <div className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 ${
                              selectedKnowledgeBaseId ? 'min-h-[400px]' : 'min-h-[300px]'
                            }`}>
                              <DatabaseIcon className="mb-4 size-12 text-muted-foreground" />
                              <h3 className="mb-2 text-lg font-medium text-foreground">Keine Wissensdatenbank ausgewählt</h3>
                              <p className="mb-2 text-center text-muted-foreground">
                                Bitte wählen Sie links erst eine Wissensdatenbank aus,
                                bevor Sie Dokumente hochladen.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  
                    {activeTab === 'entries' && selectedKnowledgeBaseId && (
                          <div className="h-full flex flex-col">
                            {/* Filter-Komponente für Wissenseinträge */}
                            {knowledgeItems.length > 0 && (
                              <KnowledgeItemsFilter
                                searchQuery={searchQuery}
                                onSearchChange={handleSearchChange}
                                sourceFilter={sourceFilter}
                                onSourceFilterChange={handleSourceFilterChange}
                                dateFilter={dateFilter}
                                onDateFilterChange={handleDateFilterChange}
                                onClearAllFilters={handleClearAllFilters}
                                availableSources={availableSources}
                                filteredItemsCount={isSearchMode ? searchResults.length : filteredItems.length}
                                hasMoreItems={hasMoreItems}
                                totalItemsCount={isSearchMode ? searchPagination.total : totalItemsCount}
                                isSelectMode={isSelectMode}
                                onToggleSelectMode={toggleSelectMode}
                                selectedCount={selectedItemIds.size}
                                onSelectAll={selectAllItems}
                                onDeselectAll={deselectAllItems}
                                onBulkDelete={() => setShowBulkDeleteConfirm(true)}
                              />
                            )}
                            

                            
                            <div className="flex-grow">
                              {loadingItems && filteredItems.length === 0 && allItemsLoaded.length === 0 && searchResults.length === 0 ? (
                                <div className="flex justify-center py-8">
                                  <div className="size-6 animate-spin rounded-full border-2 border-pink-600 border-t-transparent"></div>
                                </div>
                              ) : (isSearchMode ? searchResults.length > 0 : (filteredItems.length > 0 || allItemsLoaded.length > 0)) ? (
                                <div className="max-h-[calc(100vh-450px)] overflow-y-auto pr-1 sm:pr-2 pb-3">
                                  <div className="space-y-3">
                                    {itemsToRender.map((item, index) => {
                                      const isLast = index === itemsToRender.length - 1
                                      const formattedDate = item.created_at
                                        ? format(new Date(item.created_at), 'dd.MM.yyyy, HH:mm', { locale: de })
                                        : 'Unbekannt'
                                      const isSelected = selectedItemIds.has(item.id)
                                      const isConfirming = confirmingItemId === item.id

                                      return (
                                        <div
                                          key={item.id}
                                          ref={isLast ? lastItemRef : undefined}
                                          className={`rounded-lg border ${
                                            isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card'
                                          } p-3 sm:p-4 transition-colors hover:border-border hover:bg-muted ${
                                            isSelectMode ? 'cursor-default' : 'cursor-pointer'
                                          }`}
                                          onClick={() => {
                                            if (isSelectMode) {
                                              toggleItemSelection(item.id)
                                            } else {
                                              fetchChunkDetails(item)
                                            }
                                          }}
                                        >
                                          <div className="flex gap-2">
                                            {isSelectMode && (
                                              <div className="flex items-start pt-1">
                                                <input
                                                  type="checkbox"
                                                  checked={isSelected}
                                                  onChange={() => toggleItemSelection(item.id)}
                                                  className="mt-0.5 h-4 w-4 rounded border-border bg-background accent-black focus:ring-black focus:ring-offset-0"
                                                  style={{ accentColor: 'black' }}
                                                  onClick={(e) => e.stopPropagation()}
                                                />
                                              </div>
                                            )}

                                            <div className="flex flex-1 flex-col gap-2">
                                              <div className="text-[10px] uppercase tracking-wide inline-flex w-fit items-center rounded px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30">
                                                {String((item as any).fact_type || 'fact')}
                                              </div>

                                              {item.question && (
                                                <p className="text-[11px] sm:text-xs text-muted-foreground mt-2 line-clamp-2">{item.question}</p>
                                              )}

                                              <p className="text-xs sm:text-sm text-foreground line-clamp-3">{item.content}</p>

                                              <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                                                <div className="flex flex-wrap gap-1 sm:gap-2 text-xs text-muted-foreground">
                                                  <span>Quelle: {item.source_name || 'Unbekannt'}</span>
                                                  <span>•</span>
                                                  <span>Erstellt: {formattedDate}</span>
                                                </div>

                                                <div className="flex gap-1 sm:gap-2 flex-shrink-0">
                                                  {isConfirming ? (
                                                    <>
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation()
                                                          setConfirmingItemId(null)
                                                        }}
                                                        className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
                                                      >
                                                        <span className="hidden sm:inline">Abbrechen</span>
                                                        <span className="sm:hidden">×</span>
                                                      </button>

                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation()
                                                          deleteKnowledgeItem(item.id)
                                                          setConfirmingItemId(null)
                                                        }}
                                                        className="text-xs text-foreground hover:text-foreground/90 transition-colors px-1"
                                                      >
                                                        <span className="hidden sm:inline">Bestätigen</span>
                                                        <span className="sm:hidden">✓</span>
                                                      </button>
                                                    </>
                                                  ) : (
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation()
                                                        setConfirmingItemId(item.id)
                                                      }}
                                                      className="text-foreground/40 hover:text-foreground transition-colors p-1"
                                                    >
                                                      <Trash2 className="size-3 sm:size-4" />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>

                                  {/* Loading More Indicator */}
                                  {(loadingMore || isSearching) && (
                                    <div className="flex justify-center py-2">
                                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <div className="size-4 animate-spin rounded-full border-2 border-pink-600 border-t-transparent"></div>
                                        {isSearchMode ? 'Lädt weitere Suchergebnisse...' : 'Lädt weitere Einträge...'}
                                      </div>
                                    </div>
                                  )}

                                  {/* No More Items Indicator */}
                                  {!loadingMore && !isSearching && (isSearchMode ? !searchPagination.hasMore : !hasMoreItems) && (
                                    <div className="flex justify-center py-4">
                                      <p className="text-xs text-muted-foreground">
                                        Keine weiteren Einträge gefunden
                                      </p>
                                    </div>
                                  )}
                                </div>
                              ) : (isSearchMode && searchQuery) || sourceFilter || dateFilter ? (
                                <div className="rounded-lg border border-dashed border-border bg-card p-4 sm:p-6 text-center">
                                  <p className="text-sm sm:text-base text-muted-foreground">
                                    Keine Wissenseinträge mit den aktuellen Filterkriterien gefunden.
                                  </p>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-dashed border-border bg-card p-4 sm:p-6 text-center">
                                  <p className="text-sm sm:text-base text-muted-foreground">
                                    Keine Wissenseinträge in dieser Datenbank gefunden.
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {activeTab === 'entries' && !selectedKnowledgeBaseId && (
                          <div className="flex items-center justify-center h-48 sm:h-64 px-4">
                            <p className="text-sm sm:text-base text-muted-foreground text-center">
                              Bitte wählen Sie <span className="sm:hidden">oben</span><span className="hidden sm:inline">links</span> eine Wissensdatenbank aus, um die Einträge anzuzeigen.
                            </p>
                          </div>
                        )}

                        {activeTab === 'graph' && selectedKnowledgeBaseId && (
                          <div className="h-full flex flex-col">
                            <div className="flex-grow h-[calc(100vh-360px)] min-h-[300px] max-h-[650px]">
                              <ChatInterface
                                knowledgeBaseId={selectedKnowledgeBaseId}
                                height="100%"
                                onOpenChunkDetails={fetchChunkDetails}
                              />
                            </div>
                          </div>
                        )}
                        
                        {activeTab === 'graph' && !selectedKnowledgeBaseId && (
                          <div className="flex items-center justify-center h-48 sm:h-64 px-4">
                            <p className="text-sm sm:text-base text-muted-foreground text-center">
                              Bitte wählen Sie <span className="sm:hidden">oben</span><span className="hidden sm:inline">links</span> eine Wissensdatenbank aus, um zu suchen.
                            </p>
                          </div>
                        )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ✅ NEU: Chunk-Details Modal */}
      <ChunkDetailsModal
        showChunkModal={showChunkModal}
        selectedItem={selectedItem}
        chunkDetails={chunkDetails}
        chunkFacts={chunkFacts}
        loadingChunkDetails={loadingChunkDetails}
        isEditingChunk={isEditingChunk}
        editedChunkContent={editedChunkContent}
        editingFactIds={editingFactIds}
        editedFacts={editedFacts}
        newFacts={newFacts}
        setEditedChunkContent={setEditedChunkContent}
        globalFacts={globalFacts}
        setGlobalFacts={setGlobalFacts}
        savingChanges={savingChanges}
        relatedChunks={relatedChunks}
        currentChunkIndex={currentChunkIndex}
                 loadingRelatedChunks={loadingRelatedChunks}
         isMarkdownFormatting={isMarkdownFormatting}
         isRegeneratingFacts={isRegeneratingFacts}
         onClose={handleCloseModal}
        onEditChunk={handleEditChunk}
        onChunkContentChange={handleChunkContentChange}
        onToggleFactEdit={handleToggleFactEdit}
        onFactContentChange={handleFactContentChange}
        onAddNewFact={handleAddNewFact}
        onRemoveNewFact={handleRemoveNewFact}
        onNewFactChange={handleNewFactChange}
        onSaveChanges={saveChunkChanges}
        onNavigateToChunk={onNavigateToChunk}
        onDeleteFact={handleDeleteFact}
                 onDeleteChunk={handleDeleteChunk}
         onMarkdownFormat={handleMarkdownFormat}
         onRegenerateFacts={handleRegenerateFacts}
         onShowHelp={() => setShowHelpModal(true)}
        headerSearchQuery={headerSearchQuery}
        headerSearchResults={headerSearchResults}
        showHeaderSearchResults={showHeaderSearchResults}
        onHeaderSearchChange={setHeaderSearchQuery}
        onShowHeaderSearchResults={setShowHeaderSearchResults}
        onHeaderSearchResultClick={(type, item) => {
          if (type === 'chunk') {
            const chunkIndex = relatedChunks.findIndex(c => c.id === item.id);
            if (chunkIndex !== -1) {
              // Wenn der Chunk nicht der aktuelle ist, wechsle zu ihm und scrolle dann
              if (chunkIndex !== currentChunkIndex) {
                onNavigateToChunk(chunkIndex);

                // Warte kurz, bis der Chunk gewechselt wurde, dann scrolle zum entsprechenden Chunk in der Liste
                setTimeout(() => {
                  const chunkElement = document.querySelector(`[data-chunk-item="${chunkIndex}"]`);
                  if (chunkElement) {
                    chunkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } else {
                    // Fallback: Scrolle zur Chunk-Liste
                    const chunkListElement = document.querySelector('[data-chunk-list]');
                    if (chunkListElement) {
                      chunkListElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }
                }, 300);
              } else {
                // Chunk ist bereits aktiv, scrolle direkt zum entsprechenden Chunk in der Liste
                const chunkElement = document.querySelector(`[data-chunk-item="${chunkIndex}"]`);
                if (chunkElement) {
                  chunkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                  // Fallback: Scrolle zur Chunk-Liste
                  const chunkListElement = document.querySelector('[data-chunk-list]');
                  if (chunkListElement) {
                    chunkListElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }
              }
            }
          } else if (type === 'fact') {
            // Finde den Chunk, zu dem dieser Fakt gehört
            const relatedChunkIndex = relatedChunks.findIndex(chunk =>
              chunk.id === item.source_chunk
            );

            // Wenn der Chunk gefunden wurde und nicht der aktuelle ist, wechsle zu ihm
            if (relatedChunkIndex !== -1 && relatedChunkIndex !== currentChunkIndex) {
              onNavigateToChunk(relatedChunkIndex);

              // Warte kurz, bis der Chunk gewechselt wurde, dann scrolle zum Fakt
              setTimeout(() => {
                const factElement = document.getElementById(`fact-${item.id}`);
                if (factElement) {
                  factElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 300);
            } else {
              // Fakt ist bereits im aktuellen Chunk, scrolle direkt hin
              const factElement = document.getElementById(`fact-${item.id}`);
              if (factElement) {
                factElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }
          }
          setShowHeaderSearchResults(false);
          setHeaderSearchQuery('');
        }}
        addToast={addToast}
        onShowCreateChunkModal={() => setShowCreateChunkModal(true)}
      />

      {/* ✅ NEU: Mismatch Finder Modal */}
      {selectedKnowledgeBaseId && (
        <>
          <MismatchFinder
            isOpen={showMismatchFinder}
            onClose={() => setShowMismatchFinder(false)}
            knowledgeBaseId={selectedKnowledgeBaseId}
            onConflictResolved={() => {
              // Reload knowledge items after conflict resolution
              fetchKnowledgeItems(selectedKnowledgeBaseId)
            }}
          />
          <ChunkCombiner
            isOpen={showChunkCombiner && !!selectedKnowledgeBaseId}
            onClose={() => setShowChunkCombiner(false)}
            knowledgeBaseId={selectedKnowledgeBaseId || ""}
            onCombined={() => {
              if (selectedKnowledgeBaseId) {
                fetchKnowledgeItems(selectedKnowledgeBaseId)
              }
            }}
            addToast={addToast}
          />
        </>
      )}

      {/* ✅ NEU: Upload Progress Indicator */}
      {isUploading && (
        <div className="fixed bottom-4 right-4 z-50 bg-background border border-border rounded-lg p-4 shadow-xl min-w-80">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="size-5 text-primary animate-spin" />
            <span className="text-foreground text-sm font-medium">Dokument wird hochgeladen...</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div 
              className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground mt-1">{uploadProgress}% abgeschlossen</div>
        </div>
      )}

      {/* ✅ NEU: Create Knowledge Base Modal */}
      <CreateKnowledgeBaseModal
        userId={user?.id || ''}
        isOpen={isCreateModalOpen}
        onClose={handleCreateModalClose}
        onKnowledgeBaseCreated={handleKnowledgeBaseCreated}
      />

      {/* ✅ NEU: KI-Summary Modal mit Side-by-Side Vergleich */}
      {showSummaryModal && aiSummaryResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-7xl h-full max-h-[90vh] rounded-xl border border-border bg-background shadow-xl flex flex-col">
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-medium text-foreground">
                  KI-Verkürzung - Vergleichsansicht
                </h3>
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-6" />
                </button>
              </div>

              <div className="flex gap-6 text-sm text-muted-foreground">
                <span>Original: {aiSummaryResult.originalLength} Zeichen</span>
                <span>Verkürzt: {aiSummaryResult.summaryLength} Zeichen</span>
                <span className="text-primary font-medium">
                  {Math.round((1 - aiSummaryResult.summaryLength / aiSummaryResult.originalLength) * 100)}% kürzer
                </span>
              </div>
            </div>

            <div className="flex-1 flex gap-6 p-6 min-h-0">
              {/* Original-Text */}
              <div className="flex-1 flex flex-col min-w-0">
                <h4 className="text-lg font-medium text-foreground mb-3 flex items-center gap-2">
                  📄 Original-Chunk
                  <span className="text-sm text-muted-foreground font-normal">({aiSummaryResult.originalLength} Zeichen)</span>
                </h4>
                <div className="flex-1 rounded border border-border bg-card p-4 overflow-y-auto">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {aiSummaryResult.originalText}
                  </p>
                </div>
              </div>

              {/* Trennlinie */}
              <div className="w-px bg-muted flex-shrink-0"></div>

              {/* Verkürzter Text */}
              <div className="flex-1 flex flex-col min-w-0">
                <h4 className="text-lg font-medium text-foreground mb-3 flex items-center gap-2">
                  🤖 KI-Verkürzung
                  <span className="text-sm text-muted-foreground font-normal">({aiSummaryResult.summaryLength} Zeichen)</span>
                </h4>
                <div className="flex-1 rounded border border-border bg-card p-4 overflow-y-auto">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {aiSummaryResult.summary}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-border">
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="px-6 py-2 text-sm rounded border border-border text-foreground hover:bg-secondary transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => {
                    if (aiSummaryResult) {
                      handleChunkContentChange(aiSummaryResult.summary);
                      handleEditChunk(true);
                      setShowSummaryModal(false);
                      setAiSummaryResult(null);
                      addToast('success', 'Chunk wurde erfolgreich verkürzt!');
                    }
                  }}
                  className="px-6 py-2 text-sm rounded bg-primary text-foreground hover:bg-pink-600 transition-colors font-medium"
                >
                  Verkürzung übernehmen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NEU: Hilfe Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-border bg-background shadow-xl">
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-medium text-foreground">
                  Hilfe & Anleitungen
                </h3>
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-6" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(100vh-400px)]">
              <div className="space-y-8">
                {/* Header Funktionen */}
                <div>
                  <h4 className="text-lg font-semibold text-foreground mb-4">
                    Header-Funktionen
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div className="p-3 rounded border border-border bg-card">
                      <div className="text-foreground font-medium">Export</div>
                      <div className="text-muted-foreground">Chunk als .txt-Datei herunterladen</div>
                    </div>
                    <div className="p-3 rounded border border-border bg-card">
                      <div className="text-foreground font-medium">E-Mail</div>
                      <div className="text-muted-foreground">Mailprogramm mit Chunk-Inhalt öffnen</div>
                    </div>
                    <div className="p-3 rounded border border-border bg-card">
                      <div className="text-foreground font-medium">Drucken</div>
                      <div className="text-muted-foreground">Chunk-Inhalt drucken</div>
                    </div>
                    <div className="p-3 rounded border border-border bg-card">
                      <div className="text-foreground font-medium">KI-Verkürzen</div>
                      <div className="text-muted-foreground">Text mit KI komprimieren</div>
                    </div>
                  </div>
                </div>

                {/* Bereiche */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Linke Seite */}
                  <div className="p-4 rounded border border-border bg-card">
                    <h5 className="text-foreground font-semibold mb-3">
                      Linke Seite - Chunk-Liste
                    </h5>
                    <p className="text-foreground text-sm leading-relaxed">
                      Zeigt alle verfügbaren Chunks aus dem Dokument. Klicken Sie einen Chunk an, um ihn zu öffnen und die Details anzuzeigen.
                    </p>
                  </div>

                  {/* Mitte */}
                  <div className="p-4 rounded border border-border bg-card">
                    <h5 className="text-foreground font-semibold mb-3">
                      Mitte - Chunk-Inhalt
                    </h5>
                    <p className="text-foreground text-sm leading-relaxed">
                      Hier wird der vollständige Text des ausgewählten Chunks angezeigt. Sie können den Inhalt bearbeiten, indem Sie auf "Bearbeiten" klicken.
                    </p>
                  </div>

                  {/* Rechte Seite */}
                  <div className="p-4 rounded border border-border bg-card">
                    <h5 className="text-foreground font-semibold mb-3">
                      Rechte Seite - Fakten
                    </h5>
                    <p className="text-foreground text-sm leading-relaxed">
                      Automatisch extrahierte Fakten aus dem Chunk-Inhalt. Diese können einzeln bearbeitet oder gelöscht werden. Neue Fakten können hinzugefügt werden.
                    </p>
                  </div>
                </div>

                {/* Statistiken */}
                <div className="p-4 rounded border border-border bg-card">
                  <h5 className="text-foreground font-semibold mb-3">
                    Aktuelle Chunk-Statistiken
                  </h5>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">{chunkDetails?.content?.length || 0}</div>
                      <div className="text-muted-foreground">Zeichen</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">
                        {chunkDetails?.content ? chunkDetails.content.trim().split(/\s+/).length : 0}
                      </div>
                      <div className="text-muted-foreground">Wörter</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">
                        {chunkDetails?.content ? Math.ceil(chunkDetails.content.trim().split(/\s+/).length * 1.33) : 0}
                      </div>
                      <div className="text-muted-foreground">Tokens</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">{chunkFacts.length}</div>
                      <div className="text-muted-foreground">Fakten</div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
                    <div>Erstellt: {chunkDetails?.created_at ? new Date(chunkDetails.created_at).toLocaleString('de-DE') : 'Unbekannt'}</div>
                    <div>Aktualisiert: {chunkDetails?.updated_at ? new Date(chunkDetails.updated_at).toLocaleString('de-DE') : 'Unbekannt'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-border">
              <div className="flex justify-end">
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="px-6 py-2 text-sm rounded bg-primary text-foreground hover:bg-pink-600 transition-colors font-medium"
                >
                  Verstanden
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NEU: Bulk-Delete Bestätigungsdialog */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md mx-4 rounded-xl border border-border bg-background shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20">
                  <Trash2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-foreground">
                    Wissenseinträge löschen
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Diese Aktion kann nicht rückgängig gemacht werden.
                  </p>
                </div>
              </div>
              
              <p className="text-sm text-foreground mb-6">
                Möchten Sie wirklich <span className="font-medium text-foreground">{selectedItemIds.size}</span> Wissenseinträge 
                {selectedItemIds.size === 1 ? '' : ''} permanent löschen?
              </p>
              
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowBulkDeleteConfirm(false)}
                  disabled={isDeletingBulk}
                  className="px-4 py-2 text-sm rounded-lg border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  Abbrechen
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={isDeletingBulk}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-foreground hover:bg-pink-600 transition-colors disabled:opacity-50"
                >
                  {isDeletingBulk ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Lösche...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      Löschen
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NEU: Chunk-Erstellungs-Modal */}
      {showCreateChunkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-background shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="text-lg font-semibold text-foreground">Neuen Chunk hinzufügen</h3>
              <button
                onClick={() => {
                  setShowCreateChunkModal(false);
                  setNewChunkContent('');
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              <div className="mb-2">
                <label className="text-sm text-muted-foreground mb-1 block">
                  Chunk-Inhalt
                </label>
                <textarea
                  value={newChunkContent}
                  onChange={(e) => setNewChunkContent(e.target.value)}
                  placeholder="Geben Sie den Inhalt für den neuen Chunk ein..."
                  className="w-full min-h-[200px] resize-y rounded border border-border bg-card p-3 text-sm text-foreground focus:border-border focus:outline-none"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Der neue Chunk wird dem aktuellen Dokument hinzugefügt.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border p-4">
              <button
                onClick={() => {
                  setShowCreateChunkModal(false);
                  setNewChunkContent('');
                }}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleCreateChunk}
                disabled={creatingChunk || !newChunkContent.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm text-foreground hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {creatingChunk ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Erstelle...
                  </>
                ) : (
                  <>
                    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Chunk erstellen
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
