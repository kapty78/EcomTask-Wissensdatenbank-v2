# 🚀 Company-Wide Data Sharing - Quick Start Guide

## Was wurde implementiert?

Ein vollständiges **Company-Wide Data Sharing System**, das es mehreren Benutzern eines Unternehmens ermöglicht, gemeinsam auf Wissensdatenbanken, AI-Konfigurationen und andere Ressourcen zuzugreifen.

## 📦 Neue Dateien

### Migrations (Datenbank)
1. `supabase/migrations/20251002000000_add_company_id_to_knowledge_base_tables.sql`
   - Fügt `company_id` zu allen relevanten Tabellen hinzu
   - Befüllt bestehende Daten automatisch

2. `supabase/migrations/20251002000001_add_company_id_triggers.sql`
   - Erstellt Trigger für automatisches Setzen von `company_id`
   - Funktioniert für neue Einträge

3. `supabase/migrations/20251002000002_update_rls_policies_for_company_sharing.sql`
   - Aktualisiert Row Level Security Policies
   - Ermöglicht Company-weites Lesen/Schreiben

### Backend API
4. `app/api/team-members/route.ts`
   - GET: Liste aller Team-Mitglieder
   - POST: Neues Mitglied erstellen (nur Admins)
   - DELETE: Mitglied löschen (nur Admins)

### Frontend Komponente
5. `components/admin/TeamManagement.tsx`
   - Vollständige UI für Team-Verwaltung
   - Mitglieder hinzufügen/löschen
   - Admin-Badge und Permissions

### Dokumentation
6. `docs/COMPANY_SHARING_IMPLEMENTATION.md`
   - Vollständige technische Dokumentation
   - Testing-Anleitung
   - Service-Layer Patterns

## ⚡ In 5 Minuten starten

### Schritt 1: Migrations ausführen

**Mit Supabase CLI:**
```bash
# Migrations in Reihenfolge ausführen
supabase db push supabase/migrations/20251002000000_add_company_id_to_knowledge_base_tables.sql
supabase db push supabase/migrations/20251002000001_add_company_id_triggers.sql
supabase db push supabase/migrations/20251002000002_update_rls_policies_for_company_sharing.sql
```

**Oder via Supabase Dashboard:**
1. Gehe zu: https://app.supabase.com/project/YOUR_PROJECT/sql
2. Kopiere Inhalt von Migration 1 → Führe aus
3. Kopiere Inhalt von Migration 2 → Führe aus
4. Kopiere Inhalt von Migration 3 → Führe aus

### Schritt 2: Team-Management ins Dashboard integrieren

Füge in `app/dashboard/page.tsx` hinzu:

```tsx
import TeamManagement from '@/components/admin/TeamManagement'

// Im Dashboard, nur für Admins sichtbar:
{isAdmin && activeTab === 'team' && (
  <TeamManagement user={user} />
)}
```

### Schritt 3: Testen

1. **Als Admin einloggen**
2. **Zum Team-Management Tab navigieren**
3. **Neues Team-Mitglied erstellen:**
   - E-Mail: `test@ihre-domain.de` (gleiche Domain wie Admin!)
   - Passwort: `testpassword123`
   - Name: `Test User`
4. **Als neuer Benutzer einloggen**
5. **Wissensdatenbank öffnen** → Sollte Admin's Wissensdatenbanken sehen

## 🎯 Erwartetes Verhalten

### Für Administratoren:
- ✅ Sieht **alle** Wissensdatenbanken der Company
- ✅ Kann **neue Team-Mitglieder** erstellen
- ✅ Kann **AI-Konfigurationen** bearbeiten
- ✅ Kann **Dokumente** zu allen Company-KBs hochladen
- ✅ Sieht **aggregierte Statistiken** aller Team-Mitglieder

### Für normale Benutzer:
- ✅ Sieht **alle** Wissensdatenbanken der Company
- ✅ Kann **Dokumente** hochladen
- ✅ Kann **AI-Konfigurationen** bearbeiten
- ✅ Kann **eigene** Wissensdatenbanken erstellen
- ❌ Kann **KEINE** neuen Benutzer erstellen
- ❌ Kann fremde Dokumente **NICHT** löschen

## 🔍 Verifizierung

### Prüfe ob Migrations erfolgreich waren:

```sql
-- 1. Prüfe company_id in knowledge_bases
SELECT 
  kb.name,
  kb.company_id,
  c.name as company_name
FROM knowledge_bases kb
LEFT JOIN companies c ON c.id = kb.company_id
LIMIT 5;

-- 2. Prüfe Trigger
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name LIKE '%company_id%';

-- 3. Prüfe RLS Policies
SELECT tablename, policyname
FROM pg_policies
WHERE tablename = 'knowledge_bases';
```

Erwartetes Ergebnis:
- ✅ Alle Knowledge Bases haben `company_id`
- ✅ Mehrere Trigger mit Namen wie `trigger_auto_populate_company_id_*`
- ✅ Policies wie `Users can view company knowledge bases`

## 🐛 Troubleshooting

### Problem: "Keine Berechtigung"
**Lösung:** Prüfe ob Benutzer in `company_admins` Tabelle ist:
```sql
SELECT * FROM company_admins WHERE user_id = 'YOUR_USER_ID';
```

### Problem: "company_id ist NULL"
**Lösung:** Trigger prüfen oder manuell setzen:
```sql
-- Bestehende Daten aktualisieren
UPDATE knowledge_bases kb
SET company_id = p.company_id
FROM profiles p
WHERE kb.user_id = p.id AND kb.company_id IS NULL;
```

### Problem: "Benutzer sieht keine anderen Wissensdatenbanken"
**Lösung:** 
1. Prüfe ob RLS Policies aktiv sind
2. Prüfe ob beide Benutzer dieselbe `company_id` haben:
```sql
SELECT id, email, company_id 
FROM profiles 
WHERE email IN ('admin@firma.de', 'user@firma.de');
```

### Problem: "E-Mail-Domain muss X sein"
**Lösung:** Neue Team-Mitglieder müssen dieselbe E-Mail-Domain haben wie der Admin

## 📚 Weitere Informationen

**Vollständige Dokumentation:**
- `docs/COMPANY_SHARING_IMPLEMENTATION.md` - Technische Details
- `supabase/migrations/202510020000*.sql` - Datenbank-Schema

**Wichtige Tabellen:**
- `companies` - Unternehmens-Informationen
- `company_admins` - Admin-Berechtigungen
- `profiles` - Benutzer-Profile mit `company_id`
- `knowledge_bases`, `documents`, `knowledge_items` - Wissensdatenbank mit `company_id`

**API Endpoints:**
- `GET /api/team-members` - Team-Liste
- `POST /api/team-members` - Mitglied erstellen
- `DELETE /api/team-members?userId=X` - Mitglied löschen

## ✅ Deployment Checklist

- [ ] Migrations in Supabase ausgeführt
- [ ] Verifizierung erfolgreich (siehe oben)
- [ ] Team-Management in Dashboard integriert
- [ ] Getestet mit Admin und normalem Benutzer
- [ ] RLS Policies funktionieren
- [ ] Dokumentation gelesen

## 🎉 Fertig!

Ihr Company-Wide Data Sharing System ist jetzt einsatzbereit!

**Nächste Schritte:**
1. Erste Benutzer erstellen
2. Wissensdatenbanken teilen
3. AI-Konfigurationen gemeinsam nutzen
4. Team erweitern

Bei Fragen: Siehe `docs/COMPANY_SHARING_IMPLEMENTATION.md` für Details.

---

**Viel Erfolg! 🚀**




