// Füge die Tools und Tool_Workspaces-Tabellen hinzu, wenn die Datei existiert

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      // Andere Tabellen hier einfügen
      tools: {
        Row: {
          id: string
          user_id: string
          folder_id: string | null
          created_at: string
          updated_at: string
          sharing: string
          description: string | null
          name: string
          schema: Json
          url: string
          custom_headers: Json
        }
        Insert: {
          id?: string
          user_id: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          description?: string | null
          name: string
          schema?: Json
          url: string
          custom_headers?: Json
        }
        Update: {
          id?: string
          user_id?: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          description?: string | null
          name?: string
          schema?: Json
          url?: string
          custom_headers?: Json
        }
        Relationships: [
          {
            foreignKeyName: "tools_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tools_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      tool_workspaces: {
        Row: {
          user_id: string
          tool_id: string
          workspace_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          tool_id: string
          workspace_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          tool_id?: string
          workspace_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_workspaces_tool_id_fkey"
            columns: ["tool_id"]
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_workspaces_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      },
      assistant_tools: {
        Row: {
          user_id: string
          assistant_id: string
          tool_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          assistant_id: string
          tool_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          assistant_id?: string
          tool_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_tools_assistant_id_fkey"
            columns: ["assistant_id"]
            referencedRelation: "assistants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_tools_tool_id_fkey"
            columns: ["tool_id"]
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_tools_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      chats: {
        Row: {
          id: string
          user_id: string
          folder_id: string | null
          created_at: string
          updated_at: string
          sharing: string
          title: string
          model: string
          prompt: string | null
          temperature: number
          description: string | null
          workspace_id: string | null
          assistant_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          title: string
          model: string
          prompt?: string | null
          temperature?: number
          description?: string | null
          workspace_id?: string | null
          assistant_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          title?: string
          model?: string
          prompt?: string | null
          temperature?: number
          description?: string | null
          workspace_id?: string | null
          assistant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chats_assistant_id_fkey"
            columns: ["assistant_id"]
            referencedRelation: "assistants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      },
      messages: {
        Row: {
          id: string
          user_id: string
          chat_id: string
          created_at: string
          updated_at: string
          role: string
          content: string
          sequence: number
          include_in_context: boolean
          image_paths: string[] | null
        }
        Insert: {
          id?: string
          user_id: string
          chat_id: string
          created_at?: string
          updated_at?: string
          role: string
          content: string
          sequence: number
          include_in_context?: boolean
          image_paths?: string[] | null
        }
        Update: {
          id?: string
          user_id?: string
          chat_id?: string
          created_at?: string
          updated_at?: string
          role?: string
          content?: string
          sequence?: number
          include_in_context?: boolean
          image_paths?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      files: {
        Row: {
          id: string
          user_id: string
          folder_id: string | null
          created_at: string
          updated_at: string
          sharing: string
          name: string
          type: string
          size: number
          tokens: number
          path: string
          retrieval_type: string | null
          description: string | null
          embedding_model: string | null
        }
        Insert: {
          id?: string
          user_id: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          name: string
          type: string
          size: number
          tokens: number
          path: string
          retrieval_type?: string | null
          description?: string | null
          embedding_model?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          name?: string
          type?: string
          size?: number
          tokens?: number
          path?: string
          retrieval_type?: string | null
          description?: string | null
          embedding_model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      folders: {
        Row: {
          id: string
          user_id: string
          created_at: string
          updated_at: string
          name: string
          description: string | null
          type: string
          workspace_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          created_at?: string
          updated_at?: string
          name: string
          description?: string | null
          type: string
          workspace_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          created_at?: string
          updated_at?: string
          name?: string
          description?: string | null
          type?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folders_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      },
      workspaces: {
        Row: {
          id: string
          user_id: string
          created_at: string
          updated_at: string
          name: string
          description: string | null
          default_context_length: number | null
          default_model: string | null
          default_prompt: string | null
          default_temperature: number | null
          embeddings_provider: string | null
          vector_store: string | null
          sharing: string
          is_home: boolean
          instructions: string | null
          display_image_url: string | null
          users_can_create_chatbots: boolean | null
        }
        Insert: {
          id?: string
          user_id: string
          created_at?: string
          updated_at?: string
          name: string
          description?: string | null
          default_context_length?: number | null
          default_model?: string | null
          default_prompt?: string | null
          default_temperature?: number | null
          embeddings_provider?: string | null
          vector_store?: string | null
          sharing?: string
          is_home?: boolean
          instructions?: string | null
          display_image_url?: string | null
          users_can_create_chatbots?: boolean | null
        }
        Update: {
          id?: string
          user_id?: string
          created_at?: string
          updated_at?: string
          name?: string
          description?: string | null
          default_context_length?: number | null
          default_model?: string | null
          default_prompt?: string | null
          default_temperature?: number | null
          embeddings_provider?: string | null
          vector_store?: string | null
          sharing?: string
          is_home?: boolean
          instructions?: string | null
          display_image_url?: string | null
          users_can_create_chatbots?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      presets: {
        Row: {
          id: string
          user_id: string
          folder_id: string | null
          created_at: string
          updated_at: string
          sharing: string
          name: string
          description: string | null
          context_length: number
          model: string
          prompt: string
          temperature: number
          workspace_id: string | null
          include_profile_context: boolean
          include_workspace_instructions: boolean
        }
        Insert: {
          id?: string
          user_id: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          name: string
          description?: string | null
          context_length: number
          model: string
          prompt: string
          temperature: number
          workspace_id?: string | null
          include_profile_context?: boolean
          include_workspace_instructions?: boolean
        }
        Update: {
          id?: string
          user_id?: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          name?: string
          description?: string | null
          context_length?: number
          model?: string
          prompt?: string
          temperature?: number
          workspace_id?: string | null
          include_profile_context?: boolean
          include_workspace_instructions?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "presets_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presets_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presets_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      },
      prompts: {
        Row: {
          id: string
          user_id: string
          folder_id: string | null
          created_at: string
          updated_at: string
          sharing: string
          name: string
          description: string | null
          content: string
          workspace_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          name: string
          description?: string | null
          content: string
          workspace_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          name?: string
          description?: string | null
          content?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompts_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompts_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompts_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      },
      assistants: {
        Row: {
          id: string
          user_id: string
          folder_id: string | null
          created_at: string
          updated_at: string
          name: string
          description: string | null
          instructions: string
          model: string
          image_path: string | null
          sharing: string
          context_length: number
          include_profile_context: boolean
          include_workspace_instructions: boolean
          temperature: number
          workspace_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          name: string
          description?: string | null
          instructions: string
          model: string
          image_path?: string | null
          sharing?: string
          context_length?: number
          include_profile_context?: boolean
          include_workspace_instructions?: boolean
          temperature?: number
          workspace_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          name?: string
          description?: string | null
          instructions?: string
          model?: string
          image_path?: string | null
          sharing?: string
          context_length?: number
          include_profile_context?: boolean
          include_workspace_instructions?: boolean
          temperature?: number
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistants_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistants_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistants_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      },
      models: {
        Row: {
          id: string
          user_id: string
          created_at: string
          updated_at: string
          name: string
          model_id: string
          base_url: string | null
          api_key: string | null
          type: string | null
          description: string | null
          context_length: number | null
          max_output_tokens: number | null
          default_temperature: number | null
          system_prompt: string | null
          folder_id: string | null
          sharing: string
          workspace_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          created_at?: string
          updated_at?: string
          name: string
          model_id: string
          base_url?: string | null
          api_key?: string | null
          type?: string | null
          description?: string | null
          context_length?: number | null
          max_output_tokens?: number | null
          default_temperature?: number | null
          system_prompt?: string | null
          folder_id?: string | null
          sharing?: string
          workspace_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          created_at?: string
          updated_at?: string
          name?: string
          model_id?: string
          base_url?: string | null
          api_key?: string | null
          type?: string | null
          description?: string | null
          context_length?: number | null
          max_output_tokens?: number | null
          default_temperature?: number | null
          system_prompt?: string | null
          folder_id?: string | null
          sharing?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "models_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "models_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "models_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      },
      collections: {
        Row: {
          id: string
          user_id: string
          folder_id: string | null
          created_at: string
          updated_at: string
          sharing: string
          name: string
          description: string | null
          embedding_model: string | null
          workspace_id: string | null
          retrieval_type: string | null
        }
        Insert: {
          id?: string
          user_id: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          name: string
          description?: string | null
          embedding_model?: string | null
          workspace_id?: string | null
          retrieval_type?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          folder_id?: string | null
          created_at?: string
          updated_at?: string
          sharing?: string
          name?: string
          description?: string | null
          embedding_model?: string | null
          workspace_id?: string | null
          retrieval_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collections_folder_id_fkey"
            columns: ["folder_id"]
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      },
      collection_files: {
        Row: {
          user_id: string
          collection_id: string
          file_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          collection_id: string
          file_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          collection_id?: string
          file_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_files_collection_id_fkey"
            columns: ["collection_id"]
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_files_file_id_fkey"
            columns: ["file_id"]
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_files_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      assistant_files: {
        Row: {
          user_id: string
          assistant_id: string
          file_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          assistant_id: string
          file_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          assistant_id?: string
          file_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_files_assistant_id_fkey"
            columns: ["assistant_id"]
            referencedRelation: "assistants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_files_file_id_fkey"
            columns: ["file_id"]
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_files_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      assistant_collections: {
        Row: {
          user_id: string
          assistant_id: string
          collection_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          assistant_id: string
          collection_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          assistant_id?: string
          collection_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_collections_assistant_id_fkey"
            columns: ["assistant_id"]
            referencedRelation: "assistants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_collections_collection_id_fkey"
            columns: ["collection_id"]
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_collections_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      chat_files: {
        Row: {
          user_id: string
          chat_id: string
          file_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          chat_id: string
          file_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          chat_id?: string
          file_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_files_chat_id_fkey"
            columns: ["chat_id"]
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_files_file_id_fkey"
            columns: ["file_id"]
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_files_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      message_file_items: {
        Row: {
          id: string
          user_id: string
          message_id: string
          file_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          message_id: string
          file_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          message_id?: string
          file_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_file_items_file_id_fkey"
            columns: ["file_id"]
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_file_items_message_id_fkey"
            columns: ["message_id"]
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_file_items_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      profiles: {
        Row: {
          id: string
          username: string | null
          display_name: string | null
          image_url: string | null
          email: string | null
          image_path: string | null
          bio: string | null
          context: string | null
          settings: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          username?: string | null
          display_name?: string | null
          image_url?: string | null
          email?: string | null
          image_path?: string | null
          bio?: string | null
          context?: string | null
          settings?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          username?: string | null
          display_name?: string | null
          image_url?: string | null
          email?: string | null
          image_path?: string | null
          bio?: string | null
          context?: string | null
          settings?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
