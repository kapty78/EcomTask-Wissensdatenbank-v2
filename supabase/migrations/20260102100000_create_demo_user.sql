-- ============================================================================
-- Demo User für OpenAI App Review erstellen
-- ============================================================================
-- WICHTIG: Führe dieses Skript im Supabase SQL Editor aus
-- 
-- SCHRITT 1: Zuerst im Supabase Dashboard einen User erstellen:
--   - Authentication → Users → "Add user"
--   - Email: demo@ecomtask.cloud
--   - Password: Demo2024!
--   - "Auto Confirm User" aktivieren!
--
-- SCHRITT 2: Dann dieses SQL ausführen
-- ============================================================================

-- Variablen setzen (passe diese an!)
DO $$
DECLARE
    demo_user_id UUID;
    demo_company_id UUID;
    demo_kb_id UUID;
BEGIN
    -- ========================================================================
    -- 1. Demo User ID finden (nach dem manuellen Erstellen im Dashboard)
    -- ========================================================================
    SELECT id INTO demo_user_id 
    FROM auth.users 
    WHERE email = 'demo@ecomtask.cloud'
    LIMIT 1;
    
    IF demo_user_id IS NULL THEN
        RAISE EXCEPTION 'Demo User nicht gefunden! Bitte zuerst im Supabase Dashboard erstellen.';
    END IF;
    
    RAISE NOTICE 'Demo User gefunden: %', demo_user_id;

    -- ========================================================================
    -- 2. Demo Company erstellen oder finden
    -- ========================================================================
    SELECT id INTO demo_company_id 
    FROM companies 
    WHERE domain = 'demo.app.ecomtask.cloud'
    LIMIT 1;
    
    IF demo_company_id IS NULL THEN
        INSERT INTO companies (name, domain)
        VALUES ('Demo Company', 'demo.app.ecomtask.cloud')
        RETURNING id INTO demo_company_id;
        
        RAISE NOTICE 'Demo Company erstellt: %', demo_company_id;
    ELSE
        RAISE NOTICE 'Demo Company gefunden: %', demo_company_id;
    END IF;

    -- ========================================================================
    -- 3. Profil für Demo User erstellen/aktualisieren
    -- ========================================================================
    INSERT INTO profiles (id, company_id, full_name, role)
    VALUES (demo_user_id, demo_company_id, 'Demo User', 'admin')
    ON CONFLICT (id) DO UPDATE SET
        company_id = demo_company_id,
        full_name = 'Demo User',
        role = 'admin';
    
    RAISE NOTICE 'Profil erstellt/aktualisiert für User: %', demo_user_id;

    -- ========================================================================
    -- 4. Demo Knowledge Base erstellen oder finden
    -- ========================================================================
    SELECT id INTO demo_kb_id 
    FROM knowledge_bases 
    WHERE company_id = demo_company_id
    LIMIT 1;
    
    IF demo_kb_id IS NULL THEN
        INSERT INTO knowledge_bases (name, description, company_id, user_id)
        VALUES (
            'Demo Wissensdatenbank',
            'Test-Wissensdatenbank für OpenAI App Review',
            demo_company_id,
            demo_user_id
        )
        RETURNING id INTO demo_kb_id;
        
        RAISE NOTICE 'Demo Knowledge Base erstellt: %', demo_kb_id;
    ELSE
        RAISE NOTICE 'Demo Knowledge Base gefunden: %', demo_kb_id;
    END IF;

    -- ========================================================================
    -- 5. User Zugriff auf Knowledge Base (übersprungen - User ist bereits Owner)
    -- ========================================================================
    RAISE NOTICE 'User hat Zugriff als Owner der Knowledge Base';

    -- ========================================================================
    -- 6. Test-Daten (übersprungen - manuell über UI hinzufügen)
    -- ========================================================================
    RAISE NOTICE 'Knowledge Base erstellt - Daten können über die App hinzugefügt werden';

    -- ========================================================================
    -- FERTIG!
    -- ========================================================================
    RAISE NOTICE '========================================';
    RAISE NOTICE 'DEMO USER SETUP KOMPLETT!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Email: demo@ecomtask.cloud';
    RAISE NOTICE 'Password: Demo2024!';
    RAISE NOTICE 'Company: Demo Company';
    RAISE NOTICE 'Knowledge Base: Demo Wissensdatenbank';
    RAISE NOTICE '========================================';
    
END $$;

-- ============================================================================
-- Verifizierung: Prüfe ob alles geklappt hat
-- ============================================================================
SELECT 
    u.email,
    p.full_name,
    p.role,
    c.name as company_name,
    kb.name as knowledge_base_name,
    (SELECT COUNT(*) FROM knowledge_items ki WHERE ki.knowledge_base_id = kb.id) as item_count
FROM auth.users u
JOIN profiles p ON p.id = u.id
JOIN companies c ON c.id = p.company_id
LEFT JOIN knowledge_bases kb ON kb.company_id = c.id
WHERE u.email = 'demo@ecomtask.cloud';
