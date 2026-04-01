"use client";

import {
  CheckCircle2,
  GitMerge,
  RefreshCcw,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnalysisBackground } from "./AnalysisBackground";
import { DialogToolbar } from "./DialogToolbar";

const CACHE_DURATION = 10 * 60 * 1000; // 10 Minuten Cache
const surfaceClass =
  "rounded-lg border border-border bg-card";

const CONFLICT_TYPE_LABELS: Record<string, string> = {
  price: "Preis",
  date: "Datum",
  number: "Zahl",
  factual: "Fakt",
  semantic: "Semantik",
  logical: "Logisch",
  general: "Allgemein",
};


interface MismatchFinderProps {
  isOpen: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  onConflictResolved: () => void;
}

interface ConflictGroup {
  id: string;
  topic: string;
  conflicts: KnowledgeConflict[];
  similarity: number;
}

interface KnowledgeConflict {
  id: string;
  content: string;
  source_name: string;
  created_at: string;
  confidence: number;
  conflictType:
    | "price"
    | "date"
    | "number"
    | "general"
    | "factual"
    | "semantic"
    | "logical";
  extractedValue?: string;
}

const renderMarkdown = (text: string): string => {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(
    /`([^`]+?)`/g,
    "<code class='bg-muted px-1 py-0.5 rounded text-[0.9em]'>$1</code>",
  );
  html = html.replace(/\n/g, "<br />");
  return html;
};

type AnalysisState = {
  totalEntries: number;
  conflictsFound: number;
  lastAnalysisISO: string | null;
};

type CachePayload = {
  timestamp: number;
  conflictGroups: ConflictGroup[];
  analysis: AnalysisState;
};

export const MismatchFinder: React.FC<MismatchFinderProps> = ({
  isOpen,
  onClose,
  knowledgeBaseId,
  onConflictResolved,
}) => {
  const [loading, setLoading] = useState(false);
  const [conflictGroups, setConflictGroups] = useState<ConflictGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ConflictGroup | null>(
    null,
  );
  const [resolving, setResolving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisState>({
    totalEntries: 0,
    conflictsFound: 0,
    lastAnalysisISO: null,
  });

  // Job / Progress
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [fakeProgress, setFakeProgress] = useState(0);

  const isBusy = loading || isProcessing;
  const isEmpty = !isBusy && conflictGroups.length === 0;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (!isBusy) {
      setFakeProgress(100);
      return;
    }

    // Ziel: in ~3 Minuten entspannt bis 99% laufen
    const startedAt = Date.now();
    const durationMs = 180_000;
    setFakeProgress(0);

    interval = setInterval(() => {
      const t = Date.now() - startedAt;
      const x = Math.min(1, t / durationMs);
      const eased = 1 - Math.pow(1 - x, 3); // easeOutCubic

      // sanfte Geschwindigkeitswellen (monoton durch prev-clamp)
      const wave = (Math.sin(t / 1200) + Math.sin(t / 2100)) * 0.35;
      const target = 99 * eased + wave;

      setFakeProgress((prev) => Math.min(99, Math.max(prev, target)));
    }, 200);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isBusy]);

  const CACHE_KEY = `mismatch_finder_cache_${knowledgeBaseId}`;

  const pollingAbortRef = useRef(false);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    pollingAbortRef.current = true;
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  }, []);

  const saveToCache = useCallback(
    (data: { conflictGroups: ConflictGroup[]; analysis: AnalysisState }) => {
      try {
        const cacheData: CachePayload = {
          timestamp: Date.now(),
          conflictGroups: data.conflictGroups,
          analysis: data.analysis,
        };
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      } catch (e) {
        console.warn("Fehler beim Speichern im Cache:", e);
      }
    },
    [CACHE_KEY],
  );

  const loadFromCache = useCallback((): boolean => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (!cached) return false;
      const parsed = JSON.parse(cached) as CachePayload;
      if (parsed?.timestamp && Date.now() - parsed.timestamp < CACHE_DURATION) {
        const groups = parsed.conflictGroups || [];
        setConflictGroups(groups);
        setAnalysis(
          parsed.analysis ?? {
            totalEntries: 0,
            conflictsFound: groups.length,
            lastAnalysisISO: null,
          },
        );
        if (groups.length > 0) setSelectedGroup(groups[0]);
        return true;
      }
      sessionStorage.removeItem(CACHE_KEY);
      return false;
    } catch (e) {
      return false;
    }
  }, [CACHE_KEY]);

  const applyCompletedResult = useCallback(
    (data: any) => {
      const mergedGroups: ConflictGroup[] = data.conflictGroups || [];
      const newAnalysis: AnalysisState = {
        totalEntries: data.totalEntries || 0,
        conflictsFound: mergedGroups.length,
        lastAnalysisISO: new Date().toISOString(),
      };
      setConflictGroups(mergedGroups);
      setAnalysis(newAnalysis);
      saveToCache({ conflictGroups: mergedGroups, analysis: newAnalysis });
      setSelectedGroup(mergedGroups.length > 0 ? mergedGroups[0] : null);
    },
    [saveToCache],
  );

  const startPolling = useCallback(
    async (jobId: string) => {
      stopPolling();
      pollingAbortRef.current = false;

      const poll = async (attempt: number) => {
        if (pollingAbortRef.current) return;
        try {
          const response = await fetch("/api/knowledge/find-mismatches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              knowledgeBaseId,
              batchId: jobId,
              continueProcessing: true,
            }),
          });
          if (!response.ok) throw new Error("Polling fehlgeschlagen");
          const data = await response.json();

          const nextProgress =
            typeof data.progress === "number"
              ? data.progress
              : data.isCompleted
                ? 100
                : progress;
          setProgress(Math.max(0, Math.min(100, nextProgress)));
          setIsProcessing(!data.isCompleted);
          setStatusMessage(
            data.isCompleted
              ? "Analyse abgeschlossen"
              : `Analyse läuft… (${Math.round(nextProgress)}%)`,
          );

          if (data.isCompleted) {
            applyCompletedResult(data);
            setIsProcessing(false);
            return;
          }

          // Backoff: 1.2s → 2.0s
          const delay = Math.min(2000, 1200 + attempt * 200);
          pollingTimeoutRef.current = setTimeout(
            () => poll(attempt + 1),
            delay,
          );
        } catch (e) {
          // Don’t spam errors; show once and stop polling
          setIsProcessing(false);
          setStatusMessage("");
          toast.error("Fehler beim Aktualisieren des Analyse-Status");
        }
      };

      setIsProcessing(true);
      setStatusMessage("Analyse läuft…");
      setProgress(0);
      void poll(0);
    },
    [applyCompletedResult, knowledgeBaseId, progress, stopPolling],
  );

  const findMismatches = useCallback(
    async (forceRefresh = false) => {
      stopPolling();
      if (!forceRefresh && loadFromCache()) return;

      setConflictGroups([]);
      setSelectedGroup(null);
      setLoading(true);
      setIsProcessing(true);
      setProgress(0);
      setStatusMessage("Analyse wird gestartet...");
      let startedPolling = false;

      try {
        const response = await fetch("/api/knowledge/find-mismatches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ knowledgeBaseId }),
        });

        if (!response.ok) throw new Error("Fehler beim Analysieren");

        const data = await response.json();

        if (data.isCompleted) {
          applyCompletedResult(data);
          setProgress(100);
          setStatusMessage("");
          setIsProcessing(false);
        } else if (
          (data.isProcessing || data.status === "processing") &&
          data.jobId
        ) {
          // Robust handling when backend returns a running job
          startedPolling = true;
          startPolling(data.jobId);
        } else if (data.jobId) {
          // Fallback: if we got a jobId without completion flag, poll it
          startedPolling = true;
          startPolling(data.jobId);
        } else {
          // Unknown response shape – stop the spinner
          setIsProcessing(false);
          setStatusMessage("");
        }
      } catch (error) {
        toast.error("Fehler bei der Konfliktanalyse");
        setIsProcessing(false);
        setStatusMessage("");
      } finally {
        setLoading(false);
        // isProcessing may stay true when polling continues
        if (!startedPolling) {
          setIsProcessing(false);
        }
      }
    },
    [
      applyCompletedResult,
      knowledgeBaseId,
      loadFromCache,
      startPolling,
      stopPolling,
    ],
  );

  const resolveConflict = async (
    keepItemId: string,
    removeItemIds: string[],
  ) => {
    setResolving(true);
    try {
      const response = await fetch("/api/knowledge/resolve-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepItemId, removeItemIds }),
      });

      if (!response.ok) throw new Error("Fehler beim Auflösen");

      toast.success("Konflikt erfolgreich gelöst");

      setConflictGroups((prev) => {
        const updated = prev.filter((g) => g.id !== selectedGroup?.id);
        if (updated.length > 0) setSelectedGroup(updated[0]);
        else setSelectedGroup(null);

        const newAnalysis = { ...analysis, conflictsFound: updated.length };
        saveToCache({ conflictGroups: updated, analysis: newAnalysis });
        return updated;
      });

      onConflictResolved();
    } catch (error) {
      toast.error("Konnte Konflikt nicht lösen");
    } finally {
      setResolving(false);
    }
  };

  // Initial Load
  useEffect(() => {
    if (isOpen && knowledgeBaseId) {
      pollingAbortRef.current = false;
      if (!loadFromCache()) void findMismatches();
    }
    if (!isOpen) {
      stopPolling();
      setLoading(false);
      setIsProcessing(false);
      setStatusMessage("");
    }
    return () => stopPolling();
  }, [findMismatches, isOpen, knowledgeBaseId, loadFromCache, stopPolling]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return conflictGroups;
    return conflictGroups.filter(
      (g) =>
        g.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.conflicts.some((c) =>
          c.content.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
    );
  }, [conflictGroups, searchQuery]);

  const quality = useMemo(() => {
    const total = Math.max(analysis.totalEntries, 1);
    const conflicts = Math.max(analysis.conflictsFound, 0);
    return Math.round((1 - conflicts / total) * 100);
  }, [analysis.conflictsFound, analysis.totalEntries]);

  const Sidebar = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="space-y-3 border-b border-border px-3 py-4">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Konflikte suchen…"
            className="h-9 w-full min-w-0 rounded-lg border border-border bg-muted pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-white/20 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{filteredGroups.length} Konflikte</span>
          <button
            type="button"
            onClick={() => void findMismatches(true)}
            disabled={loading || isProcessing}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            title="Neu analysieren"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", (loading || isProcessing) && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="space-y-2 p-3">
          {loading && conflictGroups.length === 0 ? (
            <div
              className={cn(
                surfaceClass,
                "px-2 py-4 text-center text-xs text-muted-foreground",
              )}
            >
              Lädt…
            </div>
          ) : filteredGroups.length === 0 ? (
            <div
              className={cn(
                surfaceClass,
                "px-4 py-6 text-center text-sm text-muted-foreground",
              )}
            >
              {isBusy ? (
                <>Bitte warten…</>
              ) : (
                <>
                  Keine Konflikte gefunden.
                  <br />
                  Alles sieht gut aus.
                </>
              )}
            </div>
          ) : (
            <div className="flex w-full max-w-full flex-col gap-3">
              {filteredGroups.map((group) => {
                const isActive = selectedGroup?.id === group.id;
                const conflictType =
                  group.conflicts[0]?.conflictType || "general";
                const typeLabel = CONFLICT_TYPE_LABELS[conflictType] ?? CONFLICT_TYPE_LABELS.general;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setSelectedGroup(group)}
                    className={cn(
                      "group flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-lg border p-3 text-left transition-all duration-300 ease-in-out hover:bg-muted",
                      isActive
                        ? "border-white/20 bg-white/[0.035]"
                        : "border-border bg-card",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30">
                        {typeLabel}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {group.conflicts.length} Varianten
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-foreground line-clamp-2" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                      {group.topic}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const Details = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{analysis.totalEntries} Einträge geprüft</span>
          <span>•</span>
          <span>{analysis.conflictsFound} Konflikte</span>
          <span>•</span>
          <span>Qualität {quality}%</span>
        </div>
      </div>
      {selectedGroup ? (
        <>
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 py-5">
              {selectedGroup.conflicts.map((conflict, idx) => (
                <React.Fragment key={conflict.id}>
                  {/* VS divider between cards */}
                  {idx > 0 && (
                    <div className="flex items-center gap-3 py-3">
                      <div className="h-px flex-1 bg-border" />
                      <span className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-bold tracking-[0.18em] text-muted-foreground">
                        VS
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}

                  <div className="rounded-lg border border-border bg-card p-3 sm:p-4 transition-all duration-300 ease-in-out hover:bg-muted">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30">
                          Variante {idx + 1}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                          <span>{conflict.content.length} Zeichen</span>
                          <span className="text-border">·</span>
                          <span>{Math.round(conflict.confidence * 100)}%</span>
                        </div>
                      </div>

                      <div
                        className="text-xs sm:text-sm text-foreground line-clamp-6 [&_strong]:font-medium"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(conflict.content),
                        }}
                      />

                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        <span>Quelle: {conflict.source_name}</span>
                      </div>

                      <div className="flex gap-2 pt-2 sm:justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const remaining = selectedGroup.conflicts.filter(
                              (c) => c.id !== conflict.id,
                            );
                            if (remaining.length > 0) {
                              void resolveConflict(remaining[0].id, [
                                conflict.id,
                              ]);
                            }
                          }}
                          disabled={
                            resolving || selectedGroup.conflicts.length <= 1
                          }
                          className="gap-2 text-foreground/40 hover:text-foreground hover:bg-muted"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Verwerfen
                        </Button>

                        <Button
                          size="sm"
                          onClick={() => {
                            const others = selectedGroup.conflicts.filter(
                              (c) => c.id !== conflict.id,
                            );
                            void resolveConflict(
                              conflict.id,
                              others.map((c) => c.id),
                            );
                          }}
                          disabled={resolving}
                          className="gap-2 bg-primary text-white hover:bg-primary/90"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Behalten
                        </Button>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </ScrollArea>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          {isBusy ? null : isEmpty ? (
            <>
              <CheckCircle2 className="h-10 w-10 opacity-30" />
              <div>Keine Konflikte gefunden.</div>
            </>
          ) : (
            <>
              <GitMerge className="h-10 w-10 opacity-30" />
              <div>Wählen Sie links einen Konflikt aus.</div>
            </>
          )}
        </div>
      )}
    </div>
  );

  const FullEmptyState = (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-8 text-center">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <div className="relative flex h-full w-full items-center justify-center rounded-full bg-muted ring-1 ring-border">
            <CheckCircle2 className="h-9 w-9 text-muted-foreground/40" />
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold tracking-tight text-foreground">
            Keine Konflikte gefunden
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ihre Wissensdatenbank sieht konsistent aus.
          </p>
        </div>
        <Button variant="outline" onClick={() => void findMismatches(true)} className="border-border bg-card hover:bg-muted">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Neu analysieren
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="!flex h-[82vh] max-h-[82vh] w-[90vw] max-w-[84rem] !flex-col !gap-0 overflow-hidden !rounded-xl !border-border !bg-card !p-0 !top-[47%]"
        style={{ width: "90vw", maxWidth: "84rem" }}
      >
        <div className="relative flex h-full flex-col">
          {isBusy ? (
            <div className="absolute inset-0 z-50 flex flex-col bg-card">
              <div className="h-1.5 w-full overflow-hidden rounded-t-xl bg-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary via-[#ff66d5] to-[#ff4ac6] transition-all duration-500 ease-in-out"
                  style={{ width: `${fakeProgress}%` }}
                />
              </div>

              <AnalysisBackground />

              <div className="relative z-10 flex flex-1 flex-col items-center justify-center">
                <div className="flex max-w-sm flex-col items-center gap-8 text-center">
                  {/* Icon with pulse rings */}
                  <div className="relative flex h-20 w-20 items-center justify-center">
                    <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" />
                    <span className="absolute inset-2 animate-ping rounded-full bg-primary/10 [animation-delay:300ms]" />
                    <div className="relative flex h-full w-full items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/25">
                      <ShieldAlert className="h-9 w-9 text-primary" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {statusMessage || "Analyse wird gestartet..."}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Embeddings werden verglichen,
                      <br />
                      Widersprüche werden identifiziert.
                    </p>
                  </div>

                  {/* Scanning dots */}
                  <div className="flex items-center gap-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="h-1 w-1 rounded-full bg-primary/60 animate-bounce"
                        style={{ animationDelay: `${i * 120}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <DialogHeader className="sr-only">
            <DialogTitle>Daten-Widersprüche</DialogTitle>
            <DialogDescription>Widersprüchliche Informationen finden und beheben</DialogDescription>
          </DialogHeader>

          <DialogToolbar
            title="Daten-Widersprüche"
            helpTitle="Mismatch-Finder"
            helpSubtitle="Widersprüchliche Informationen erkennen"
            helpContent={
              <>
                <p>Der Mismatch-Finder vergleicht alle Einträge Ihrer Wissensdatenbank und identifiziert widersprüchliche Informationen — z.B. unterschiedliche Preise, Daten oder Fakten zum selben Thema.</p>
                <p>Wählen Sie links einen Konflikt aus und entscheiden Sie rechts, welche Variante Sie behalten möchten.</p>
              </>
            }
            onClose={onClose}
          />

          {isEmpty ? (
            FullEmptyState
          ) : (
            <>
              {/* Desktop layout */}
              <div className="hidden flex-1 min-h-0 grid-cols-[420px_1fr] divide-x divide-border overflow-hidden md:grid">
                <div className="min-h-0 min-w-0 overflow-hidden">
                  <div className="h-full w-full overflow-hidden pl-5 pr-4 pt-3 pb-4">{Sidebar}</div>
                </div>
                <div className="min-w-0 min-h-0">{Details}</div>
              </div>

              {/* Mobile layout */}
              <div className="flex flex-1 flex-col md:hidden">
                <Tabs defaultValue="list" className="flex h-full flex-col">
                  <div className="border-b border-border px-4 py-3">
                    <TabsList className="grid w-full grid-cols-2 rounded-lg border border-border bg-muted p-1">
                      <TabsTrigger
                        value="list"
                        className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-white"
                      >
                        Konflikte
                      </TabsTrigger>
                      <TabsTrigger
                        value="details"
                        disabled={!selectedGroup}
                        className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-white"
                      >
                        Details
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent
                    value="list"
                    className="flex-1 overflow-hidden p-0"
                  >
                    <div className="h-full px-4 pt-2 pb-4">{Sidebar}</div>
                  </TabsContent>
                  <TabsContent
                    value="details"
                    className="flex-1 overflow-hidden p-0"
                  >
                    {Details}
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}

          <DialogFooter className="border-t border-border px-7 py-4">
            <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
              <span>
                {analysis.totalEntries > 0
                  ? `${analysis.totalEntries} Einträge geprüft`
                  : "Bereit"}
              </span>
              <span>
                {analysis.lastAnalysisISO
                  ? `Letzte Analyse: ${new Date(analysis.lastAnalysisISO).toLocaleString("de-DE")}`
                  : ""}
              </span>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
