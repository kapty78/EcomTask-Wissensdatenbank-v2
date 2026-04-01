-- Add upload permissions and super admin functionality
-- Migration: 20250120000000_add_upload_permissions.sql

-- Add new columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN can_upload boolean DEFAULT false,
ADD COLUMN is_super_admin boolean DEFAULT false;

-- Set tom.pierce@ecomtask.de as super admin with upload permissions
UPDATE public.profiles 
SET is_super_admin = true, can_upload = true 
WHERE email = 'tom.pierce@ecomtask.de';

-- Create index for performance
CREATE INDEX idx_profiles_can_upload ON public.profiles(can_upload);
CREATE INDEX idx_profiles_is_super_admin ON public.profiles(is_super_admin);

-- Function to check if user can upload
CREATE OR REPLACE FUNCTION public.user_can_upload(user_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    can_upload_result boolean := false;
BEGIN
    SELECT p.can_upload INTO can_upload_result
    FROM public.profiles p
    WHERE p.id = user_id;
    
    RETURN COALESCE(can_upload_result, false);
END;
$$;

-- Function to check if user is super admin
CREATE OR REPLACE FUNCTION public.user_is_super_admin(user_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    is_admin_result boolean := false;
BEGIN
    SELECT p.is_super_admin INTO is_admin_result
    FROM public.profiles p
    WHERE p.id = user_id;
    
    RETURN COALESCE(is_admin_result, false);
END;
$$;

-- Function for super admin to grant/revoke upload permissions
CREATE OR REPLACE FUNCTION public.set_user_upload_permission(
    admin_user_id UUID,
    target_user_id UUID,
    can_upload_new boolean
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
            'error', 'Permission denied: Only super admins can modify upload permissions'
        );
    END IF;

    -- Update the target user's upload permission
    UPDATE public.profiles 
    SET can_upload = can_upload_new, updated_at = NOW()
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
        'message', 'Upload permission updated successfully'
    );
END;
$$;

-- Function to get all users with their upload permissions (super admin only)
CREATE OR REPLACE FUNCTION public.get_all_users_with_permissions(admin_user_id UUID)
RETURNS TABLE (
    user_id UUID,
    email text,
    full_name text,
    can_upload boolean,
    is_super_admin boolean,
    company_name text
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
        p.company_name
    FROM public.profiles p
    ORDER BY p.email;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.user_can_upload(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_super_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_upload_permission(UUID, UUID, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_users_with_permissions(UUID) TO authenticated;

-- Update RLS policies for knowledge_items to check upload permission
DROP POLICY IF EXISTS "Users can create knowledge items" ON public.knowledge_items;
CREATE POLICY "Users can create knowledge items" ON public.knowledge_items
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND 
        public.user_can_upload(auth.uid())
    );

-- Update RLS policies for documents to check upload permission  
DROP POLICY IF EXISTS "Users can create documents" ON public.documents;
CREATE POLICY "Users can create documents" ON public.documents
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND 
        public.user_can_upload(auth.uid())
    );

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.can_upload IS 'Whether the user is allowed to upload documents and create knowledge items';
COMMENT ON COLUMN public.profiles.is_super_admin IS 'Whether the user has super admin privileges to manage other users permissions';
COMMENT ON FUNCTION public.set_user_upload_permission(UUID, UUID, boolean) IS 'Allows super admins to grant or revoke upload permissions for other users';
COMMENT ON FUNCTION public.get_all_users_with_permissions(UUID) IS 'Returns all users with their permissions - only accessible by super admins'; 