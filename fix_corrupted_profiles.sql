-- Script to fix corrupted profile data
-- This script should be run manually to repair the data corruption issue
-- where "Elias Durst" and "endless bikes" data was mixed up

-- STEP 1: First, let's see the current state of affected profiles
SELECT 
    id,
    email,
    full_name,
    company_name,
    created_at,
    updated_at
FROM profiles 
WHERE email IN ('ai.ecomtask@gmail.com', 'endless_bikes@ecomtask.de')
ORDER BY email;

-- STEP 2: Identify the correct mappings
-- Based on the issue description:
-- - ai.ecomtask@gmail.com should have full_name = "Elias Durst" and company_name should be restored
-- - endless_bikes@ecomtask.de should have full_name = "Elias Durst" and company_name = "endless bikes"

-- STEP 3: Get the user IDs from auth.users to ensure we're working with the right records
SELECT 
    au.id as user_id,
    au.email as auth_email,
    p.email as profile_email,
    p.full_name,
    p.company_name
FROM auth.users au
LEFT JOIN profiles p ON au.id = p.id
WHERE au.email IN ('ai.ecomtask@gmail.com', 'endless_bikes@ecomtask.de')
ORDER BY au.email;

-- STEP 4: Manual correction (UNCOMMENT AND MODIFY AS NEEDED)
/*
-- Fix the ai.ecomtask@gmail.com profile 
-- (You'll need to determine the correct company name from your records)
UPDATE profiles 
SET 
    full_name = 'Elias Durst',
    company_name = '[CORRECT_COMPANY_NAME_FOR_AI_ECOMTASK]', -- Replace with actual company name
    updated_at = NOW()
WHERE email = 'ai.ecomtask@gmail.com';

-- Fix the endless_bikes@ecomtask.de profile
UPDATE profiles 
SET 
    full_name = 'Elias Durst', -- Or whatever the correct name should be
    company_name = 'endless bikes',
    updated_at = NOW()
WHERE email = 'endless_bikes@ecomtask.de';
*/

-- STEP 5: Verify the fixes
SELECT 
    'After Fix' as status,
    id,
    email,
    full_name,
    company_name,
    updated_at
FROM profiles 
WHERE email IN ('ai.ecomtask@gmail.com', 'endless_bikes@ecomtask.de')
ORDER BY email;

-- STEP 6: Check for any other potential data corruption
-- Look for profiles where the email domain doesn't match the expected pattern
SELECT 
    id,
    email,
    full_name,
    company_name,
    created_at,
    updated_at,
    CASE 
        WHEN email LIKE '%@ecomtask.de' AND company_name NOT LIKE '%ecomtask%' THEN 'Potential mismatch'
        WHEN email LIKE '%@ecomtask.com' AND company_name NOT LIKE '%ecomtask%' THEN 'Potential mismatch'
        ELSE 'OK'
    END as status_check
FROM profiles 
WHERE email IS NOT NULL
ORDER BY updated_at DESC
LIMIT 20;
