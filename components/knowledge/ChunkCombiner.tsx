"use client";

import { CheckCircle2, FileStack, GitMerge, Layers, Loader2, RefreshCcw, Search, Sparkles } from "lucide-react";
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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnalysisBackground } from "./AnalysisBackground";
import { DialogToolbar } from "./DialogToolbar";

const CACHE_DURATION = 10 * 60 * 1000;

const surfaceClass =
  "rounded-lg border border-border bg-card";

interface CombineSuggestionNode {
  nodeId: string;
  chunkId: string | null;
  type: "document" | "text";
  sourceName: string;
  documentId: string | null;
  documentTitle?: string | null;
  knowledgeItemCount: number;
  knowledgeItemIds: string[];
  contentPreview: string;
  contentFull?: string;
  contentLength: number;
  createdAt: string | null;
  isPrimary: boolean;
}

interface CombineSuggestion {
  id: string;
  topic: string;
  summary: string;
  similarityScore: number;
  newChunkPreview: string;
  nodes: CombineSuggestionNode[];
}

interface ChunkCombinerProps {
  isOpen: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  onCombined: () => void;
  addToast: (type: any, message: string) => void; // Legacy support, we prefer sonner
}

const renderMarkdown = (text: string): string => {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\n/g, "<br />");
  return html;
};

export const ChunkCombiner: React.FC<ChunkCombinerProps> = ({
  isOpen,
  onClose,
  knowledgeBaseId,
  onCombined,
}) => {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<CombineSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] =
    useState<CombineSuggestion | null>(null);
  const [merging, setMerging] = useState(false);
  // State to track which nodes are included in the merge (by nodeId)
  const [includedNodes, setIncludedNodes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [fakeProgress, setFakeProgress] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (!loading) {
      setFakeProgress(100);
      return;
    }

    const startedAt = Date.now();
    const durationMs = 180_000;
    setFakeProgress(0);

    interval = setInterval(() => {
      const t = Date.now() - startedAt;
      const x = Math.min(1, t / durationMs);
      const eased = 1 - Math.pow(1 - x, 3); // easeOutCubic
      const wave = (Math.sin(t / 1200) + Math.sin(t / 2100)) * 0.35;
      const target = 99 * eased + wave;
      setFakeProgress((prev) => Math.min(99, Math.max(prev, target)));
    }, 200);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading]);

  const CACHE_KEY = `chunk_combiner_cache_${knowledgeBaseId}`;

  const handleSelectSuggestion = useCallback(
    (suggestion: CombineSuggestion) => {
      setSelectedSuggestion(suggestion);
      // By default, include all nodes (and always include primary)
      const primary = suggestion.nodes.find((n) => n.isPrimary);
      const next = new Set(suggestion.nodes.map((n) => n.nodeId));
      if (primary) next.add(primary.nodeId);
      setIncludedNodes(next);
    },
    [],
  );

  const saveToCache = useCallback(
    (data: { suggestions: CombineSuggestion[] }) => {
      try {
        const cacheData = {
          timestamp: Date.now(),
          suggestions: data.suggestions,
        };
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      } catch (e) {
        console.warn(e);
      }
    },
    [CACHE_KEY],
  );

  const loadFromCache = useCallback((): boolean => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (!cached) return false;
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_DURATION) {
        setSuggestions(parsed.suggestions || []);
        if (parsed.suggestions?.length > 0)
          handleSelectSuggestion(parsed.suggestions[0]);
        return true;
      }
      sessionStorage.removeItem(CACHE_KEY);
      return false;
    } catch (e) {
      return false;
    }
  }, [CACHE_KEY, handleSelectSuggestion]);

  const loadSuggestions = useCallback(
    async (forceRefresh = false) => {
      if (!forceRefresh && loadFromCache()) return;

      setLoading(true);
      try {
        const response = await fetch("/api/knowledge/combine-suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ knowledgeBaseId }),
        });

        if (!response.ok) throw new Error("Fehler beim Laden");

        const data = await response.json();
        setSuggestions(data.suggestions || []);
        saveToCache({ suggestions: data.suggestions || [] });

        if (data.suggestions?.length > 0) {
          handleSelectSuggestion(data.suggestions[0]);
        } else {
          setSelectedSuggestion(null);
        }
      } catch (error) {
        toast.error("Konnte Vorschläge nicht laden");
      } finally {
        setLoading(false);
      }
    },
    [handleSelectSuggestion, knowledgeBaseId, loadFromCache, saveToCache],
  );

  useEffect(() => {
    if (isOpen && knowledgeBaseId) {
      if (!loadFromCache()) loadSuggestions(true);
    }
    if (!isOpen) {
      setLoading(false);
      setMerging(false);
    }
  }, [isOpen, knowledgeBaseId, loadFromCache, loadSuggestions]);

  const toggleNodeInclusion = (nodeId: string) => {
    setIncludedNodes((prev) => {
      const next = new Set(prev);
      const isPrimary = selectedSuggestion?.nodes.some(
        (n) => n.nodeId === nodeId && n.isPrimary,
      );
      if (isPrimary) return next; // primary must stay included
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const handleCombine = async () => {
    if (!selectedSuggestion) return;

    const primaryNode =
      selectedSuggestion.nodes.find((n) => n.isPrimary) ||
      selectedSuggestion.nodes[0];
    const nodesToMerge = selectedSuggestion.nodes.filter(
      (n) => includedNodes.has(n.nodeId) || n.nodeId === primaryNode?.nodeId,
    );

    if (!primaryNode?.chunkId) {
      toast.error("Kein Haupt-Chunk ausgewählt");
      return;
    }

    if (nodesToMerge.length < 2) {
      toast.warning("Bitte wählen Sie mindestens 2 Chunks zum Kombinieren");
      return;
    }

    setMerging(true);
    try {
      const chunkIdsToMerge = nodesToMerge
        .filter(
          (n) =>
            n.nodeId !== primaryNode.nodeId &&
            n.type === "document" &&
            n.chunkId,
        )
        .map((n) => n.chunkId as string);

      const manualKnowledgeItemIds = nodesToMerge
        .filter((n) => n.type !== "document")
        .flatMap((n) => n.knowledgeItemIds);

      const response = await fetch("/api/knowledge/combine-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledgeBaseId,
          primaryChunkId: primaryNode.chunkId,
          chunkIdsToMerge,
          manualKnowledgeItemIds,
        }),
      });

      if (!response.ok) throw new Error("Fehler beim Kombinieren");

      toast.success("Chunks erfolgreich kombiniert");

      // Update local state
      const nextSuggestions = suggestions.filter(
        (s) => s.id !== selectedSuggestion.id,
      );
      setSuggestions(nextSuggestions);
      saveToCache({ suggestions: nextSuggestions });

      if (nextSuggestions.length > 0)
        handleSelectSuggestion(nextSuggestions[0]);
      else setSelectedSuggestion(null);

      onCombined();
    } catch (error) {
      toast.error("Fehler beim Kombinieren");
    } finally {
      setMerging(false);
    }
  };

  const filteredSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter(
      (s) =>
        s.topic.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.nodes.some((n) => n.sourceName.toLowerCase().includes(q)),
    );
  }, [searchQuery, suggestions]);

  const selectedNodes = useMemo(() => {
    if (!selectedSuggestion) return [];
    return selectedSuggestion.nodes.filter((n) => includedNodes.has(n.nodeId));
  }, [includedNodes, selectedSuggestion]);

  const selectedSourcesLabel = useMemo(() => {
    if (!selectedSuggestion) return "";
    const names = selectedNodes.map((n) => n.sourceName).filter(Boolean);
    if (names.length <= 2) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} (+${names.length - 2})`;
  }, [selectedNodes, selectedSuggestion]);

  const Sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-border px-3 py-4">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Vorschläge suchen…"
            className="h-9 w-full min-w-0 rounded-lg border border-border bg-muted pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-white/20 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{filteredSuggestions.length} Vorschläge</span>
          <button
            type="button"
            onClick={() => void loadSuggestions(true)}
            disabled={loading}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            title="Neu analysieren"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="space-y-2 p-3">
          {filteredSuggestions.length === 0 ? (
            <div
              className={cn(
                surfaceClass,
                "px-4 py-10 text-center text-sm text-muted-foreground",
              )}
            >
              Keine Redundanzen gefunden.
              <br />
              Ihre Datenbank wirkt sauber konsolidiert.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredSuggestions.map((suggestion) => {
                const isActive = selectedSuggestion?.id === suggestion.id;
                const pct = Math.round(suggestion.similarityScore * 100);
                return (
                  <button
                    key={suggestion.id}
                    type="button"
                    onClick={() => handleSelectSuggestion(suggestion)}
                    className={cn(
                      "group flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-lg border p-3 text-left transition-all duration-300 ease-in-out hover:bg-muted",
                      isActive
                        ? "border-white/20 bg-white/[0.035]"
                        : "border-border bg-card",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30">
                        {suggestion.nodes.length} Chunks
                      </span>
                      <span className="text-xs text-muted-foreground">{pct}%</span>
                    </div>

                    <p className="text-xs sm:text-sm text-foreground line-clamp-2" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                      {suggestion.topic}
                    </p>

                    <p className="text-[11px] text-muted-foreground line-clamp-2">
                      {suggestion.summary}
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

  const PreviewPane = (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 px-6 py-5">
          {selectedSuggestion?.newChunkPreview ? (
            <div className="pb-3 mb-3 border-b border-border">
              <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30">
                Ergebnis-Vorschau
              </span>
              <p className="mt-2 text-xs sm:text-sm text-foreground line-clamp-4">
                {selectedSuggestion.newChunkPreview}
              </p>
            </div>
          ) : null}

          {selectedSuggestion ? (
            <div className="space-y-3">
              {selectedSuggestion.nodes.map((node, idx) => {
                const isIncluded = includedNodes.has(node.nodeId);
                const content = isIncluded
                  ? node.contentFull || node.contentPreview
                  : node.contentPreview;
                return (
                  <div
                    key={node.nodeId}
                    className={cn(
                      "rounded-lg border border-border bg-card p-3 sm:p-4 transition-all duration-300 ease-in-out hover:bg-muted",
                      !isIncluded && "opacity-50",
                    )}
                  >
                    <div className="flex gap-2">
                      <div className="flex items-start pt-1">
                        {node.isPrimary ? (
                          <div className="flex h-4 w-4 items-center justify-center rounded bg-primary">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-2.5 text-background">
                              <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v4A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 11.5 7V4.5A3.5 3.5 0 0 0 8 1ZM6 4.5a2 2 0 1 1 4 0V7H6V4.5Z" clipRule="evenodd" />
                            </svg>
                          </div>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            onChange={() => toggleNodeInclusion(node.nodeId)}
                            className="h-4 w-4 rounded border-border bg-card accent-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                            style={{ accentColor: '#ff55c9', colorScheme: 'dark' }}
                          />
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-2">
                        <div className="flex flex-wrap gap-1">
                          {node.isPrimary && (
                            <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30">
                              Haupt-Chunk
                            </span>
                          )}
                          <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30">
                            {node.type === "document" ? "Dokument" : "Text"}
                          </span>
                        </div>

                        <p className="text-xs sm:text-sm text-foreground font-medium truncate" title={node.sourceName}>
                          {node.sourceName}
                        </p>

                        <div
                          className={cn(
                            "text-xs sm:text-sm text-foreground line-clamp-3",
                            !isIncluded && "text-muted-foreground",
                          )}
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(content),
                          }}
                        />

                        <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                          <span>Quelle: {node.sourceName}</span>
                          {node.contentLength ? (
                            <>
                              <span>•</span>
                              <span>{node.contentLength} Zeichen</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className={cn(surfaceClass, "p-6 text-sm text-muted-foreground")}
            >
              Wählen Sie zuerst einen Vorschlag aus.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  const isEmpty = !loading && suggestions.length === 0;

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
            Keine Redundanzen gefunden
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ihre Wissensdatenbank wirkt sauber konsolidiert.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadSuggestions(true)} className="border-border bg-card hover:bg-muted">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Neu analysieren
        </Button>
      </div>
    </div>
  );

  const DetailsDesktop = PreviewPane;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="!flex h-[82vh] max-h-[82vh] w-[90vw] max-w-[84rem] !flex-col !gap-0 overflow-hidden !rounded-xl !border-border !bg-card !p-0 !top-[47%]"
        style={{ width: "90vw", maxWidth: "84rem" }}
      >
        <div className="relative flex h-full flex-col">
          {loading ? (
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
                  {/* Icon with merge animation feel */}
                  <div className="relative flex h-20 w-20 items-center justify-center">
                    <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" />
                    <span className="absolute inset-2 animate-ping rounded-full bg-primary/10 [animation-delay:250ms]" />
                    <div className="relative flex h-full w-full items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/25">
                      <GitMerge className="h-9 w-9 text-primary" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      Chunks werden analysiert
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Ähnliche Inhalte werden gruppiert
                      <br />
                      und Zusammenführungsvorschläge vorbereitet.
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
            <DialogTitle>Wissen konsolidieren</DialogTitle>
            <DialogDescription>Ähnliche Chunks zusammenführen</DialogDescription>
          </DialogHeader>

          <DialogToolbar
            title="Wissen konsolidieren"
            helpTitle="Chunk-Kombinierer"
            helpSubtitle="Redundanzen erkennen & zusammenführen"
            helpContent={
              <>
                <p>Der Kombinierer analysiert Ihre Wissensdatenbank auf inhaltlich ähnliche Chunks und schlägt vor, diese zusammenzuführen.</p>
                <p>Wählen Sie links einen Vorschlag aus, prüfen Sie die Quellen rechts und entscheiden Sie, welche Chunks kombiniert werden sollen.</p>
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
                <div className="min-h-0 overflow-hidden">
                  <div className="h-full pl-5 pr-4 pt-3 pb-4">{Sidebar}</div>
                </div>
                <div className="min-w-0 min-h-0 h-full overflow-hidden">
                  {selectedSuggestion ? (
                    DetailsDesktop
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
                      <Layers className="h-10 w-10 opacity-30" />
                      <div>Wählen Sie links einen Vorschlag aus.</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile layout */}
              <div className="flex flex-1 flex-col md:hidden">
                <Tabs defaultValue="suggestions" className="flex h-full flex-col">
                  <div className="border-b border-border px-4 py-3">
                    <TabsList className="grid w-full grid-cols-2 rounded-lg border border-border bg-muted p-1">
                      <TabsTrigger
                        value="suggestions"
                        className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-white"
                      >
                        Vorschläge
                      </TabsTrigger>
                      <TabsTrigger
                        value="preview"
                        disabled={!selectedSuggestion}
                        className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-white"
                      >
                        Vorschau
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent
                    value="suggestions"
                    className="!mt-0 flex-1 min-h-0 overflow-hidden p-0"
                  >
                    <div className="h-full px-4 pt-2 pb-4">{Sidebar}</div>
                  </TabsContent>
                  <TabsContent
                    value="preview"
                    className="!mt-0 flex-1 min-h-0 overflow-hidden p-0"
                  >
                    {selectedSuggestion ? (
                      PreviewPane
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                        <Layers className="h-10 w-10 opacity-30" />
                        <div>Wählen Sie zuerst einen Vorschlag aus.</div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}

          <DialogFooter className="border-t border-border px-7 py-4">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">
                {selectedSuggestion
                  ? `Ausgewählt: ${includedNodes.size} von ${selectedSuggestion.nodes.length}${selectedSourcesLabel ? ` — ${selectedSourcesLabel}` : ""}`
                  : `${suggestions.length} Vorschläge`}
              </div>
              <Button
                onClick={handleCombine}
                disabled={
                  !selectedSuggestion || merging || includedNodes.size < 2
                }
                className="w-full rounded-lg bg-primary text-white hover:bg-primary/90 sm:w-auto"
              >
                {merging ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Kombiniere…
                  </>
                ) : (
                  <>
                    <GitMerge className="mr-2 h-4 w-4" />
                    Kombinieren
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
