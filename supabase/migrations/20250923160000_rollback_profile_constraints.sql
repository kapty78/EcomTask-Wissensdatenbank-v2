-- Rollback migration - Remove profile constraints that are blocking registration
-- Migration: 20250923160000_rollback_profile_constraints.sql

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

-- Step 2: Drop the validation trigger if it exists
DROP TRIGGER IF EXISTS trigger_validate_profile_integrity ON public.profiles;
RAISE NOTICE 'Removed profile integrity trigger';

-- Step 3: Drop the audit trigger if it exists
DROP TRIGGER IF EXISTS trigger_audit_profile_changes ON public.profiles;
RAISE NOTICE 'Removed profile audit trigger';

-- Step 4: Drop the validation function if it exists
DROP FUNCTION IF EXISTS validate_profile_integrity();
RAISE NOTICE 'Removed profile integrity validation function';

-- Step 5: Drop the audit function if it exists
DROP FUNCTION IF EXISTS audit_profile_changes();
RAISE NOTICE 'Removed profile audit function';

-- Step 6: Drop the audit table if it exists
DROP TABLE IF EXISTS profile_audit_log;
RAISE NOTICE 'Removed profile audit log table';

-- Step 7: Remove any check constraints that might be causing issues
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'profiles_email_limit_check'
    ) THEN
        ALTER TABLE public.profiles DROP CONSTRAINT profiles_email_limit_check;
        RAISE NOTICE 'Removed email limit check constraint';
    END IF;
END $$;

-- Step 8: Clean up any indexes that might be causing conflicts
DROP INDEX IF EXISTS idx_profiles_email_limit;
DROP INDEX IF EXISTS idx_profile_audit_log_profile_id;
DROP INDEX IF EXISTS idx_profile_audit_log_changed_at;

RAISE NOTICE 'Profile constraints rollback completed successfully - registration should work again';



