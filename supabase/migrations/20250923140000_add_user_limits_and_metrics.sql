-- Migration: Erweitern der profiles Tabelle um Limits und Executive Report Einstellungen (ohne Token-Tracking)
-- Datum: 2025-09-23

-- 1. profiles Tabelle erweitern
ALTER TABLE public.profiles
ADD COLUMN knowledge_base_limit integer DEFAULT 5 CHECK (knowledge_base_limit >= 0),
ADD COLUMN email_account_limit integer DEFAULT 3 CHECK (email_account_limit >= 0),
ADD COLUMN executive_report_enabled boolean DEFAULT false,
ADD COLUMN executive_report_frequency character varying DEFAULT 'monthly' CHECK (executive_report_frequency IN ('weekly', 'monthly', 'quarterly')),
ADD COLUMN executive_report_email text;

-- 2. Neue user_metrics Tabelle erstellen
CREATE TABLE public.user_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  total_process_logs integer DEFAULT 0,
  avg_first_response_time numeric,
  last_activity_at timestamp with time zone,
  last_email_processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_metrics_pkey PRIMARY KEY (id),
  CONSTRAINT user_metrics_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_metrics_user_id_unique UNIQUE (user_id)
);

-- 3. process_logs Tabelle erweitern für Metriken
ALTER TABLE public.process_logs
ADD COLUMN first_response_time numeric;

-- 4. Index für Performance
CREATE INDEX idx_user_metrics_user_id ON public.user_metrics(user_id);
CREATE INDEX idx_process_logs_first_response_time ON public.process_logs(first_response_time);
