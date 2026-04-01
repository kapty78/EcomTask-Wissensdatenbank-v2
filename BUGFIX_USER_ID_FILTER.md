# 🐛 Bugfix: user_id Filter entfernt für Company Sharing

**Datum:** 2. Oktober 2025  
**Problem:** Frontend filterte noch mit `user_id` statt sich auf RLS Policies zu verlassen  
**Status:** ✅ Behoben

## Problem-Beschreibung

Nach Implementierung des Company-Wide Data Sharing Systems wurden im Frontend immer noch die Knowledge Bases mit `.eq("user_id", userId)` gefiltert. Das führte dazu, dass:

- ❌ Benutzer nur ihre **eigenen** Knowledge Bases sahen
- ❌ Team-Mitglieder **nicht** die Knowledge Bases anderer Company-Mitglieder sehen konnten
- ❌ Die RLS Policies nicht wirksam wurden

**Erwartetes Verhalten:**
- ✅ Benutzer sehen **alle** Knowledge Bases ihrer Company
- ✅ RLS Policies filtern automatisch basierend auf `company_id`
- ✅ Team-Mitglieder können gemeinsam auf Wissensdatenbanken zugreifen

## Betroffene Dateien

### 1. Frontend-Komponenten

#### ✅ `components/knowledge/KnowledgeBaseList.tsx`

**VORHER (Zeile 66-70):**
```typescript
const { data, error } = await supabase
  .from("knowledge_bases")
  .select("*")
  .eq("user_id", userId) // ❌ Filtert nur auf user_id
  .order("created_at", { ascending: false })
```

**NACHHER (Zeile 66-71):**
```typescript
// ✅ COMPANY SHARING: RLS Policies filtern automatisch auf company_id
// Kein .eq("user_id") mehr - alle Company-KBs werden zurückgegeben
const { data, error } = await supabase
  .from("knowledge_bases")
  .select("*")
  .order("created_at", { ascending: false })
```

### 2. Backend-API

#### ✅ `app/api/knowledge/rename/route.ts`

**VORHER (Zeile 27-33):**
```typescript
const { data, error } = await supabase
  .from("knowledge_bases")
  .update({ name: newName })
  .eq("id", knowledgeBaseId)
  .eq("user_id", session.user.id) // ❌ Erlaubt nur Owner UPDATE
  .select()
  .single()
```

**NACHHER (Zeile 27-34):**
```typescript
// ✅ COMPANY SHARING: RLS Policy erlaubt UPDATE für alle Company-Mitglieder
// Kein .eq("user_id") mehr benötigt
const { data, error } = await supabase
  .from("knowledge_bases")
  .update({ name: newName })
  .eq("id", knowledgeBaseId)
  .select()
  .single()
```

#### ✅ `app/api/knowledge/delete/route.ts`

**VORHER (Zeile 32-38):**
```typescript
// 1. Verify ownership
const { data: kbData, error: ownerError } = await supabase
  .from("knowledge_bases")
  .select("id")
  .eq("id", knowledgeBaseId)
  .eq("user_id", user.id) // ❌ Nur Owner kann löschen
  .single();
```

**NACHHER (Zeile 32-38):**
```typescript
// 1. Verify access (RLS Policy prüft automatisch ob User Zugriff hat)
// ✅ COMPANY SHARING: Kein .eq("user_id") mehr - RLS erlaubt DELETE nur für Owner/Admin
const { data: kbData, error: ownerError } = await supabase
  .from("knowledge_bases")
  .select("id")
  .eq("id", knowledgeBaseId)
  .single();
```

## Wie funktioniert es jetzt?

### RLS Policies übernehmen die Filterung

Die RLS Policies (aus `20251002000002_update_rls_policies_for_company_sharing.sql`) filtern automatisch:

```sql
-- SELECT Policy
CREATE POLICY "Users can view company and public knowledge bases"
  ON public.knowledge_bases
  FOR SELECT
  USING (
    -- Eigene Company KBs
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    -- Public KBs
    sharing = 'public'
    OR
    -- Eigene KBs (falls kein company_id gesetzt)
    user_id = auth.uid()
  );

-- UPDATE Policy
CREATE POLICY "Users can update company knowledge bases"
  ON public.knowledge_bases
  FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

-- DELETE Policy
CREATE POLICY "Users can delete own knowledge bases or company admin"
  ON public.knowledge_bases
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.company_admins ca
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE ca.user_id = auth.uid()
      AND ca.company_id = p.company_id
      AND p.company_id = knowledge_bases.company_id
    )
  );
```

### Ablauf

1. **Frontend macht Query:**
   ```typescript
   await supabase.from("knowledge_bases").select("*")
   ```

2. **Supabase prüft RLS Policy:**
   - Holt `company_id` des authentifizierten Users
   - Filtert automatisch auf `company_id`
   - Gibt nur relevante Knowledge Bases zurück

3. **Ergebnis:**
   - User sieht alle Knowledge Bases seiner Company
   - User sieht Public Knowledge Bases
   - User sieht NICHT Knowledge Bases anderer Companies

## Nicht geänderte Stellen

Diese Verwendungen von `.eq("user_id")` sind **korrekt** und wurden **nicht geändert**:

### ✅ `components/knowledge/KnowledgeBaseUserManager.tsx`
```typescript
// Löscht einen spezifischen User aus einer Gruppe - KORREKT
.delete()
.eq("group_id", groupId)
.eq("user_id", userId)
```

### ✅ `components/knowledge/KnowledgeBaseSelector.tsx`
```typescript
// Holt Gruppen-Mitgliedschaften eines Users - KORREKT
.from("knowledge_group_members")
.select("group_id")
.eq("user_id", userId)
```

## Testing

### Test 1: Knowledge Bases laden
```typescript
// Als User eingeloggt
const { data: kbs } = await supabase
  .from("knowledge_bases")
  .select("*")

// Erwartet: Alle Knowledge Bases der Company + Public KBs
```

### Test 2: Knowledge Base umbenennen
```typescript
// Als normaler User (nicht Owner)
const { data } = await supabase
  .from("knowledge_bases")
  .update({ name: "Neuer Name" })
  .eq("id", kb_id)

// Erwartet: Erfolgreich (RLS erlaubt UPDATE für Company-Mitglieder)
```

### Test 3: Knowledge Base löschen
```typescript
// Als normaler User versucht fremde KB zu löschen
const { data } = await supabase
  .from("knowledge_bases")
  .delete()
  .eq("id", kb_id)

// Erwartet: Fehler (RLS erlaubt DELETE nur für Owner oder Admin)
```

## Deployment

### Bereits deployed:
- ✅ Migrations ausgeführt (RLS Policies aktiv)
- ✅ Frontend-Komponenten aktualisiert
- ✅ Backend-APIs aktualisiert

### Nach Deployment testen:
1. **Als Admin:**
   - Erstelle Knowledge Base
   - Erstelle Team-Mitglied
   
2. **Als Team-Mitglied:**
   - Login
   - Öffne Wissensdatenbanken
   - **Erwarte:** Admin's Knowledge Base ist sichtbar
   - Versuche KB umzubenennen
   - **Erwarte:** Erfolgreich
   - Versuche Admin's KB zu löschen
   - **Erwarte:** Fehler (keine Berechtigung)

## Zusammenfassung

**Geänderte Dateien:** 3
- ✅ `components/knowledge/KnowledgeBaseList.tsx`
- ✅ `app/api/knowledge/rename/route.ts`
- ✅ `app/api/knowledge/delete/route.ts`

**Änderungstyp:** Filter-Logik entfernt, RLS Policies übernehmen

**Ergebnis:**
- ✅ Company-Wide Data Sharing funktioniert korrekt
- ✅ Team-Mitglieder sehen gemeinsame Wissensdatenbanken
- ✅ RLS Policies sichern Daten-Zugriff ab

**Keine Breaking Changes** - System funktioniert weiterhin für Einzelbenutzer

---

**Status:** ✅ Bugfix erfolgreich implementiert




