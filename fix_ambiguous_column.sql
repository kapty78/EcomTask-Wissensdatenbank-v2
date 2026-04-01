-- Fix ambiguous column reference in get_all_users_with_permissions function
-- This resolves the "column reference is_super_admin is ambiguous" error

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
    -- Check if requesting user is super admin (explicitly qualify column)
    SELECT p.is_super_admin INTO admin_check
    FROM public.profiles p 
    WHERE p.id = admin_user_id;
    
    -- If not super admin, return empty result
    IF COALESCE(admin_check, false) = false THEN
        RETURN;
    END IF;

    -- Return all users with explicitly qualified columns
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

-- Recreate the email limit function with explicit column qualification
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
    -- Check if admin user exists and is super admin (explicitly qualify column)
    SELECT p.is_super_admin INTO admin_check
    FROM public.profiles p 
    WHERE p.id = admin_user_id;
    
    IF COALESCE(admin_check, false) = false THEN
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

    -- Update the email limit (explicitly qualify columns)
    UPDATE public.profiles p
    SET email_limit = email_limit_new, 
        updated_at = NOW()
    WHERE p.id = target_user_id;

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
GRANT EXECUTE ON FUNCTION public.get_all_users_with_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_email_limit(UUID, UUID, integer) TO authenticated; 