"use client"

import React, { useState, useEffect, useRef } from "react"
import { getSupabaseClient } from "@/lib/supabase-browser"
import { Database } from "@/supabase/types"
import { Book, X, DatabaseIcon, ChevronDown } from "lucide-react"

// Define KnowledgeBase type generically since it's not in the Database type
type KnowledgeBase = {
  id: string
  name: string
  user_id: string
  created_at?: string
  updated_at?: string | null
  description?: string | null
  [key: string]: any // For any other properties
}

// Extended type with access information
type KnowledgeBaseWithAccess = KnowledgeBase & {
  hasAccess: boolean
}

interface KnowledgeBaseSelectorProps {
  userId: string
  selectedKnowledgeBaseId: string[] | null
  onSelectKnowledgeBase: (ids: string[] | null) => void
  isCompact?: boolean
}

export const KnowledgeBaseSelector: React.FC<KnowledgeBaseSelectorProps> = ({
  userId,
  selectedKnowledgeBaseId,
  onSelectKnowledgeBase,
  isCompact = false
}) => {
  // // console.log("🔄 KBSelector: Component rendering with userId:", userId); // REMOVE
  
  // Stable supabase client reference
  const supabaseRef = useRef(getSupabaseClient());
  const supabase = supabaseRef.current;
  
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseWithAccess[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState<boolean>(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // // console.log("🧪 DIRECT TEST: About to manually fetch knowledge bases"); // REMOVE

  // Fetch knowledge bases function
    const fetchKnowledgeBases = async () => {
    // // console.log("🔍 KBSelector: Starting to fetch knowledge bases (including shared) for userId:", userId); // REMOVE
    
    if (!userId) {
      // // console.log("❌ KBSelector: No userId provided, aborting fetch"); // REMOVE
      setLoading(false); // Ensure loading stops if no user ID
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // ✅ COMPANY SHARING: RLS filtert automatisch nach company_id
      // Alle KBs der Company werden zurückgegeben, kein manueller Filter nötig
      const { data: allKBs, error: kbError } = await supabase
          .from("knowledge_bases")
          .select("*")
        .order("name", { ascending: true });

      if (kbError) {
        // RLS-Fehler behandeln
        if (kbError.code === '42501' || kbError.message?.includes('permission denied')) {
          throw new Error("Keine Berechtigung. Prüfen Sie, ob Ihre Company korrekt zugewiesen ist.");
        }
        throw kbError;
      }
      
      if (!allKBs || allKBs.length === 0) {
          setKnowledgeBases([]);
          setLoading(false);
          return;
      }

      // ✅ COMPANY SHARING: Gruppen-basierter Zugriff für feinere Kontrolle innerhalb der Company
      // RLS filtert bereits auf company_id, hier prüfen wir zusätzlich Gruppen-Zugehörigkeit
      const { data: groupMembers, error: groupMembersError } = await supabase
        .from("knowledge_group_members")
        .select("group_id")
        .eq("user_id", userId);

      if (groupMembersError) {
        // Bei Gruppenfehler: Alle KBs als zugänglich markieren (RLS hat bereits gefiltert)
        console.warn("Konnte Gruppenzugehörigkeit nicht laden, zeige alle Company-KBs:", groupMembersError);
        setKnowledgeBases(allKBs.map(kb => ({ ...kb, hasAccess: true })));
        setLoading(false);
        return;
      }

      const userGroupIds = groupMembers?.map(member => member.group_id) || [];

      if (userGroupIds.length === 0) {
          // User ist in keiner Gruppe - zeige alle Company-KBs als zugänglich (RLS-basiert)
          setKnowledgeBases(allKBs.map(kb => ({ ...kb, hasAccess: true })));
          setLoading(false);
          return;
      }

      // 3. Fetch which knowledge bases are linked to the user's groups
      const { data: accessibleKBsLinks, error: accessibleError } = await supabase
        .from("knowledge_base_groups")
        .select("knowledge_base_id")
        .in("group_id", userGroupIds);

      if (accessibleError) {
        // Bei Fehler: Alle KBs als zugänglich markieren
        console.warn("Konnte KB-Gruppen-Links nicht laden:", accessibleError);
        setKnowledgeBases(allKBs.map(kb => ({ ...kb, hasAccess: true })));
        setLoading(false);
        return;
      }

      const accessibleKbIds = new Set(accessibleKBsLinks?.map(link => link.knowledge_base_id) || []);

      // 4. Combine the data: Mark each KB with access status
      // Wenn keine KB-Gruppen-Links existieren, haben alle Zugriff (Company-weiter Zugriff)
      const kbsWithAccess = allKBs.map(kb => ({
        ...kb,
        hasAccess: accessibleKbIds.size === 0 || accessibleKbIds.has(kb.id)
      }));

      setKnowledgeBases(kbsWithAccess);
      
    } catch (err: any) {
      // // console.error("❌ KBSelector: Error during fetchKnowledgeBases execution:", err); // REMOVE
      // More specific error message based on step?
      setError(`Failed to load knowledge bases: ${err.message}`);
      setKnowledgeBases([]); // Clear any partial state
    } finally {
      setLoading(false);
      // // console.log("🏁 KBSelector: Finished fetchKnowledgeBases attempt."); // REMOVE
    }
  };

  // Simple useEffect without useCallback - Keep this simple
  useEffect(() => {
    // // console.log("🔄 KBSelector: useEffect triggered. Checking userId:", userId); // REMOVE
    // setEffectExecuted(true); // REMOVE

    // // console.log("🚀 KBSelector: useEffect async IIFE starting..."); // REMOVE

    (async () => {
      try {
        // // console.log("📞 KBSelector: Calling fetchKnowledgeBases from useEffect..."); // REMOVE
        await fetchKnowledgeBases();
        // // console.log("✅ KBSelector: fetchKnowledgeBases call completed in useEffect."); // REMOVE
      } catch (e) {
        // console.error("❌ KBSelector: Error within useEffect async IIFE:", e); // Keep this one general error log maybe? Or remove too? Let's remove for now.
      }
    })();

    /* // REMOVE Block
    return () => {
      // console.log("🧹 KBSelector: Component unmounting or userId changed");
    };
    */
  }, [userId]); // Only re-run if userId changes

  // Listen for clicks outside the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle selecting a knowledge base
  const handleSelect = (kb: KnowledgeBaseWithAccess) => {
    // // console.log("🖱️ KBSelector: Handling selection of KB:", kb.name, kb.id, "hasAccess:", kb.hasAccess) // REMOVE
    
    // Prevent selection if user doesn't have access
    if (!kb.hasAccess) {
      // // console.log("🚫 KBSelector: Selection prevented - no access to KB:", kb.id) // REMOVE
      return;
    }
    
    // If it's already selected, deselect it
    if (selectedKnowledgeBaseId && selectedKnowledgeBaseId.includes(kb.id)) {
      // // console.log("🔄 KBSelector: Deselecting KB:", kb.id) // REMOVE
      onSelectKnowledgeBase(selectedKnowledgeBaseId.filter(id => id !== kb.id));
    } else {
      // // console.log("✅ KBSelector: Selecting KB:", kb.id) // REMOVE
      onSelectKnowledgeBase([...(selectedKnowledgeBaseId || []), kb.id]);
    }
  }

  // Toggle database icon click - select all or none
  const toggleAllSelection = () => {
    const accessibleKbs = knowledgeBases.filter(kb => kb.hasAccess);
    
    // If all accessible KBs are selected, deselect all, otherwise select all
    const allSelected = accessibleKbs.every(kb => 
      selectedKnowledgeBaseId && selectedKnowledgeBaseId.includes(kb.id)
    );

    if (allSelected) {
      // Deselect all
      onSelectKnowledgeBase(null);
    } else {
      // Select all accessible KBs
      onSelectKnowledgeBase(accessibleKbs.map(kb => kb.id));
    }
  };

  // Clear the selection
  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    // // console.log("🧹 KBSelector: Clearing selection") // REMOVE
    onSelectKnowledgeBase(null);
  }

  /* // REMOVE Block
  // Manual trigger button for testing
  const manualFetch = () => {
    // console.log("🔄 KBSelector: Manual fetch triggered");
    fetchKnowledgeBases();
  };
  */

  /* // REMOVE Block
  // console.log("🖥️ KBSelector: Rendering with state:", {
    loading,
    error,
    knowledgeBasesCount: knowledgeBases.length,
    hasAccessibleKBs: knowledgeBases.some(kb => kb.hasAccess),
    effectExecuted // Remove this line if effectExecuted state is removed
  })
  */

  const accessibleKnowledgeBases = knowledgeBases.filter(kb => kb.hasAccess);
  const allSelected = accessibleKnowledgeBases.length > 0 && 
    accessibleKnowledgeBases.every(kb => 
      selectedKnowledgeBaseId && selectedKnowledgeBaseId.includes(kb.id)
    );

  // Display active knowledge bases as a dropdown
  return (
    <div
      id="knowledge-base-display"
      ref={dropdownRef}
      className={`relative flex items-center rounded-lg border-border bg-card/70 px-3 py-1.5 text-sm text-muted-foreground ${
        isCompact ? "min-w-[200px] max-w-[300px]" : "w-full md:w-[300px]"
      }`}
    >
      <button 
        onClick={toggleAllSelection}
        className="mr-2 shrink-0 transition-all duration-200 hover:text-primary"
        title={allSelected ? "Alle Wissensdatenbanken abwählen" : "Alle Wissensdatenbanken auswählen"}
      >
        <DatabaseIcon size={16} className={allSelected ? "text-primary" : ""} />
      </button>

      <div className="grow overflow-hidden">
        {loading ? (
          <div className="py-1 text-xs text-muted-foreground">Wird geladen...</div>
        ) : error ? (
          <div className="py-1 text-xs text-destructive">{error}</div>
        ) : knowledgeBases.filter(kb => kb.hasAccess).length === 0 ? (
          <div className="py-1 text-xs text-muted-foreground">
            Keine verfügbar
          </div>
        ) : (
          <div 
            className="flex cursor-pointer items-center justify-between"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <div className="truncate">
              {selectedKnowledgeBaseId && selectedKnowledgeBaseId.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <DatabaseIcon size={13} className="shrink-0 text-zinc-500/90" />
                  <span className="truncate">
                    {selectedKnowledgeBaseId.length === 1
                      ? knowledgeBases.find(kb => kb.id === selectedKnowledgeBaseId[0])?.name
                      : `${selectedKnowledgeBaseId.length} ausgewählt`}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">Wissensdatenbank auswählen</span>
              )}
            </div>
            <ChevronDown size={16} className="ml-2 shrink-0 transition-all duration-200" />
          </div>
        )}
      </div>

      {/* Clear Selection Button */}
      {selectedKnowledgeBaseId && selectedKnowledgeBaseId.length > 0 && (
        <button
          onClick={clearSelection}
          className="ml-2 shrink-0 rounded-full p-1 transition-all duration-200 hover:bg-secondary hover:text-primary"
          title="Alle Wissensdatenbanken abwählen"
        >
          <X size={12} />
        </button>
      )}

      {/* Dropdown Menu */}
      {showDropdown && accessibleKnowledgeBases.length > 0 && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border-border bg-card py-1 shadow-lg">
          {/* "Alles" Button */}
          <button
            onClick={toggleAllSelection}
            className={`flex w-full items-center px-4 py-2 text-sm transition-all duration-200 hover:bg-muted ${
              allSelected ? "bg-primary/20 text-primary" : "text-muted-foreground"
            }`}
          >
            <span className="font-medium">Alles</span>
          </button>
          
          <div className="my-1 border-t border-border"></div>
          
          {/* Individual Knowledge Base Options */}
          {accessibleKnowledgeBases.map(kb => {
            const isSelected = selectedKnowledgeBaseId && selectedKnowledgeBaseId.includes(kb.id);
            return (
              <button
                key={kb.id}
                onClick={() => handleSelect(kb)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-all duration-200 hover:bg-muted ${
                  isSelected
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground"
                }`}
              >
                <DatabaseIcon size={13} className={`shrink-0 ${isSelected ? "text-primary/80" : "text-zinc-500/90"}`} />
                {kb.name}
              </button>
            );
          }
          ))}
        </div>
      )}
    </div>
  )
}