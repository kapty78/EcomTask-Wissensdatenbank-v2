export const KNOWLEDGE_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_knowledge_bases",
      description: "Listet alle für den Benutzer sichtbaren Wissensdatenbanken (Company/Sharing-basiert).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximale Anzahl (Standard 30)."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_active_knowledge_base",
      description:
        "Setzt die aktive Wissensdatenbank für die laufende Agenten-Sitzung (per ID oder Name).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "UUID der Wissensdatenbank."
          },
          knowledge_base_name: {
            type: "string",
            description: "Name der Wissensdatenbank (unscharf)."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_knowledge_base",
      description: "Erstellt eine neue Wissensdatenbank für den aktuellen Benutzer/Company-Kontext.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            description: "Name der neuen Wissensdatenbank."
          },
          description: {
            type: "string",
            description: "Optionale Beschreibung der Wissensdatenbank."
          },
          set_active: {
            type: "boolean",
            description: "Optional: direkt als aktive Wissensdatenbank setzen (Standard: true)."
          }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_documents",
      description: "Listet Dokumente innerhalb einer Wissensdatenbank.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst wird die aktive KB verwendet."
          },
          query: {
            type: "string",
            description: "Optionaler Filter auf Titel/Dateiname."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximale Anzahl (Standard 25)."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "Durchsucht eine Wissensdatenbank nach passenden Fakten/Fragen/Chunks (Webhook-First, RPC-Fallback).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          query: {
            type: "string",
            description: "Die Suchanfrage in natürlicher Sprache."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Anzahl der Treffer (Standard 6)."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "debug_knowledge_search",
      description:
        "DIAGNOSE-Tool: Führt die echte produktive Wissenssuche aus und liefert ALLE Metadaten zurück — Top-N Chunks mit similarity, search_source (vector/graph/both), community_id, community_theme, confidence (extracted/inferred/ambiguous), graph_hop, matched_facts. Plus search_metadata: 5 expandierte Queries, raw/dedup counts, dropped_below_threshold, dropped_ambiguous_low_sim, errors. Plus 'verdict'-String mit Klartext-Diagnose ('top result is community X at sim 0.74' oder '3 chunks dropped by ambiguous_floor'). NUTZE DIES wenn search_knowledge nichts oder das Falsche liefert — hier siehst du WARUM.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          query: {
            type: "string",
            description: "Die Original-Kundenanfrage 1:1 — keine Vorverarbeitung. Genau das wonach die Pipeline gesucht hat."
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 30,
            description: "Anzahl Chunks zurückzuliefern (Standard 10)."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_chunks_by_text",
      description:
        "Wörtliche Substring-Suche (ILIKE) auf chunk_content — KEIN Embedding, KEIN Ranking. Nutze dies wenn du vermutest dass das Wissen im KB steht aber die semantische Suche es nicht findet ('try & error': finde alle Chunks die genau das Wort enthalten). Pro Chunk werden auch die Anzahl Fakten und community_id/theme zurückgegeben.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          query: {
            type: "string",
            description: "Substring der im chunk_content vorkommen soll. Z.B. ein Eigenname, eine Telefonnummer, ein Domänen-Begriff."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Maximale Trefferzahl (Standard 20)."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_facts_by_text",
      description:
        "Wörtliche Substring-Suche (ILIKE) auf knowledge_items.content / .question — findet Fakten unabhängig vom Embedding. Nutze dies wenn ein Begriff im KB sein müsste aber die semantische Suche ihn nicht findet, oder wenn du nach existierenden Fakten zu einem Thema suchst bevor du neue erstellst (Duplikate-Vermeidung).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          query: {
            type: "string",
            description: "Substring der in der Fakt-content oder -question vorkommen soll."
          },
          fact_type: {
            type: "string",
            description: "Optional: nur Fakten dieses fact_type (z.B. 'rule', 'spec', 'contact')."
          },
          source_filter: {
            type: "string",
            description: "Optional: nur Fakten aus Dokumenten mit diesem Namen."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Maximale Trefferzahl (Standard 30)."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_chunk_details",
      description: "Lädt Details eines Chunks inkl. Fakten aus der aktiven Wissensdatenbank.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          chunk_id: {
            type: "string",
            description: "UUID des Chunks."
          }
        },
        required: ["chunk_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_chunk",
      description: "Erstellt einen neuen Chunk in einem vorhandenen Dokument. PFLICHT VORHER (wie bei Skills): search_chunks_by_text mit Fall- UND Kategorie-Begriff — existiert ein Chunk zur selben Kategorie, diesen via update_chunk_content ERWEITERN statt einen Parallel-Chunk zu streuen. Neue Chunks auf KATEGORIE-Ebene formulieren (der ausloesende Einzelfall ist Beispiel/Unterabschnitt, nicht das Thema). Hat einen Ueberlappungs-Guard: meldet er duplicate_suspects, den genannten Chunk erweitern statt force_create zu setzen.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          document_id: {
            type: "string",
            description: "UUID des Dokuments."
          },
          document_title: {
            type: "string",
            description: "Alternativ zu document_id: Dokumenttitel."
          },
          content: {
            type: "string",
            description: "Inhalt des neuen Chunks — vollstaendig, suchnah, auf Kategorie-Ebene formuliert."
          },
          force_create: {
            type: "boolean",
            description: "Nur true, wenn der Ueberlappungs-Guard duplicate_suspects gemeldet hat UND der User den bewussten Parallel-Chunk nach explizitem Hinweis bestaetigt hat."
          }
        },
        required: ["content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_fact_to_chunk",
      description:
        "SECONDARY/SUPPLEMENTAL: Fügt einem Chunk einen neuen Fakt bzw. Frageanker hinzu und erzeugt ein Embedding. Nicht als primären Speicher für neues Wissen verwenden: neue oder korrigierte Knowledge muss zuerst im Chunk-Text stehen bzw. per update_chunk_content ergänzt werden. Fact-only ist nur ok, wenn der Chunk-Text die Information bereits korrekt enthält und der Fakt nur die Auffindbarkeit verbessert.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          chunk_id: {
            type: "string",
            description: "UUID des Ziel-Chunks."
          },
          fact: {
            type: "string",
            description:
              "Neuer sekundärer Faktinhalt/Frageanker. Muss eine Information spiegeln, die bereits im Chunk-Text steht oder im selben Arbeitsgang dort ergänzt wurde."
          },
          fact_type: {
            type: "string",
            description: "Optionaler sekundärer Fakt-Typ (z. B. fact oder question)."
          }
        },
        required: ["chunk_id", "fact"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "rename_knowledge_base",
      description: "Benennt eine Wissensdatenbank um.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "UUID der Wissensdatenbank."
          },
          new_name: {
            type: "string",
            description: "Neuer Name der Wissensdatenbank."
          }
        },
        required: ["knowledge_base_id", "new_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "rename_document",
      description: "Benennt ein Dokument (Quelle) innerhalb einer Wissensdatenbank um.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          document_id: {
            type: "string",
            description: "UUID des Dokuments."
          },
          document_title: {
            type: "string",
            description: "Alternativ zu document_id: Dokumenttitel."
          },
          new_name: {
            type: "string",
            description: "Neuer Dokumenttitel."
          }
        },
        required: ["new_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "rename_source",
      description: "Alias für rename_document: benennt eine Quelle (Dokument) um.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          source_id: {
            type: "string",
            description: "UUID der Quelle (Dokument-ID)."
          },
          source_name: {
            type: "string",
            description: "Alternativ zu source_id: Quellname/Dokumenttitel."
          },
          new_name: {
            type: "string",
            description: "Neuer Quellenname (Dokumenttitel)."
          }
        },
        required: ["new_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_chunk_content",
      description:
        "PRIMARY für Knowledge-Updates: Ändert den tatsächlichen Chunk-Text, auf dem Chunk-Embeddings und semantische Suche basieren. Nutze dieses Tool zuerst, wenn Wissen neu, falsch, unvollständig oder zu vage ist. Facts sind danach nur sekundäre Ergänzungen.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          chunk_id: {
            type: "string",
            description: "UUID des Chunks."
          },
          content: {
            type: "string",
            description:
              "Vollständiger neuer Chunk-Inhalt. Muss die korrigierte/ergänzte Knowledge direkt im Text enthalten, nicht nur auf Facts verweisen."
          }
        },
        required: ["chunk_id", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_fact_content",
      description:
        "SECONDARY/SUPPLEMENTAL: Ändert einen vorhandenen Fakt/Knowledge-Item als Such-, Frage- oder Strukturanker. Nicht verwenden, um Knowledge nur im Fact zu korrigieren: Wenn der Chunk-Text falsch oder unvollständig ist, zuerst update_chunk_content ausführen.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          fact_id: {
            type: "string",
            description: "UUID des Fakts (knowledge_items.id)."
          },
          content: {
            type: "string",
            description:
              "Neuer sekundärer Fakt-Inhalt. Darf den Chunk-Text nicht ersetzen; die Aussage muss im Chunk-Text bereits korrekt enthalten sein oder parallel dort ergänzt werden."
          },
          fact_type: {
            type: "string",
            description: "Optionaler sekundärer Fakt-Typ, z. B. fact oder question."
          }
        },
        required: ["fact_id", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_knowledge_base",
      description: "Löscht eine Wissensdatenbank inklusive zugehöriger Daten (destruktiv).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "UUID der Wissensdatenbank."
          },
          confirm: {
            type: "boolean",
            description: "Muss true sein, damit gelöscht wird."
          }
        },
        required: ["knowledge_base_id", "confirm"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_document",
      description: "Löscht ein Dokument inkl. zugehöriger Chunks/Fakten (destruktiv).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          document_id: {
            type: "string",
            description: "UUID des Dokuments."
          },
          document_title: {
            type: "string",
            description: "Alternativ zu document_id: Dokumenttitel."
          },
          confirm: {
            type: "boolean",
            description: "Muss true sein, damit gelöscht wird."
          }
        },
        required: ["confirm"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_source",
      description: "Alias für delete_document: löscht eine Quelle (Dokument) inkl. Chunks/Fakten.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          source_id: {
            type: "string",
            description: "UUID der Quelle (Dokument-ID)."
          },
          source_name: {
            type: "string",
            description: "Alternativ zu source_id: Quellname/Dokumenttitel."
          },
          confirm: {
            type: "boolean",
            description: "Muss true sein, damit gelöscht wird."
          }
        },
        required: ["confirm"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_chunk",
      description: "Löscht einen Chunk und dessen Fakten (destruktiv).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          chunk_id: {
            type: "string",
            description: "UUID des Chunks."
          },
          confirm: {
            type: "boolean",
            description: "Muss true sein, damit gelöscht wird."
          }
        },
        required: ["chunk_id", "confirm"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_fact",
      description:
        "Löscht einen sekundären Fakt/Knowledge-Item (destruktiv). Dies bereinigt nur Fact-Anker; prüfe bei falscher Knowledge zusätzlich, ob der primäre Chunk-Text per update_chunk_content korrigiert werden muss.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          fact_id: {
            type: "string",
            description: "UUID des Fakts (knowledge_items.id)."
          },
          confirm: {
            type: "boolean",
            description: "Muss true sein, damit gelöscht wird."
          }
        },
        required: ["fact_id", "confirm"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "regenerate_chunk_facts",
      description:
        "SECONDARY/SUPPLEMENTAL: Startet die Fakten-Regenerierung für einen Chunk über den n8n-Workflow. Nur sinnvoll, wenn der primäre Chunk-Text bereits korrekt und vollständig ist; neue Knowledge vorher per update_chunk_content oder create_chunk in den Chunk-Text schreiben.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          chunk_id: {
            type: "string",
            description: "UUID des Chunks."
          }
        },
        required: ["chunk_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_mismatch_analysis",
      description:
        "Startet oder setzt die Mismatch-Analyse fort, um widersprüchliche/veraltete Fakten in der aktiven Wissensdatenbank zu finden.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          batch_id: {
            type: "string",
            description: "Optional: vorhandene Job-ID zum Fortsetzen."
          },
          continue_processing: {
            type: "boolean",
            description: "Optional: true, um einen laufenden Job fortzusetzen."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_chunk_combine_suggestions",
      description:
        "Lädt Vorschläge, welche Chunks/Fakten thematisch zusammengeführt werden können (Combine Tool Vorschau).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_chunk_combine",
      description:
        "Führt ein bestätigtes Combine-Merging aus (Primary-Chunk + weitere Chunks/Fakten). Destruktiv für zusammengeführte Einträge.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          primary_chunk_id: {
            type: "string",
            description: "Chunk-ID, der als Haupt-Chunk erhalten bleibt."
          },
          merge_chunk_ids: {
            type: "array",
            items: {
              type: "string"
            },
            maxItems: 100,
            description: "Weitere Chunk-IDs, die in den Primary-Chunk zusammengeführt werden."
          },
          manual_knowledge_item_ids: {
            type: "array",
            items: {
              type: "string"
            },
            maxItems: 200,
            description: "Optionale manuelle Knowledge-Item IDs, die in den Merge einfließen."
          },
          confirm: {
            type: "boolean",
            description: "Muss true sein, damit das Merge ausgeführt wird."
          }
        },
        required: ["primary_chunk_id", "confirm"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Recherchiert aktuelle Informationen im Web. Liefert eine kurze, quellennahe Zusammenfassung.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Suchanfrage in natürlicher Sprache."
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Maximale Anzahl der zu berücksichtigenden Web-Treffer."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "import_web_page",
      description:
        "Liest den Inhalt einer Webseite ein und legt ihn als neues Text-Dokument in der Wissensdatenbank an.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          url: {
            type: "string",
            description: "Öffentliche Webseiten-URL (https://...)."
          },
          title: {
            type: "string",
            description: "Optionaler Dokumenttitel."
          },
          source_name: {
            type: "string",
            description: "Optionaler Quellenname für Fakten."
          }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "upload_text_document",
      description:
        "Laedt Text als Upload in die Wissensdatenbank. Das Dokument wird dabei automatisch im Upload-Prozess erstellt.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          title: {
            type: "string",
            description: "Dokumenttitel."
          },
          content: {
            type: "string",
            description: "Textinhalt des Dokuments."
          },
          source_name: {
            type: "string",
            description: "Optionaler Quellname für Fakten."
          }
        },
        required: ["title", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "upload_file_from_url",
      description:
        "Startet einen Dateiupload/Import per URL über den konfigurierten Upload-Webhook bzw. Pipeline-Service.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          file_url: {
            type: "string",
            description: "Öffentliche direkte Datei-URL (kein normaler Webseiten-Link)."
          },
          source_name: {
            type: "string",
            description: "Optionaler Anzeigename."
          }
        },
        required: ["file_url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "present_code_block",
      description:
        "Erzeugt einen strukturierten Code-Block für die Chat-Darstellung (nur Visualisierung, keine DB-Änderung).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            description: "Optionaler Titel des Code-Blocks."
          },
          language: {
            type: "string",
            description: "Programmiersprache, z. B. sql, ts, json, bash."
          },
          content: {
            type: "string",
            description: "Code-Inhalt."
          }
        },
        required: ["content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "present_table",
      description:
        "Erzeugt eine strukturierte Tabellen-Vorschau für den Chat (nur Visualisierung, keine DB-Änderung).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            description: "Optionaler Titel der Tabelle."
          },
          columns: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 12,
            description: "Tabellenspalten."
          },
          rows: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
              maxItems: 12
            },
            maxItems: 50,
            description: "Tabellenzeilen."
          }
        },
        required: ["columns", "rows"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "present_interactive_choices",
      description:
        "Erzeugt eine interaktive Auswahlkarte im Chat (Einfachauswahl, Mehrfachauswahl oder Entweder/Oder), damit der Nutzer per Klick antworten kann.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            description: "Optionaler Titel über der Auswahlkarte."
          },
          prompt: {
            type: "string",
            description: "Frage/Anweisung für die Auswahl."
          },
          selection_mode: {
            type: "string",
            enum: ["single", "multiple", "either_or"],
            description:
              "single = genau eine Auswahl, multiple = mehrere Auswahlen, either_or = A/B-Entscheidung (wie single)."
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 12,
            items: {
              oneOf: [
                {
                  type: "string"
                },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["label"]
                }
              ]
            },
            description: "Auswahloptionen als String oder Objekt mit Label/Beschreibung."
          },
          min_selections: {
            type: "integer",
            minimum: 0,
            maximum: 12,
            description: "Optional: Mindestanzahl gewählter Optionen."
          },
          max_selections: {
            type: "integer",
            minimum: 1,
            maximum: 12,
            description: "Optional: Maximalanzahl gewählter Optionen."
          },
          submit_label: {
            type: "string",
            description: "Optionales Label für den Absende-Button."
          },
          response_prefix: {
            type: "string",
            description: "Optionaler Präfix für die automatisch gesendete Antwort."
          }
        },
        required: ["prompt", "options"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "present_image",
      description:
        "Erzeugt eine Bildkarte für den Chat (URL-basiert, nur Visualisierung, keine DB-Änderung).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            description: "Optionaler Titel der Bildkarte."
          },
          image_url: {
            type: "string",
            description: "Öffentliche Bild-URL (https://...)."
          },
          alt: {
            type: "string",
            description: "Alternativer Text."
          }
        },
        required: ["image_url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "upload_attachment_to_kb",
      description:
        "Lädt eine im Chat angehängte Datei direkt in die aktive Wissensdatenbank hoch. Nutzt die URL aus dem Attachment. Das Dokument wird automatisch verarbeitet (Chunks, Fakten, Embeddings).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          attachment_url: {
            type: "string",
            description: "URL der angehängten Datei (aus dem Attachment-Kontext der Nachricht)."
          },
          title: {
            type: "string",
            description: "Dokumenttitel für die Wissensdatenbank."
          },
          source_name: {
            type: "string",
            description: "Optionaler Quellenname."
          }
        },
        required: ["attachment_url", "title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze_attachment",
      description:
        "Analysiert eine angehängte Datei: extrahiert Text aus PDFs/DOCX oder beschreibt Bilder via Vision-API. Gibt den extrahierten Inhalt zurück, ohne ihn hochzuladen.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          attachment_url: {
            type: "string",
            description: "URL der angehängten Datei."
          },
          attachment_name: {
            type: "string",
            description: "Dateiname des Attachments."
          },
          attachment_type: {
            type: "string",
            description: "MIME-Type des Attachments (z.B. image/png, application/pdf)."
          }
        },
        required: ["attachment_url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "verify_fact_findability",
      description:
        "Testet, ob ein sekundärer Fakt/Frageanker ueber verschiedene Suchformulierungen zuverlaessig gefunden wird. Generiert automatisch 4 Varianten der Referenzfrage (umgangssprachlich, keyword-basiert, formal, indirekt) und fuehrt 5 Suchen durch. Gibt einen strukturierten Bericht mit Pass/Fail pro Variante zurueck. Nutze dieses Tool IMMER nach dem Erstellen oder Aendern von Fakten. Dies ersetzt nicht die Pflicht, neue Knowledge zuerst im Chunk-Text zu speichern.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Optional: KB-ID. Sonst aktive KB."
          },
          reference_question: {
            type: "string",
            description: "Die Originalfrage, die der User stellen wuerde (z.B. 'Was kostet der Premium-Tarif?')."
          },
          expected_fact_content: {
            type: "string",
            description: "Der erwartete Fakt-Inhalt oder ein Schluesselwort, das in den Top-Ergebnissen vorkommen muss."
          },
          expected_fact_id: {
            type: "string",
            description: "Optional: UUID des erwarteten Fakts fuer exakte Pruefung."
          }
        },
        required: ["reference_question", "expected_fact_content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description:
        "Listet alle Skills (situativ ladbare Workflow-Pakete) der Firma. Rufe das IMMER auf, BEVOR du eine neue Skill anlegst, um Duplikate zu vermeiden und zu prüfen, ob ein bestehender Skill stattdessen erweitert werden sollte.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Optionaler Suchbegriff/Thema zum Filtern der Skill-Liste."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_skill",
      description:
        "Legt eine NEUE Skill UNTER der aktuell aktiven Datenbank an (wie ein Wissenseintrag — die Skill gehört zu dieser Datenbank). NUR für mehrschrittige, situativ greifende Workflows (z.B. 'Sammelbestellungen eines Großhändlers', 'Reklamations-Ablauf'). Für faktisches Wissen → stattdessen create_chunk/add_fact_to_chunk. Für immer geltende Kurzregeln → Sonderfallprompt (kein Skill). Rufe IMMER zuerst list_skills auf, prüfe auf Duplikate/Überlappung und ob ein bestehender Skill via update_skill erweitert werden sollte. Die Skill wird NICHT automatisch einem Agenten zugewiesen — das Freischalten pro Mail-Agent passiert in der SupportAI-Konfiguration.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            description: "Kebab-case, 2–40 Zeichen, z.B. 'grosshaendler-bestellung'."
          },
          description: {
            type: "string",
            description:
              "Trigger-Beschreibung (20–500 Zeichen): WANN soll der Agent diese Skill laden? Eindeutig formulieren, das ist der Auslöser."
          },
          body: {
            type: "string",
            description:
              "Der Workflow als Markdown (max. ~2000 Token): die konkreten Schritte, die der Agent abarbeiten soll."
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optionale Schlagworte."
          },
          knowledge_base_id: {
            type: "string",
            description:
              "Optional: ID der Datenbank, unter der die Skill liegen soll. Weglassen = aktuell aktive Datenbank. Nur setzen, wenn die Skill bewusst zu einer anderen oder zu KEINER (firmenweit) Datenbank gehören soll."
          }
        },
        required: ["name", "description", "body"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_skill",
      description:
        "Aktualisiert eine bestehende Skill (Name/Beschreibung/Body/Tags). Nutze das, wenn list_skills eine passende Skill zeigt, die nur erweitert werden muss — statt eine zweite, überlappende Skill anzulegen. Erzeugt automatisch einen Versions-Snapshot.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          skill_id: { type: "string", description: "UUID der zu ändernden Skill." },
          name: { type: "string", description: "Neuer Name (kebab-case), optional." },
          description: { type: "string", description: "Neue Trigger-Beschreibung, optional." },
          body: { type: "string", description: "Neuer Workflow-Body, optional." },
          tags: { type: "array", items: { type: "string" }, description: "Neue Tags, optional." },
          change_summary: { type: "string", description: "Kurze Notiz, was geändert wurde (für die Historie)." }
        },
        required: ["skill_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "assign_skill",
      description:
        "Weist eine bestehende Skill dem Mail-Agenten der Firma zu (falls sie noch nicht zugewiesen ist).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          skill_id: { type: "string", description: "UUID der Skill." }
        },
        required: ["skill_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_knowledge_overview",
      description:
        "Schnelle Themen-Landkarte einer Wissensdatenbank aus dem Wissensgraphen (Communities): welche Themen die KB abdeckt (nach Umfang sortiert), repräsentative Entitäten je Thema, Entity-Typ-Verteilung und Stand-Datum. Nutze das, um dich zu orientieren, BEVOR du gezielt suchst oder einen Fragenprompt erzeugst. Bei leerem Graph: Dokumentliste als Fallback.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Ziel-KB. Weglassen = aktuell aktive Datenbank."
          },
          max_themes: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximale Anzahl Themen (Standard 25)."
          },
          refresh: {
            type: "boolean",
            description:
              "true erzwingt eine Neuberechnung der Communities vor der Antwort (sonst nur bei veralteter/fehlender Landkarte)."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_question_prompt",
      description:
        "Erzeugt einen inhaltsgeerdeten FRAGENPROMPT-VORSCHLAG für die SupportAI-Wissenssuche, basierend auf dem Graph-Überblick dieser KB. Betont Themen, die die KB wirklich abdeckt, und lenkt explizit von Daten weg, die die KB NICHT führt (z.B. Bestellnummern, Kundenadressen, Sendungsnummern → gehören zu Tools, nicht zur KB). WICHTIG: Dieses Tool SPEICHERT NICHTS — es gibt nur einen Vorschlag (Text + Belege + Vermeidungsliste) zurück, der extern bestätigt und gespeichert wird.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          knowledge_base_id: {
            type: "string",
            description: "Ziel-KB. Weglassen = aktuell aktive Datenbank."
          },
          problem_context: {
            type: "string",
            description: "Optional: Welches Such-/Antwortproblem soll der Fragenprompt lösen?"
          },
          example_customer_request: {
            type: "string",
            description:
              "Optional: Beispiel-Kundenanfrage zur Kalibrierung (z.B. eine mit Bestellnummer)."
          },
          style: {
            type: "string",
            enum: ["compact", "detailed"],
            description: "Ausführlichkeit des Fragenprompts (Standard compact)."
          }
        }
      }
    }
  }
] as const

export type KnowledgeAgentToolName = (typeof KNOWLEDGE_AGENT_TOOLS)[number]["function"]["name"]
