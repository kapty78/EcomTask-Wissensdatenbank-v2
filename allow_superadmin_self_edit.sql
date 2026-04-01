-- Allow super admins to edit their own email limits
-- This ensures super admins can modify their own email limits

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
    target_is_super_admin boolean := false;
BEGIN
    -- Check if admin user exists and is super admin
    SELECT p.is_super_admin INTO admin_check
    FROM public.profiles p 
    WHERE p.id = admin_user_id;
    
    -- Only super admins can modify email limits
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

    -- Check if target user is also a super admin
    SELECT p.is_super_admin INTO target_is_super_admin
    FROM public.profiles p 
    WHERE p.id = target_user_id;

    -- Super admins can edit:
    -- 1. Their own email limit
    -- 2. Any other user's email limit (including other super admins)
    -- This allows full flexibility for super admin management

    -- Update the email limit
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
GRANT EXECUTE ON FUNCTION public.set_user_email_limit(UUID, UUID, integer) TO authenticated; 