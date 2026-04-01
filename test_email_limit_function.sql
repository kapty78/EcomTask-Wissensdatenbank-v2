-- Test SQL to verify the get_all_users_with_permissions function
-- Run this in Supabase SQL Editor to debug

-- 1. Check if function exists
SELECT proname, proargnames, proargtypes 
FROM pg_proc 
WHERE proname = 'get_all_users_with_permissions';

-- 2. Check profiles table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- 3. Check if there are any profiles with email_limit
SELECT id, email, is_super_admin, can_upload, email_limit
FROM public.profiles
LIMIT 5;

-- 4. Test the function manually with a known super admin user ID
-- Replace 'YOUR_SUPER_ADMIN_ID' with actual user ID
-- SELECT * FROM public.get_all_users_with_permissions('YOUR_SUPER_ADMIN_ID');

-- 5. Find super admin users
SELECT id, email, is_super_admin 
FROM public.profiles 
WHERE is_super_admin = true; 