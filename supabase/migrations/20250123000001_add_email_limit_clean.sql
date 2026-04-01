-- Clean migration for email limit functionality
-- Migration: 20250123000001_add_email_limit_clean.sql

-- Step 1: Add email_limit column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles' 
        AND column_name = 'email_limit'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN email_limit integer DEFAULT 2000;
        RAISE NOTICE 'email_limit column added to profiles table';
    ELSE
        RAISE NOTICE 'email_limit column already exists';
    END IF;
END $$;

-- Step 2: Add check constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'profiles_email_limit_check'
    ) THEN
        ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_limit_check CHECK (email_limit >= 0);
        RAISE NOTICE 'Check constraint added for email_limit';
    ELSE
        RAISE NOTICE 'Check constraint already exists';
    END IF;
END $$;

-- Step 3: Create index if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'profiles' 
        AND indexname = 'idx_profiles_email_limit'
    ) THEN
        CREATE INDEX idx_profiles_email_limit ON public.profiles(email_limit);
        RAISE NOTICE 'Index created for email_limit';
    ELSE
        RAISE NOTICE 'Index already exists';
    END IF;
END $$;

-- Step 4: Create or replace the email limit function
CREATE OR REPLACE FUNCTION public.set_user_email_limit(
    admin_user_id UUID,
    target_user_id UUID,
    email_limit_new integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    admin_check boolean := false;
    result json;
BEGIN
    -- Check if admin user exists and is super admin
    SELECT is_super_admin INTO admin_check
    FROM public.profiles 
    WHERE id = admin_user_id;
    
    IF admin_check IS NULL OR admin_check = false THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Permission denied: Only super admins can modify email limits'
        );
    END IF;

    -- Validate email limit
    IF email_limit_new < 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Email limit must be 0 or greater'
        );
    END IF;

    -- Update the email limit
    UPDATE public.profiles 
    SET email_limit = email_limit_new, 
        updated_at = NOW()
    WHERE id = target_user_id;

    -- Check if update was successful
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User not found'
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'message', 'Email limit updated successfully'
    );
END;
$$;

-- Step 5: Update the get_all_users_with_permissions function
CREATE OR REPLACE FUNCTION public.get_all_users_with_permissions(admin_user_id UUID)
RETURNS TABLE (
    user_id UUID,
    email text,
    full_name text,
    can_upload boolean,
    is_super_admin boolean,
    company_name text,
    email_limit integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    admin_check boolean := false;
BEGIN
    -- Check if requesting user is super admin
    SELECT is_super_admin INTO admin_check
    FROM public.profiles 
    WHERE id = admin_user_id;
    
    IF admin_check IS NULL OR admin_check = false THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        p.id as user_id,
        p.email,
        p.full_name,
        COALESCE(p.can_upload, false) as can_upload,
        COALESCE(p.is_super_admin, false) as is_super_admin,
        p.company_name,
        COALESCE(p.email_limit, 2000) as email_limit
    FROM public.profiles p
    ORDER BY p.email;
END;
$$;

-- Step 6: Grant permissions
GRANT EXECUTE ON FUNCTION public.set_user_email_limit(UUID, UUID, integer) TO authenticated;

-- Step 7: Set default email limits for users who have NULL
UPDATE public.profiles 
SET email_limit = CASE 
    WHEN is_super_admin = true THEN 999999
    WHEN can_upload = true THEN 2000
    ELSE 500
END 
WHERE email_limit IS NULL;

-- Step 8: Add documentation
COMMENT ON COLUMN public.profiles.email_limit IS 'Maximum number of emails allowed for this user per month (plan management)';
COMMENT ON FUNCTION public.set_user_email_limit(UUID, UUID, integer) IS 'Allows super admins to set email limits for users (plan management)';

-- Migration completed
RAISE NOTICE 'Email limit migration completed successfully'; 