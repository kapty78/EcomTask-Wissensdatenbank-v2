# Company-Wide Data Sharing - Implementierungs-Anleitung

## 📋 Überblick

Dieses Dokument beschreibt die vollständige Implementierung des Company-Wide Data Sharing Systems, das es mehreren Benutzern eines Unternehmens ermöglicht, gemeinsam auf Konfigurationen, Daten und Wissensdatenbanken zuzugreifen.

## 🎯 Ziele

- **Gemeinsame Nutzung**: Alle Benutzer eines Unternehmens teilen Konfigurationen und Wissensdatenbanken
- **Rollenbasierte Berechtigungen**: Admins können Team-Mitglieder verwalten
- **Datensicherheit**: RLS Policies stellen sicher, dass nur Company-Mitglieder auf Daten zugreifen können
- **Automatische Verwaltung**: Trigger setzen automatisch company_id bei neuen Einträgen

## 🗂️ Daten-Kategorien

### A) Company-Level (Gemeinsam genutzt)
- ✅ AI-Agent-Konfigurationen
- ✅ Wissensdatenbanken und deren Inhalte
- ✅ Chatbot-Konfigurationen
- ✅ Ordner-Konfigurationen
- ✅ Dokumente und Knowledge Items
- ✅ Workspaces

### B) User-Level aber Company-weit sichtbar
- ✅ Process Logs
- ✅ Monthly Email Stats (aggregiert)
- ✅ CSAT Responses (aggregiert)
- ✅ Daily Activity Hours (aggregiert)

### C) User-Level und Privat
- ✅ User Email Accounts (nur lesbar für Filter)
- ✅ User Settings
- ✅ User Profiles

## 📦 Implementierte Komponenten

### 1. Datenbank-Migrations

#### Migration 1: `20251002000000_add_company_id_to_knowledge_base_tables.sql`
Fügt `company_id` zu allen relevanten Tabellen hinzu:
- knowledge_bases
- documents
- knowledge_items
- document_chunks
- ai_agent_configurations
- workspaces
- process_logs (falls vorhanden)
- user_email_accounts (falls vorhanden)

**Wichtige Features:**
- Foreign Key Constraints zu `companies` Tabelle
- Indices für Performance
- Automatisches Befüllen bestehender Einträge basierend auf `user_id`

#### Migration 2: `20251002000001_add_company_id_triggers.sql`
Erstellt Trigger für automatisches Setzen von `company_id`:
- Universal-Funktion `auto_populate_company_id()`
- Spezial-Funktion für Document Chunks
- Trigger für alle relevanten Tabellen

**Wichtige Features:**
- Trigger werden nur ausgeführt wenn `company_id IS NULL`
- `SECURITY DEFINER` für sichere Ausführung
- Automatisches Lookup von `company_id` aus `profiles` Tabelle

#### Migration 3: `20251002000002_update_rls_policies_for_company_sharing.sql`
Aktualisiert Row Level Security Policies:

**SELECT Policies:**
```sql
-- Benutzer sehen alle Daten ihrer Company
company_id IN (
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
)
```

**UPDATE Policies:**
```sql
-- Für gemeinsame Configs: Alle Company-Benutzer
-- Für private Daten: Nur eigene
user_id = auth.uid()
```

**DELETE Policies:**
```sql
-- Nur eigene oder als Admin
user_id = auth.uid() OR is_company_admin()
```

### 2. Backend-API

#### Team-Management API: `/api/team-members/route.ts`

**GET**: Liste aller Team-Mitglieder
```typescript
GET /api/team-members
Authorization: Bearer {token}

Response:
{
  "success": true,
  "members": [
    {
      "id": "uuid",
      "email": "user@firma.de",
      "full_name": "Max Mustermann",
      "role": "User",
      "is_admin": false,
      "created_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

**POST**: Neues Team-Mitglied erstellen (nur Admins)
```typescript
POST /api/team-members
Authorization: Bearer {token}
Content-Type: application/json

Body:
{
  "email": "neu@firma.de",
  "password": "sicheres-passwort",
  "full_name": "Neue Person"
}

Response:
{
  "success": true,
  "message": "Team-Mitglied erfolgreich erstellt",
  "user": {
    "id": "uuid",
    "email": "neu@firma.de",
    "full_name": "Neue Person",
    "company_id": "uuid"
  }
}
```

**DELETE**: Team-Mitglied löschen (nur Admins)
```typescript
DELETE /api/team-members?userId={uuid}
Authorization: Bearer {token}

Response:
{
  "success": true,
  "message": "Team-Mitglied erfolgreich gelöscht"
}
```

**Sicherheits-Features:**
- ✅ Admin-Berechtigung erforderlich
- ✅ Domain-Validierung (gleiche E-Mail-Domain)
- ✅ Verhindert Selbst-Löschung
- ✅ Company-Isolation (nur eigene Company-Mitglieder)

### 3. Frontend-Komponenten

#### TeamManagement.tsx
Vollständige UI für Team-Verwaltung:
- ✅ Liste aller Team-Mitglieder
- ✅ Formular zum Hinzufügen neuer Mitglieder
- ✅ Löschen von Mitgliedern
- ✅ Admin-Badge für Administratoren
- ✅ Responsive Design
- ✅ Error Handling

**Integration in Dashboard:**
```tsx
import TeamManagement from '@/components/admin/TeamManagement'

// In Admin-Tab
{isAdmin && (
  <TeamManagement user={user} />
)}
```

## 🔧 Service-Layer Anpassungen

### Knowledge Base Service

**VORHER:**
```typescript
const { data } = await supabase
  .from("knowledge_bases")
  .select("*")
  .eq("user_id", userId)
```

**NACHHER:**
```typescript
// 1. Hole user's company_id
const { data: profile } = await supabase
  .from("profiles")
  .select("company_id")
  .eq("id", userId)
  .single()

// 2. Query mit company_id
const { data } = await supabase
  .from("knowledge_bases")
  .select("*")
  .eq("company_id", profile?.company_id || userId)
  
// ODER für SELECT (RLS macht das automatisch):
const { data } = await supabase
  .from("knowledge_bases")
  .select("*")
  // RLS Policy filtert automatisch auf company_id
```

### AI-Agent Configuration Service

**Intelligente Save-Logik (verhindert Duplikate):**
```typescript
async function saveConfiguration(config) {
  // 1. Hole company_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .single()
  
  // 2. Prüfe ob aktive Company-Config existiert
  const { data: existing } = await supabase
    .from("ai_agent_configurations")
    .select("id")
    .eq("company_id", profile?.company_id)
    .eq("is_active", true)
    .single()
  
  if (existing) {
    // 3a. UPDATE existierende Config
    return await supabase
      .from("ai_agent_configurations")
      .update({
        ...config,
        updated_at: new Date().toISOString()
      })
      .eq("id", existing.id)
  } else {
    // 3b. INSERT neue Config
    return await supabase
      .from("ai_agent_configurations")
      .insert({
        ...config,
        user_id: userId,
        company_id: profile?.company_id,
        is_active: true
      })
  }
}
```

### Analytics Service

**Dashboard KPIs (company-weit aggregiert):**
```typescript
async function getCompanyKPIs(userId, monthFilter) {
  // 1. Hole company_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .single()
  
  // 2. Lade alle Stats der Company
  const { data: stats } = await supabase
    .from("monthly_email_stats")
    .select("*")
    .eq("company_id", profile?.company_id)
  
  // 3. Aggregiere
  const aggregated = stats.reduce((acc, curr) => ({
    emails_sent: (acc.emails_sent || 0) + (curr.emails_sent_count || 0),
    emails_replied: (acc.emails_replied || 0) + (curr.emails_replied_count || 0)
  }), { emails_sent: 0, emails_replied: 0 })
  
  return aggregated
}
```

## 📝 Migrations ausführen

### Schritt 1: Migrations in Supabase hochladen

**Option A: Via Supabase CLI**
```bash
# Falls noch nicht installiert
npm install -g supabase

# Mit Projekt verbinden
supabase link --project-ref YOUR_PROJECT_REF

# Migrations ausführen
supabase db push

# Oder einzelne Migration
supabase db push supabase/migrations/20251002000000_add_company_id_to_knowledge_base_tables.sql
```

**Option B: Via Supabase Dashboard**
1. Gehe zu: https://app.supabase.com/project/YOUR_PROJECT/sql
2. Öffne jede Migration-Datei
3. Kopiere den SQL-Inhalt
4. Füge ihn im SQL Editor ein
5. Führe aus (Run)

**Option C: Via pgAdmin oder psql**
```bash
psql -h YOUR_HOST -U postgres -d postgres < supabase/migrations/20251002000000_add_company_id_to_knowledge_base_tables.sql
```

### Schritt 2: Reihenfolge beachten

**WICHTIG**: Führe die Migrations in dieser Reihenfolge aus:

1. ✅ `20251002000000_add_company_id_to_knowledge_base_tables.sql`
   - Fügt Spalten und Constraints hinzu
   - Befüllt bestehende Daten

2. ✅ `20251002000001_add_company_id_triggers.sql`
   - Erstellt Trigger-Funktionen
   - Richtet automatische Population ein

3. ✅ `20251002000002_update_rls_policies_for_company_sharing.sql`
   - Aktualisiert RLS Policies
   - Aktiviert Company-Sharing

### Schritt 3: Verifizierung

Nach den Migrations, prüfe:

```sql
-- 1. Prüfe ob company_id gesetzt wurde
SELECT 
  kb.id, 
  kb.name, 
  kb.user_id, 
  kb.company_id,
  p.company_id as profile_company_id
FROM knowledge_bases kb
LEFT JOIN profiles p ON p.id = kb.user_id
LIMIT 10;

-- 2. Prüfe Trigger
SELECT 
  trigger_name, 
  event_object_table, 
  action_statement
FROM information_schema.triggers
WHERE trigger_name LIKE '%company_id%';

-- 3. Prüfe RLS Policies
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  cmd, 
  qual
FROM pg_policies
WHERE tablename IN (
  'knowledge_bases', 
  'documents', 
  'knowledge_items'
)
ORDER BY tablename, cmd;
```

## 🧪 Testing

### Test 1: Admin-Benutzer erstellen

```typescript
// Als Admin eingeloggt
const response = await fetch('/api/team-members', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    email: 'test@firma.de',
    password: 'test12345',
    full_name: 'Test User'
  })
})

// Erwartetes Ergebnis:
// - Neuer User in auth.users
// - Profil mit company_id in profiles
// - KEIN Eintrag in company_admins (nur normaler User)
```

### Test 2: Knowledge Base Sharing

```typescript
// 1. Admin erstellt Knowledge Base
const { data: kb } = await supabase
  .from('knowledge_bases')
  .insert({ 
    name: 'Gemeinsame KB',
    user_id: adminId 
  })
  .select()
  .single()

// 2. Normaler User lädt Knowledge Bases
const { data: kbs } = await supabase
  .from('knowledge_bases')
  .select('*')

// Erwartetes Ergebnis:
// - kb hat automatisch company_id vom Admin
// - Normaler User sieht diese KB
// - kb.company_id === normalUser.company_id
```

### Test 3: AI-Agent Configuration

```typescript
// 1. Admin speichert Config
const { data: config1 } = await supabase
  .from('ai_agent_configurations')
  .insert({
    name: 'Company Config',
    user_id: adminId,
    is_active: true
  })
  .select()
  .single()

// 2. Normaler User lädt Configs
const { data: configs } = await supabase
  .from('ai_agent_configurations')
  .select('*')
  .eq('is_active', true)

// Erwartetes Ergebnis:
// - Normaler User sieht Admin's Config
// - Beide können Config bearbeiten (UPDATE Policy)
```

### Test 4: Document Upload

```typescript
// 1. Normaler User lädt Dokument hoch
const { data: doc } = await supabase
  .from('documents')
  .insert({
    file_name: 'Test.pdf',
    user_id: normalUserId,
    knowledge_base_id: kb.id
  })
  .select()
  .single()

// 2. Admin sieht Dokument
const { data: docs } = await supabase
  .from('documents')
  .select('*')

// Erwartetes Ergebnis:
// - doc hat automatisch company_id
// - Admin sieht das Dokument
// - Beide können darauf zugreifen (READ)
// - Nur normalUser kann es löschen (DELETE Policy)
```

## 🔒 Sicherheits-Considerations

### 1. RLS ist aktiviert
Alle Tabellen haben `ENABLE ROW LEVEL SECURITY`

### 2. Policies sind restriktiv
- SELECT: Nur eigene Company
- UPDATE: Je nach Tabelle (gemeinsam oder privat)
- DELETE: Meist nur eigene Daten

### 3. Admin-Berechtigungen
```typescript
// Prüfe immer Admin-Status
const isAdmin = await supabase
  .from('company_admins')
  .select('*')
  .eq('user_id', userId)
  .eq('company_id', companyId)
  .single()

if (!isAdmin.data) {
  throw new Error('Keine Berechtigung')
}
```

### 4. Domain-Validierung
Team-Mitglieder müssen dieselbe E-Mail-Domain haben

### 5. Service Role Key
Nur für Server-seitige Operationen verwenden, niemals im Frontend

## 🎨 Frontend-Integration

### Dashboard mit Team-Management

```tsx
// app/dashboard/page.tsx
import TeamManagement from '@/components/admin/TeamManagement'

export default function Dashboard() {
  const [isAdmin, setIsAdmin] = useState(false)
  
  // Prüfe Admin-Status
  useEffect(() => {
    const checkAdmin = async () => {
      const { data } = await supabase
        .from('company_admins')
        .select('*')
        .eq('user_id', user.id)
        .single()
      
      setIsAdmin(!!data)
    }
    checkAdmin()
  }, [user])
  
  return (
    <div>
      <Tabs>
        <TabsList>
          <TabsTrigger value="knowledge">Wissensdatenbank</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="team">Team-Verwaltung</TabsTrigger>
          )}
        </TabsList>
        
        <TabsContent value="knowledge">
          <KnowledgeComponent />
        </TabsContent>
        
        {isAdmin && (
          <TabsContent value="team">
            <TeamManagement user={user} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
```

## 📊 Monitoring & Debugging

### Nützliche Queries

```sql
-- 1. Company-Mitglieder Übersicht
SELECT 
  c.name as company,
  p.email,
  p.full_name,
  CASE WHEN ca.user_id IS NOT NULL THEN 'Admin' ELSE 'User' END as role
FROM companies c
JOIN profiles p ON p.company_id = c.id
LEFT JOIN company_admins ca ON ca.user_id = p.id AND ca.company_id = c.id
ORDER BY c.name, p.email;

-- 2. Knowledge Bases pro Company
SELECT 
  c.name as company,
  COUNT(DISTINCT kb.id) as knowledge_bases,
  COUNT(DISTINCT d.id) as documents,
  COUNT(DISTINCT ki.id) as knowledge_items
FROM companies c
LEFT JOIN knowledge_bases kb ON kb.company_id = c.id
LEFT JOIN documents d ON d.company_id = c.id
LEFT JOIN knowledge_items ki ON ki.company_id = c.id
GROUP BY c.id, c.name;

-- 3. RLS Policy Test
-- Als User eingeloggt (via Supabase Client)
SELECT * FROM knowledge_bases; -- Sieht nur eigene Company

-- 4. Orphaned Records (ohne company_id)
SELECT 
  'knowledge_bases' as table_name,
  COUNT(*) as count
FROM knowledge_bases 
WHERE company_id IS NULL
UNION ALL
SELECT 
  'documents',
  COUNT(*)
FROM documents 
WHERE company_id IS NULL;
```

## 🚀 Deployment Checklist

- [ ] Migrations in Supabase ausgeführt
- [ ] Verifizierung durchgeführt (siehe oben)
- [ ] Team-Management API deployed
- [ ] TeamManagement.tsx integriert
- [ ] Admin-Berechtigungen getestet
- [ ] RLS Policies getestet
- [ ] Trigger funktionieren
- [ ] Frontend zeigt Company-Daten korrekt
- [ ] Dokumentation aktualisiert

## 📖 Zusammenfassung

**Was wurde implementiert:**
1. ✅ 3 Migrations für company_id, Trigger und RLS
2. ✅ Team-Management API (`/api/team-members`)
3. ✅ Team-Management Frontend-Komponente
4. ✅ Automatische company_id Population
5. ✅ Company-weites Data Sharing
6. ✅ Rollenbasierte Berechtigungen

**Nächste Schritte:**
1. Migrations in Supabase ausführen
2. Team-Management in Dashboard integrieren
3. Existierende Services prüfen und ggf. anpassen
4. Testen mit mehreren Benutzern
5. Monitoring einrichten

**Support:**
Bei Fragen oder Problemen, siehe:
- RLS Policies: `20251002000002_update_rls_policies_for_company_sharing.sql`
- Trigger-Logs: Supabase Dashboard → Database → Functions
- API-Logs: Vercel/Render Logs

---

**Viel Erfolg bei der Implementierung!** 🎉




