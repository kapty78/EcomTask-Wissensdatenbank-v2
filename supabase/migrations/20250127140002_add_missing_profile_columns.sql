-- Migration: Add missing columns to profiles table
-- These columns are needed for user limits in the admin panel

-- Add knowledge_base_limit column
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS knowledge_base_limit INTEGER DEFAULT 5;

-- Add email_account_limit column  
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS email_account_limit INTEGER DEFAULT 3;

-- Add comment for documentation
COMMENT ON COLUMN profiles.knowledge_base_limit IS 'Maximum number of knowledge bases a user can create';
COMMENT ON COLUMN profiles.email_account_limit IS 'Maximum number of email accounts a user can connect';
