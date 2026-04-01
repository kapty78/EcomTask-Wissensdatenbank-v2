-- Create project_responsibilities table
CREATE TABLE IF NOT EXISTS public.project_responsibilities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'responsible', -- could be extended with different roles like 'owner', 'contributor', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(project_id, user_id)
);

-- Add RLS policies
ALTER TABLE public.project_responsibilities ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "View project responsibilities" ON public.project_responsibilities;
DROP POLICY IF EXISTS "Manage project responsibilities" ON public.project_responsibilities;

-- Allow users to view project responsibilities if they are workspace members
CREATE POLICY "View project responsibilities" ON public.project_responsibilities
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            JOIN public.projects p ON p.workspace_id = wm.workspace_id
            WHERE p.id = project_responsibilities.project_id
            AND wm.user_id = auth.uid()
        )
    );

-- Allow workspace members to manage project responsibilities
CREATE POLICY "Manage project responsibilities" ON public.project_responsibilities
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            JOIN public.projects p ON p.workspace_id = wm.workspace_id
            WHERE p.id = project_responsibilities.project_id
            AND wm.user_id = auth.uid()
            AND wm.role IN ('owner', 'admin')
        )
    );

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.get_assignable_users(UUID);

-- Create function to get workspace members for project assignment
CREATE OR REPLACE FUNCTION public.get_assignable_users(input_project_id UUID)
RETURNS TABLE (
    user_id UUID,
    full_name TEXT,
    email TEXT
)
AS $$
BEGIN
    -- First, check if the calling user has access to the project's workspace
    IF NOT EXISTS (
        SELECT 1 
        FROM public.projects p
        JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
        WHERE p.id = input_project_id 
        AND wm.user_id = auth.uid()
    ) THEN
        RETURN;
    END IF;

    -- If access is granted, return the assignable users
    RETURN QUERY
    SELECT DISTINCT 
        u.id as user_id,
        p.full_name,
        u.email
    FROM public.projects proj
    JOIN public.workspace_members wm ON wm.workspace_id = proj.workspace_id
    JOIN auth.users u ON u.id = wm.user_id
    JOIN public.profiles p ON p.id = u.id
    WHERE proj.id = input_project_id
    AND NOT EXISTS (
        SELECT 1 
        FROM public.project_responsibilities pr
        WHERE pr.project_id = input_project_id
        AND pr.user_id = u.id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION public.get_assignable_users(UUID) TO authenticated;

-- Drop existing view if exists
DROP VIEW IF EXISTS public.project_responsibilities_with_users;

-- Create a view to simplify querying project responsibilities with user information
CREATE OR REPLACE VIEW public.project_responsibilities_with_users AS
SELECT 
    pr.id,
    pr.project_id,
    pr.user_id,
    pr.role,
    pr.created_at,
    pr.updated_at,
    p.full_name,
    u.email
FROM public.project_responsibilities pr
JOIN auth.users u ON u.id = pr.user_id
JOIN public.profiles p ON p.id = pr.user_id;

-- Grant permissions on the view
GRANT SELECT ON public.project_responsibilities_with_users TO authenticated;

-- Enable RLS for projects table
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view workspace projects" ON public.projects;
DROP POLICY IF EXISTS "Users can create workspace projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update workspace projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete workspace projects" ON public.projects;
DROP POLICY IF EXISTS "Users can manage workspace projects" ON public.projects;

-- Create policies for projects
CREATE POLICY "Users can view workspace projects"
    ON public.projects
    FOR SELECT
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM public.workspace_members 
            WHERE user_id = auth.uid()
        )
    );

-- Allow creation of projects for authenticated users if they are members of the workspace
CREATE POLICY "Users can create workspace projects"
    ON public.projects
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        -- User must be a member of the target workspace
        workspace_id IN (
            SELECT wm.workspace_id
            FROM public.workspace_members wm
            WHERE wm.user_id = auth.uid()
            -- Compare member workspace_id with the workspace_id of the NEW row
            AND wm.workspace_id = workspace_id
        )
    );

-- Allow only admins and owners to update projects
CREATE POLICY "Users can update workspace projects"
    ON public.projects
    FOR UPDATE
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM public.workspace_members 
            WHERE user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
    )
    WITH CHECK (
        workspace_id IN (
            SELECT workspace_id 
            FROM public.workspace_members 
            WHERE user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
    );

-- Allow only admins and owners to delete projects
CREATE POLICY "Users can delete workspace projects"
    ON public.projects
    FOR DELETE
    USING (
        workspace_id IN (
            SELECT workspace_id 
            FROM public.workspace_members 
            WHERE user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
    ); 