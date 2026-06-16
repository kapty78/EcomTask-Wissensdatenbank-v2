# Tenant-Guard-Matrix — Knowledge-Agent-Tools (WP-D4)

**Stand:** 2026-06-16 · **Quelle:** `app/api/knowledge/agent/route.ts` (`executeTool`)

## Bedrohungsmodell

Im **Cross-Agent-Modus** (Service-to-Service via HMAC, WP-D2) ist
`authClient = serviceClient` — **RLS ist umgangen**. `resolveKnowledgeBaseId`
(Z. 432) übernimmt **jede** `args.knowledge_base_id`, die das LLM/der Aufrufer
liefert. Ohne expliziten Company-Check könnte damit eine fremde KB-/Chunk-/
Fact-/Document-ID adressiert werden.

## Schutzmechanismus

1. **Zentraler Guard** (`executeTool`, vor dem `switch`): Für jedes Tool in
   `KB_SCOPED_TOOLS` wird `kb = args.knowledge_base_id || activeKnowledgeBaseId`
   per `assertKbBelongsToCompany(serviceClient, kb, defaultCompanyId, userId)`
   validiert. Die Funktion **wirft** im Cross-Agent-Modus (`defaultCompanyId`
   gesetzt) bei fremder Company (Z. 467 — fail-closed).
2. **Entitäts-Bindung:** Chunk-/Fact-/Document-Tools prüfen zusätzlich, dass die
   Entität zur (nun validierten) KB gehört — `getChunkAndDocument`
   (chunk↔kb über `knowledge_items.source_chunk`+`knowledge_base_id`),
   `resolveDocumentForKb` (`getDocumentKbRelationStatus` → wirft bei `"other"`),
   und der Inline-Check `factRow.knowledge_base_id !== resolvedKbId`. Damit ist
   eine Entität transitiv company-gescoped, sobald ihre KB es ist.
3. **Sonder-Resolution:** `set_active_knowledge_base` löst auch per Name auf —
   die Name-Suche ist im Cross-Agent-Modus zusätzlich inline auf
   `company_id = defaultCompanyId` gefiltert.

## Matrix (42 Tools)

Guard-Typen: **Z** = zentraler Guard (`KB_SCOPED_TOOLS`) · **E** = Entitäts-∈-KB-Check
zusätzlich · **Q** = eigene company-scoped Query · **I** = inline Sonder-Scope ·
**n.a.** = kein KB-Datenzugriff (mit Begründung).

| # | Tool | Guard | Begründung |
|---|------|-------|-----------|
| 1 | search_knowledge | Z | kb via Args → zentral validiert |
| 2 | search_chunks_by_text | Z | kb via Args |
| 3 | search_facts_by_text | Z | kb via Args |
| 4 | get_knowledge_overview | Z | kb via Args |
| 5 | generate_question_prompt | Z | kb via Args |
| 6 | debug_knowledge_search | Z | kb via Args |
| 7 | verify_fact_findability | Z | kb via Args |
| 8 | list_documents | Z | kb via Args (war Lücke, jetzt zentral) |
| 9 | get_chunk_details | Z+E | kb zentral + chunk∈kb (getChunkAndDocument) |
| 10 | create_chunk | Z+E | kb zentral + document∈kb |
| 11 | add_fact_to_chunk | Z+E | kb zentral + chunk∈kb |
| 12 | update_chunk_content | Z+E | kb zentral + chunk∈kb |
| 13 | delete_chunk | Z+E | kb zentral + chunk∈kb |
| 14 | regenerate_chunk_facts | Z+E | kb zentral + chunk∈kb |
| 15 | get_chunk_combine_suggestions | Z | kb via Args |
| 16 | execute_chunk_combine | Z | kb via Args |
| 17 | run_mismatch_analysis | Z | kb via Args |
| 18 | update_fact_content | Z+E | kb zentral + fact∈kb (Inline-Check) |
| 19 | delete_fact | Z+E | kb zentral + fact∈kb (Inline-Check) |
| 20 | rename_document | Z+E | kb zentral + document∈kb (resolveDocumentForKb) |
| 21 | rename_source | Z+E | Alias von rename_document |
| 22 | delete_document | Z+E | kb zentral + document∈kb |
| 23 | delete_source | Z+E | Alias von delete_document |
| 24 | rename_knowledge_base | Z | kb via Args |
| 25 | delete_knowledge_base | Z | kb via Args; Ownership vor RPC validiert |
| 26 | import_web_page | Z | kb via Args |
| 27 | upload_text_document | Z | kb via Args |
| 28 | upload_file_from_url | Z | kb via Args |
| 29 | upload_attachment_to_kb | Z | kb via Args |
| 30 | analyze_attachment | Z | kb via Args |
| 31 | set_active_knowledge_base | Z+I | byId: zentral; byName: inline company-Filter |
| 32 | list_knowledge_bases | Q | `.eq("company_id", defaultCompanyId)` |
| 33 | create_knowledge_base | Q | Insert mit `company_id = defaultCompanyId` |
| 34 | list_skills | n.a. | Skills-API, `company_id`-Query-Param |
| 35 | create_skill | n.a. | Skills-API, company-scoped |
| 36 | update_skill | n.a. | Skills-API, company-scoped |
| 37 | assign_skill | n.a. | Skills-API, company-scoped |
| 38 | web_search | n.a. | Externe Web-Suche, kein KB-Datenzugriff |
| 39 | present_table | n.a. | Reine Darstellung, kein Datenzugriff |
| 40 | present_code_block | n.a. | Reine Darstellung |
| 41 | present_image | n.a. | Reine Darstellung |
| 42 | present_interactive_choices | n.a. | Reine Darstellung |

## Zusätzliche Härtung (WP-D4)

- **Tool-Result-Clipping:** In die LLM-History gehen max. 2 KB pro Result
  (`clipToolResultForHistory`, `…(gekürzt)`-Marker); das volle Ergebnis bleibt
  in `toolExecutionRecords` + `tool_output.meta`.
- **Output-Redaction (Spiegel WP-A2):** `tool_input`/`tool_output` werden vor
  der Persistenz in `agent_messages` durch `redactSecretsDeep` maskiert
  (Schlüssel ~ pass/secret/token/api_key/authorization/credential/bearer).
- **Skills-API:** 10s-Timeout + Graceful-Degradation („Skills derzeit nicht
  verfügbar") statt Agent-Abbruch (`callSkillsApi`).

## Pflege

Jedes **neue** kb-gebundene Tool MUSS in `KB_SCOPED_TOOLS` eingetragen und hier
in der Matrix ergänzt werden. Die Zwei-Firmen-Live-Probe deckt Regressionen ab.

## Abnahme (Live, 2026-06-16)

Zwei-Firmen-Probe gegen Prod-WDB im Cross-Agent-Modus: signierter Request mit
Company A, aber `knowledge_base_id` einer fremden Company B →
`assertKbBelongsToCompany` wirft `Zugriff verweigert` (siehe
`audit/SOTA-EXECUTION-PLAN.md`). Eigene KB derselben Company → Zugriff erlaubt.
