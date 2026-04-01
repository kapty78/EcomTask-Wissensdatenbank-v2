-- Fix users loading issue in admin panel
-- Migration: 20250123000003_fix_users_loading.sql

-- Drop and recreate the function with better error handling
DROP FUNCTION IF EXISTS public.get_all_users_with_permissions(UUID);

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
    -- Debug: Log the admin_user_id
    RAISE NOTICE 'Admin user ID: %', admin_user_id;
    
    -- Check if requesting user is super admin
    SELECT COALESCE(is_super_admin, false) INTO admin_check
    FROM public.profiles 
    WHERE id = admin_user_id;
    
    -- Debug: Log the admin check result
    RAISE NOTICE 'Admin check result: %', admin_check;
    
    -- If not super admin, return empty result
    IF admin_check IS NULL OR admin_check = false THEN
        RAISE NOTICE 'User is not super admin, returning empty result';
        RETURN;
    END IF;

    -- Debug: Log that we're returning results
    RAISE NOTICE 'User is super admin, returning all users';

    RETURN QUERY
    SELECT 
        p.id as user_id,
        COALESCE(p.email, '') as email,
        p.full_name,
        COALESCE(p.can_upload, false) as can_upload,
        COALESCE(p.is_super_admin, false) as is_super_admin,
        p.company_name,
        COALESCE(p.email_limit, 2000) as email_limit
    FROM public.profiles p
    WHERE p.id IS NOT NULL
    ORDER BY p.email NULLS LAST;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_all_users_with_permissions(UUID) TO authenticated;

-- Also ensure the email limit function is properly created
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
BEGIN
    -- Check if admin user exists and is super admin
    SELECT COALESCE(is_super_admin, false) INTO admin_check
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.set_user_email_limit(UUID, UUID, integer) TO authenticated; 