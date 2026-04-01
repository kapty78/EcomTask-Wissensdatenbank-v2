-- Migration: Fix user_solution_flags unique constraint
-- Problem: The constraint "unique_company_solution_flags" was on company_id,
-- which prevents multiple users from being assigned to the same company.
-- Solution: Change the constraint to be on user_id instead (one entry per user).

-- Step 1: Drop the incorrect constraint on company_id
ALTER TABLE public.user_solution_flags 
DROP CONSTRAINT IF EXISTS unique_company_solution_flags;

-- Step 2: Add the correct unique constraint on user_id
-- (This ensures each user can only have one solution flags entry)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_user_solution_flags'
    ) THEN
        ALTER TABLE public.user_solution_flags 
        ADD CONSTRAINT unique_user_solution_flags UNIQUE (user_id);
    END IF;
END $$;

-- Step 3: Add an index on company_id for performance (without uniqueness)
CREATE INDEX IF NOT EXISTS idx_user_solution_flags_company_id 
ON public.user_solution_flags(company_id);

-- Verification: Show the current constraints
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint 
WHERE conrelid = 'public.user_solution_flags'::regclass;
