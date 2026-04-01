export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      ai_agent_configurations: {
        Row: {
          alleinstellungsmerkmale: string | null
          anrede: string | null
          antwortlaenge: string | null
          benutzerdefinierte_branche: string | null
          besondere_eigenheiten_tabus_zielgruppe: string | null
          branche: string | null
          created_at: string
          description: string | null
          edge_cases_regeln: string | null
          email_direct_send: boolean | null
          email_struktur: string | null
          empathie_grad: string | null
          firmen_werte: string | null
          firmenname: string | null
          formalitaetsgrad: string | null
          generated_prompt: string | null
          geschaeftstage: string | null
          geschaeftszeiten_ende: string | null
          geschaeftszeiten_start: string | null
          haeufige_phrasen: string | null
          id: string
          is_active: boolean
          name: string
          notfall_protokoll: string | null
          ordner_logik: string | null
          signatur: string | null
          technisches_level: string | null
          time_per_ticket: number | null
          ton: string | null
          updated_at: string
          user_id: string
          verbotene_begriffe: string | null
          verbotene_themen: string | null
          zielgruppe: string | null
        }
        Insert: {
          alleinstellungsmerkmale?: string | null
          anrede?: string | null
          antwortlaenge?: string | null
          benutzerdefinierte_branche?: string | null
          besondere_eigenheiten_tabus_zielgruppe?: string | null
          branche?: string | null
          created_at?: string
          description?: string | null
          edge_cases_regeln?: string | null
          email_direct_send?: boolean | null
          email_struktur?: string | null
          empathie_grad?: string | null
          firmen_werte?: string | null
          firmenname?: string | null
          formalitaetsgrad?: string | null
          generated_prompt?: string | null
          geschaeftstage?: string | null
          geschaeftszeiten_ende?: string | null
          geschaeftszeiten_start?: string | null
          haeufige_phrasen?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notfall_protokoll?: string | null
          ordner_logik?: string | null
          signatur?: string | null
          technisches_level?: string | null
          time_per_ticket?: number | null
          ton?: string | null
          updated_at?: string
          user_id: string
          verbotene_begriffe?: string | null
          verbotene_themen?: string | null
          zielgruppe?: string | null
        }
        Update: {
          alleinstellungsmerkmale?: string | null
          anrede?: string | null
          antwortlaenge?: string | null
          benutzerdefinierte_branche?: string | null
          besondere_eigenheiten_tabus_zielgruppe?: string | null
          branche?: string | null
          created_at?: string
          description?: string | null
          edge_cases_regeln?: string | null
          email_direct_send?: boolean | null
          email_struktur?: string | null
          empathie_grad?: string | null
          firmen_werte?: string | null
          firmenname?: string | null
          formalitaetsgrad?: string | null
          generated_prompt?: string | null
          geschaeftstage?: string | null
          geschaeftszeiten_ende?: string | null
          geschaeftszeiten_start?: string | null
          haeufige_phrasen?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notfall_protokoll?: string | null
          ordner_logik?: string | null
          signatur?: string | null
          technisches_level?: string | null
          time_per_ticket?: number | null
          ton?: string | null
          updated_at?: string
          user_id?: string
          verbotene_begriffe?: string | null
          verbotene_themen?: string | null
          zielgruppe?: string | null
        }
        Relationships: []
      }
      ai_agent_configurations_backup_edge_cases: {
        Row: {
          ai_generated_edge_cases: Json | null
          id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          ai_generated_edge_cases?: Json | null
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          ai_generated_edge_cases?: Json | null
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_agent_knowledge_bases: {
        Row: {
          ai_agent_configuration_id: string
          created_at: string
          id: string
          knowledge_base_id: string
        }
        Insert: {
          ai_agent_configuration_id: string
          created_at?: string
          id?: string
          knowledge_base_id: string
        }
        Update: {
          ai_agent_configuration_id?: string
          created_at?: string
          id?: string
          knowledge_base_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_knowledge_bases_ai_agent_configuration_id_fkey"
            columns: ["ai_agent_configuration_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          domain: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain?: string | null
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_admins: {
        Row: {
          company_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      csat_responses: {
        Row: {
          created_at: string | null
          feedback: string | null
          id: string
          message_id: string
          score: number
          updated_at: string | null
          user_email_account_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          feedback?: string | null
          id?: string
          message_id: string
          score: number
          updated_at?: string | null
          user_email_account_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          feedback?: string | null
          id?: string
          message_id?: string
          score?: number
          updated_at?: string | null
          user_email_account_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "csat_responses_user_email_account_id_fkey"
            columns: ["user_email_account_id"]
            isOneToOne: false
            referencedRelation: "user_email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_activity_hours: {
        Row: {
          activity_date: string
          created_at: string | null
          emails_replied: number | null
          emails_sent: number | null
          hour_of_day: number
          id: string
          user_id: string | null
        }
        Insert: {
          activity_date: string
          created_at?: string | null
          emails_replied?: number | null
          emails_sent?: number | null
          hour_of_day: number
          id?: string
          user_id?: string | null
        }
        Update: {
          activity_date?: string
          created_at?: string | null
          emails_replied?: number | null
          emails_sent?: number | null
          hour_of_day?: number
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          chunk_size: number | null
          chunk_type: string | null
          content: string
          content_hash: string | null
          content_length: number | null
          content_position: number | null
          content_tokens: number | null
          content_tsv: unknown | null
          created_at: string | null
          document_id: string
          document_type: string | null
          embedding: string | null
          facts_count: number | null
          id: string
          instructions: string | null
          local_embedding: string | null
          processing_complete: boolean | null
          processing_duration_ms: number | null
          processing_error: string | null
          processing_method: string | null
          quality_score: number | null
          updated_at: string | null
        }
        Insert: {
          chunk_size?: number | null
          chunk_type?: string | null
          content: string
          content_hash?: string | null
          content_length?: number | null
          content_position?: number | null
          content_tokens?: number | null
          content_tsv?: unknown | null
          created_at?: string | null
          document_id: string
          document_type?: string | null
          embedding?: string | null
          facts_count?: number | null
          id?: string
          instructions?: string | null
          local_embedding?: string | null
          processing_complete?: boolean | null
          processing_duration_ms?: number | null
          processing_error?: string | null
          processing_method?: string | null
          quality_score?: number | null
          updated_at?: string | null
        }
        Update: {
          chunk_size?: number | null
          chunk_type?: string | null
          content?: string
          content_hash?: string | null
          content_length?: number | null
          content_position?: number | null
          content_tokens?: number | null
          content_tsv?: unknown | null
          created_at?: string | null
          document_id?: string
          document_type?: string | null
          embedding?: string | null
          facts_count?: number | null
          id?: string
          instructions?: string | null
          local_embedding?: string | null
          processing_complete?: boolean | null
          processing_duration_ms?: number | null
          processing_error?: string | null
          processing_method?: string | null
          quality_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_processing_status: {
        Row: {
          document_id: string
          error: string | null
          message: string | null
          progress: number
          status: string
          updated_at: string | null
        }
        Insert: {
          document_id: string
          error?: string | null
          message?: string | null
          progress?: number
          status: string
          updated_at?: string | null
        }
        Update: {
          document_id?: string
          error?: string | null
          message?: string | null
          progress?: number
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_processing_status_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content_hash: string | null
          created_at: string | null
          description: string | null
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          last_processed_at: string | null
          storage_url: string
          title: string | null
          updated_at: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string | null
          description?: string | null
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          last_processed_at?: string | null
          storage_url: string
          title?: string | null
          updated_at?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string | null
          description?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          last_processed_at?: string | null
          storage_url?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_case_prompts: {
        Row: {
          created_at: string | null
          generated_prompt: string
          id: string
          is_active: boolean | null
          original_email: string
          problem_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          generated_prompt: string
          id?: string
          is_active?: boolean | null
          original_email: string
          problem_type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          generated_prompt?: string
          id?: string
          is_active?: boolean | null
          original_email?: string
          problem_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edge_case_prompts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_folder_stats: {
        Row: {
          created_at: string | null
          email_count: number | null
          folder_name: string
          id: string
          last_updated: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email_count?: number | null
          folder_name: string
          id?: string
          last_updated?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email_count?: number | null
          folder_name?: string
          id?: string
          last_updated?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      folder_configurations: {
        Row: {
          ai_description: string
          created_at: string
          folder_name: string
          id: string
          is_active: boolean | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_description: string
          created_at?: string
          folder_name: string
          id?: string
          is_active?: boolean | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_description?: string
          created_at?: string
          folder_name?: string
          id?: string
          is_active?: boolean | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      knowledge_base_groups: {
        Row: {
          created_at: string
          group_id: string
          id: string
          knowledge_base_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          knowledge_base_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          knowledge_base_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_groups_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_bases: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          sharing: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          sharing?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          sharing?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      knowledge_group_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_items: {
        Row: {
          content: string
          created_at: string | null
          document_id: string | null
          fact_type: string | null
          id: string
          knowledge_base_id: string
          linked_context_id: string | null
          openai_embedding: string | null
          question: string | null
          question_embedding: string | null
          segment_index: number | null
          source_chunk: string | null
          source_name: string
          source_type: string
          tokens: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          document_id?: string | null
          fact_type?: string | null
          id?: string
          knowledge_base_id: string
          linked_context_id?: string | null
          openai_embedding?: string | null
          question?: string | null
          question_embedding?: string | null
          segment_index?: number | null
          source_chunk?: string | null
          source_name: string
          source_type: string
          tokens: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          document_id?: string | null
          fact_type?: string | null
          id?: string
          knowledge_base_id?: string
          linked_context_id?: string | null
          openai_embedding?: string | null
          question?: string | null
          question_embedding?: string | null
          segment_index?: number | null
          source_chunk?: string | null
          source_name?: string
          source_type?: string
          tokens?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_items_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_items_linked_context_id_fkey"
            columns: ["linked_context_id"]
            isOneToOne: false
            referencedRelation: "knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_items_linked_context_id_fkey"
            columns: ["linked_context_id"]
            isOneToOne: false
            referencedRelation: "v_ai_agent_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_items_source_chunk_fkey"
            columns: ["source_chunk"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      mismatch_analysis_jobs: {
        Row: {
          completed_at: string | null
          conflicts_found: Json | null
          created_at: string | null
          error_message: string | null
          id: string
          knowledge_base_id: string
          processed_items: number
          progress: number
          started_at: string
          status: string
          total_items: number
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          conflicts_found?: Json | null
          created_at?: string | null
          error_message?: string | null
          id: string
          knowledge_base_id: string
          processed_items?: number
          progress?: number
          started_at?: string
          status: string
          total_items?: number
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          conflicts_found?: Json | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          knowledge_base_id?: string
          processed_items?: number
          progress?: number
          started_at?: string
          status?: string
          total_items?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      monthly_email_stats: {
        Row: {
          created_at: string | null
          emails_replied_count: number | null
          emails_sent_count: number | null
          id: string
          month_year: string
          updated_at: string | null
          user_email_account_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          emails_replied_count?: number | null
          emails_sent_count?: number | null
          id?: string
          month_year: string
          updated_at?: string | null
          user_email_account_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          emails_replied_count?: number | null
          emails_sent_count?: number | null
          id?: string
          month_year?: string
          updated_at?: string | null
          user_email_account_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_email_stats_user_email_account_id_fkey"
            columns: ["user_email_account_id"]
            isOneToOne: false
            referencedRelation: "user_email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      process_logs: {
        Row: {
          answer: string
          created_at: string
          customer_mail: string | null
          folder: string | null
          id: string
          knowledge_base_id: string | null
          metadata: Json | null
          processing_time: number | null
          question: string[]
          reasoning: string | null
          source_documents: string[] | null
          status: string
          stimmung: string | null
          stimmung_confidence: number | null
          updated_at: string | null
          user_email_account_id: string | null
          user_id: string
        }
        Insert: {
          answer: string
          created_at?: string
          customer_mail?: string | null
          folder?: string | null
          id?: string
          knowledge_base_id?: string | null
          metadata?: Json | null
          processing_time?: number | null
          question: string[]
          reasoning?: string | null
          source_documents?: string[] | null
          status?: string
          stimmung?: string | null
          stimmung_confidence?: number | null
          updated_at?: string | null
          user_email_account_id?: string | null
          user_id: string
        }
        Update: {
          answer?: string
          created_at?: string
          customer_mail?: string | null
          folder?: string | null
          id?: string
          knowledge_base_id?: string | null
          metadata?: Json | null
          processing_time?: number | null
          question?: string[]
          reasoning?: string | null
          source_documents?: string[] | null
          status?: string
          stimmung?: string | null
          stimmung_confidence?: number | null
          updated_at?: string | null
          user_email_account_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_logs_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_logs_user_email_account_id_fkey"
            columns: ["user_email_account_id"]
            isOneToOne: false
            referencedRelation: "user_email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          can_upload: boolean | null
          communication_style: string | null
          company_id: string | null
          company_name: string | null
          email: string | null
          email_limit: number | null
          expertise: string | null
          follow_up_period_days: number | null
          full_name: string | null
          id: string
          is_super_admin: boolean | null
          pending_archive: boolean | null
          preferred_language: string | null
          rating_email_template: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          can_upload?: boolean | null
          communication_style?: string | null
          company_id?: string | null
          company_name?: string | null
          email?: string | null
          email_limit?: number | null
          expertise?: string | null
          follow_up_period_days?: number | null
          full_name?: string | null
          id: string
          is_super_admin?: boolean | null
          pending_archive?: boolean | null
          preferred_language?: string | null
          rating_email_template?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          can_upload?: boolean | null
          communication_style?: string | null
          company_id?: string | null
          company_name?: string | null
          email?: string | null
          email_limit?: number | null
          expertise?: string | null
          follow_up_period_days?: number | null
          full_name?: string | null
          id?: string
          is_super_admin?: boolean | null
          pending_archive?: boolean | null
          preferred_language?: string | null
          rating_email_template?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      trendthemen: {
        Row: {
          calender_week: number
          created: string
          id: number
          mail_count: number
          trend_themen: string[]
          updated: string
          user_email_account_id: string | null
          user_id: string
        }
        Insert: {
          calender_week: number
          created?: string
          id?: never
          mail_count?: number
          trend_themen?: string[]
          updated?: string
          user_email_account_id?: string | null
          user_id: string
        }
        Update: {
          calender_week?: number
          created?: string
          id?: never
          mail_count?: number
          trend_themen?: string[]
          updated?: string
          user_email_account_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trendthemen_user_email_account_id_fkey"
            columns: ["user_email_account_id"]
            isOneToOne: false
            referencedRelation: "user_email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      trendthemen_kategorien: {
        Row: {
          created: string
          farbe: string | null
          id: number
          ist_aktiv: boolean
          kategorie_name: string
          sortierung: number
          updated: string
          user_id: string
        }
        Insert: {
          created?: string
          farbe?: string | null
          id?: never
          ist_aktiv?: boolean
          kategorie_name: string
          sortierung?: number
          updated?: string
          user_id: string
        }
        Update: {
          created?: string
          farbe?: string | null
          id?: never
          ist_aktiv?: boolean
          kategorie_name?: string
          sortierung?: number
          updated?: string
          user_id?: string
        }
        Relationships: []
      }
      user_activities: {
        Row: {
          activity_type: string | null
          created_at: string
          details: Json | null
          duration: number | null
          id: string
          user_id: string | null
        }
        Insert: {
          activity_type?: string | null
          created_at?: string
          details?: Json | null
          duration?: number | null
          id?: string
          user_id?: string | null
        }
        Update: {
          activity_type?: string | null
          created_at?: string
          details?: Json | null
          duration?: number | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_email_accounts: {
        Row: {
          access_token: string | null
          automation_active: boolean | null
          client_id: string | null
          client_secret: string | null
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          n8n_credential_id: string | null
          n8n_workflow_id: string | null
          provider: string | null
          refresh_token: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          automation_active?: boolean | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          n8n_credential_id?: string | null
          n8n_workflow_id?: string | null
          provider?: string | null
          refresh_token?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          automation_active?: boolean | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          n8n_credential_id?: string | null
          n8n_workflow_id?: string | null
          provider?: string | null
          refresh_token?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          animations_enabled: boolean | null
          auto_categorization: boolean | null
          cache_size: number | null
          created_at: string | null
          data_retention: number | null
          desktop_notifications: boolean | null
          email_notifications: boolean | null
          id: string
          language: string | null
          outlook_sync_enabled: boolean | null
          preload_emails: boolean | null
          session_timeout: number | null
          sync_interval: string | null
          theme: string | null
          timezone: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          animations_enabled?: boolean | null
          auto_categorization?: boolean | null
          cache_size?: number | null
          created_at?: string | null
          data_retention?: number | null
          desktop_notifications?: boolean | null
          email_notifications?: boolean | null
          id?: string
          language?: string | null
          outlook_sync_enabled?: boolean | null
          preload_emails?: boolean | null
          session_timeout?: number | null
          sync_interval?: string | null
          theme?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          animations_enabled?: boolean | null
          auto_categorization?: boolean | null
          cache_size?: number | null
          created_at?: string | null
          data_retention?: number | null
          desktop_notifications?: boolean | null
          email_notifications?: boolean | null
          id?: string
          language?: string | null
          outlook_sync_enabled?: boolean | null
          preload_emails?: boolean | null
          session_timeout?: number | null
          sync_interval?: string | null
          theme?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          created_at: string | null
          joined_at: string | null
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          joined_at?: string | null
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          joined_at?: string | null
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_home: boolean | null
          name: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_home?: boolean | null
          name: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_home?: boolean | null
          name?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_ai_agent_docs: {
        Row: {
          id: string | null
          metadata: Json | null
          openai_embedding: string | null
          pagecontent: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_workspace_member: {
        Args: { invitee_user_id: string; target_workspace_id: string }
        Returns: undefined
      }
      admin_delete_profile: {
        Args: { profile_id: string }
        Returns: undefined
      }
      archive_and_delete_workspace: {
        Args: { workspace_id_param: string }
        Returns: undefined
      }
      archive_company_user: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      binary_quantize: {
        Args: { "": string } | { "": unknown }
        Returns: unknown
      }
      check_document_needs_reprocessing: {
        Args: { doc_id: string; new_content_hash: string }
        Returns: boolean
      }
      check_kb_group_access: {
        Args: { kb_id: string }
        Returns: boolean
      }
      cleanup_old_mismatch_jobs: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      complete_archive_user: {
        Args: { admin_user_id?: string; target_user_id: string }
        Returns: Json
      }
      create_company_admin: {
        Args: { p_company_id: string; p_user_id: string }
        Returns: undefined
      }
      create_default_folders_for_user: {
        Args: { user_uuid: string }
        Returns: undefined
      }
      create_default_trendthemen_kategorien: {
        Args: { user_uuid: string }
        Returns: undefined
      }
      create_project: {
        Args: {
          p_color?: string
          p_description: string
          p_name: string
          p_status?: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      cursor_local_vector_search: {
        Args: {
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
          p_user_id: string
          p_workspace_id?: string
        }
        Returns: {
          content: string
          document_id: string
          document_title: string
          document_url: string
          id: string
          similarity: number
        }[]
      }
      cursor_text_search: {
        Args: {
          p_match_count?: number
          p_query: string
          p_user_id: string
          p_workspace_id?: string
        }
        Returns: {
          content: string
          document_id: string
          document_title: string
          document_url: string
          id: string
          rank: number
        }[]
      }
      cursor_vector_search: {
        Args: {
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
          p_user_id: string
          p_workspace_id?: string
        }
        Returns: {
          content: string
          document_id: string
          document_title: string
          document_url: string
          id: string
          similarity: number
        }[]
      }
      delete_knowledge_base_and_related_data: {
        Args: { kb_id: string; user_id_check: string }
        Returns: undefined
      }
      find_knowledge_facts_with_chunks: {
        Args: {
          p_knowledge_base_id: string
          p_match_count?: number
          p_match_threshold?: number
          p_query_text: string
        }
        Returns: {
          chunk_content: string
          chunk_id: string
          fact_content: string
          fact_id: string
          fact_source_name: string
          similarity: number
        }[]
      }
      force_delete_messages: {
        Args: { message_ids: string[] }
        Returns: undefined
      }
      force_delete_profile: {
        Args: { target_id: string }
        Returns: Json
      }
      force_remove_workspace_member: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: boolean
      }
      get_active_mismatch_job: {
        Args: { kb_id: string }
        Returns: {
          conflicts_found: Json
          id: string
          processed_items: number
          progress: number
          started_at: string
          status: string
          total_items: number
        }[]
      }
      get_all_users_with_permissions: {
        Args: { admin_user_id: string }
        Returns: {
          can_upload: boolean
          company_name: string
          email: string
          email_limit: number
          full_name: string
          is_super_admin: boolean
          user_id: string
        }[]
      }
      get_assignable_users: {
        Args: { input_project_id: string }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      get_available_workspace_users: {
        Args: { p_workspace_id: string }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      get_chunk_processing_stats: {
        Args: { document_id_param: string }
        Returns: {
          avg_processing_time_ms: number
          avg_quality_score: number
          failed_chunks: number
          processed_chunks: number
          total_chunks: number
          total_facts: number
        }[]
      }
      get_global_kpis: {
        Args: Record<PropertyKey, never>
        Returns: {
          avg_response_time: number
          total_email_accounts: number
          total_knowledge_bases: number
          total_process_logs: number
          total_super_admins: number
          total_users: number
        }[]
      }
      get_project_assignable_users: {
        Args: { p_project_id: string }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      get_workspace_members_with_details: {
        Args: { p_workspace_id: string }
        Returns: {
          email: string
          full_name: string
          role: string
          user_id: string
        }[]
      }
      gtrgm_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_options: {
        Args: { "": unknown }
        Returns: undefined
      }
      gtrgm_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      halfvec_avg: {
        Args: { "": number[] }
        Returns: unknown
      }
      halfvec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      halfvec_send: {
        Args: { "": unknown }
        Returns: string
      }
      halfvec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      has_workspace_access: {
        Args: { workspace_uuid: string }
        Returns: boolean
      }
      hnsw_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_sparsevec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnswhandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflat_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflat_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflathandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      kb_find_facts_with_chunks: {
        Args: {
          p_knowledge_base_id: string
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
        }
        Returns: {
          chunk_content: string
          chunk_id: string
          fact_content: string
          fact_id: string
          fact_source_name: string
          similarity: number
        }[]
      }
      kb_vector_search: {
        Args:
          | {
              p_knowledge_base_id: string
              p_match_count: number
              p_match_threshold: number
              p_query_embedding: string
              p_user_id: string
            }
          | {
              p_match_count: number
              p_match_threshold: number
              p_query_embedding: string
              p_user_id: string
            }
        Returns: {
          content: string
          id: string
          knowledge_base_id: string
          similarity: number
          source_name: string
          source_type: string
        }[]
      }
      kb_vector_search_local: {
        Args: {
          p_match_count: number
          p_match_threshold: number
          p_query_embedding: string
          p_user_id: string
        }
        Returns: {
          content: string
          id: string
          knowledge_base_id: string
          similarity: number
          source_name: string
          source_type: string
        }[]
      }
      l2_norm: {
        Args: { "": unknown } | { "": unknown }
        Returns: number
      }
      l2_normalize: {
        Args: { "": string } | { "": unknown } | { "": unknown }
        Returns: unknown
      }
      match_documents: {
        Args:
          | {
              filter?: Json
              kb_id?: string
              match_count?: number
              query_embedding: string
            }
          | {
              kb_id: string
              match_count: number
              query_embedding: string
              similarity_threshold: number
            }
        Returns: {
          id: string
          metadata: Json
          pagecontent: string
          similarity: number
        }[]
      }
      match_knowledge_items: {
        Args:
          | {
              p_match_count: number
              p_match_threshold: number
              p_query_embedding: string
              p_user_id: string
            }
          | {
              p_match_count: number
              p_match_threshold: number
              p_query_embedding: string
              p_user_id: string
            }
        Returns: {
          content: string
          id: string
          knowledge_base_id: string
          similarity: number
          source_name: string
          source_type: string
        }[]
      }
      match_knowledge_items_simple: {
        Args: {
          p_match_count: number
          p_match_threshold: number
          p_query_embedding: string
          p_user_id: string
        }
        Returns: {
          content: string
          id: string
          knowledge_base_id: string
          similarity: number
          source_name: string
          source_type: string
        }[]
      }
      match_knowledge_items_v2: {
        Args: {
          p_match_count: number
          p_match_threshold: number
          p_query_embedding: string
          p_user_id: string
        }
        Returns: {
          content: string
          id: string
          knowledge_base_id: string
          similarity: number
          source_name: string
          source_type: string
        }[]
      }
      match_questions: {
        Args:
          | {
              filter?: Json
              kb_id?: string
              match_count?: number
              query_embedding: string
            }
          | {
              filter?: Json
              kb_id?: string
              match_count?: number
              query_embedding: string
              question?: string
              similarity_threshold?: number
            }
        Returns: {
          id: string
          metadata: Json
          pagecontent: string
          similarity: number
        }[]
      }
      rag_atomic_fact_search: {
        Args: {
          p_knowledge_base_id: string
          p_match_count: number
          p_match_threshold: number
          p_query_embedding: string
        }
        Returns: {
          fact_id: string
          fact_source_name: string
          linked_context_id: string
          similarity: number
        }[]
      }
      remove_workspace_member_with_permissions: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: boolean
      }
      search_chat_facts: {
        Args: {
          max_results?: number
          p_user_id: string
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          content: string
          similarity: number
        }[]
      }
      search_facts_global: {
        Args: { p_document_id: string; p_limit?: number; p_search_term: string }
        Returns: {
          chunk_content: string
          content: string
          created_at: string
          fact_type: string
          id: string
          question: string
          source_chunk: string
        }[]
      }
      search_knowledge_items_in_base: {
        Args: {
          p_date_filter?: string
          p_knowledge_base_id: string
          p_limit?: number
          p_offset?: number
          p_search_term: string
          p_source_filter?: string
        }
        Returns: {
          chunk_content: string
          content: string
          created_at: string
          document_title: string
          fact_type: string
          id: string
          question: string
          source_chunk: string
          source_name: string
          total_count: number
          updated_at: string
        }[]
      }
      search_similar_messages: {
        Args: {
          max_results?: number
          p_user_id: string
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chat_id: string
          content: string
          message_id: string
          role: string
          similarity: number
        }[]
      }
      set_limit: {
        Args: { "": number }
        Returns: number
      }
      set_user_email_limit: {
        Args: {
          admin_user_id: string
          email_limit_new: number
          target_user_id: string
        }
        Returns: Json
      }
      set_user_upload_permission: {
        Args: {
          admin_user_id: string
          can_upload_new: boolean
          target_user_id: string
        }
        Returns: Json
      }
      show_kb_columns: {
        Args: Record<PropertyKey, never>
        Returns: {
          column_name: string
          data_type: string
        }[]
      }
      show_limit: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      show_trgm: {
        Args: { "": string }
        Returns: string[]
      }
      sparsevec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      sparsevec_send: {
        Args: { "": unknown }
        Returns: string
      }
      sparsevec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      update_document_processing_info: {
        Args: { doc_id: string; new_content_hash: string }
        Returns: undefined
      }
      update_job_progress: {
        Args: {
          error_msg?: string
          job_id: string
          mark_completed?: boolean
          new_conflicts?: Json
          new_processed_items: number
        }
        Returns: boolean
      }
      user_can_upload: {
        Args: { user_id: string }
        Returns: boolean
      }
      user_is_super_admin: {
        Args: { user_id: string }
        Returns: boolean
      }
      vector_avg: {
        Args: { "": number[] }
        Returns: string
      }
      vector_dims: {
        Args: { "": string } | { "": unknown }
        Returns: number
      }
      vector_norm: {
        Args: { "": string }
        Returns: number
      }
      vector_out: {
        Args: { "": string }
        Returns: unknown
      }
      vector_send: {
        Args: { "": string }
        Returns: string
      }
      vector_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
