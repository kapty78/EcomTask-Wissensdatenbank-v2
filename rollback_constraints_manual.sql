-- COPY THIS INTO SUPABASE SQL EDITOR AND RUN IT
-- This will remove all constraints that are blocking registration

-- Step 1: Drop the unique constraint on email if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'profiles_email_unique' 
        AND table_name = 'profiles'
    ) THEN
        ALTER TABLE public.profiles DROP CONSTRAINT profiles_email_unique;
        RAISE NOTICE 'Removed unique constraint on profiles.email';
    ELSE
        RAISE NOTICE 'Unique constraint on profiles.email does not exist';
    END IF;
END $$;

-- Step 2: Drop triggers
DROP TRIGGER IF EXISTS trigger_validate_profile_integrity ON public.profiles;
DROP TRIGGER IF EXISTS trigger_audit_profile_changes ON public.profiles;

-- Step 3: Drop functions
DROP FUNCTION IF EXISTS validate_profile_integrity();
DROP FUNCTION IF EXISTS audit_profile_changes();

-- Step 4: Drop audit table
DROP TABLE IF EXISTS profile_audit_log;

-- Step 5: Clean up indexes
DROP INDEX IF EXISTS idx_profiles_email_limit;
DROP INDEX IF EXISTS idx_profile_audit_log_profile_id;
DROP INDEX IF EXISTS idx_profile_audit_log_changed_at;

-- Verification: Check if constraints are gone
SELECT 
    constraint_name, 
    constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'profiles' 
AND constraint_name LIKE '%email%';



