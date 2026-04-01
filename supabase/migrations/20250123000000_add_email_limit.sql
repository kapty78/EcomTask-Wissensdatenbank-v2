-- Add email limit functionality for user plans
-- Migration: 20250123000000_add_email_limit.sql

-- Add email_limit column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN email_limit integer DEFAULT 2000 CHECK (email_limit >= 0);

-- Create index for performance
CREATE INDEX idx_profiles_email_limit ON public.profiles(email_limit);

-- Function for super admin to set email limit (plan management)
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
    result json;
BEGIN
    -- Check if the admin user is a super admin
    IF NOT public.user_is_super_admin(admin_user_id) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Permission denied: Only super admins can modify email limits'
        );
    END IF;

    -- Validate email limit (must be non-negative)
    IF email_limit_new < 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Email limit must be 0 or greater'
        );
    END IF;

    -- Update the target user's email limit
    UPDATE public.profiles 
    SET email_limit = email_limit_new, updated_at = NOW()
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

-- Update the existing function to include email_limit
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
BEGIN
    -- Check if the requesting user is a super admin
    IF NOT public.user_is_super_admin(admin_user_id) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        p.id as user_id,
        p.email,
        p.full_name,
        p.can_upload,
        p.is_super_admin,
        p.company_name,
        p.email_limit
    FROM public.profiles p
    ORDER BY p.email;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.set_user_email_limit(UUID, UUID, integer) TO authenticated;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.email_limit IS 'Maximum number of emails allowed for this user per month (plan management)';
COMMENT ON FUNCTION public.set_user_email_limit(UUID, UUID, integer) IS 'Allows super admins to set email limits for users (plan management)';

-- Set default email limits for existing users
UPDATE public.profiles 
SET email_limit = CASE 
    WHEN is_super_admin = true THEN 999999  -- Unlimited for super admins
    WHEN can_upload = true THEN 2000        -- Standard plan for users with upload permissions
    ELSE 500                                -- Basic plan for others
END 
WHERE email_limit IS NULL; 