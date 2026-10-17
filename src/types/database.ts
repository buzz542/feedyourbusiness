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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor: string
          at: string
          id: number
          target: string | null
        }
        Insert: {
          action: string
          actor: string
          at?: string
          id?: never
          target?: string | null
        }
        Update: {
          action?: string
          actor?: string
          at?: string
          id?: never
          target?: string | null
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          processed_at: string | null
          received_at: string
          stripe_event_id: string
          type: string
        }
        Insert: {
          processed_at?: string | null
          received_at?: string
          stripe_event_id: string
          type: string
        }
        Update: {
          processed_at?: string | null
          received_at?: string
          stripe_event_id?: string
          type?: string
        }
        Relationships: []
      }
      competitors: {
        Row: {
          aliases: string[]
          created_at: string
          domain: string | null
          id: string
          name: string
          origin: string
          product_id: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          domain?: string | null
          id?: string
          name: string
          origin?: string
          product_id: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          domain?: string | null
          id?: string
          name?: string
          origin?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          at: string
          id: number
          name: string
          props: Json
          user_id: string | null
        }
        Insert: {
          at?: string
          id?: never
          name: string
          props?: Json
          user_id?: string | null
        }
        Update: {
          at?: string
          id?: never
          name?: string
          props?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          locked_until: string | null
          payload: Json
          product_id: string | null
          run_after: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          locked_until?: string | null
          payload?: Json
          product_id?: string | null
          run_after?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          locked_until?: string | null
          payload?: Json
          product_id?: string | null
          run_after?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_usage: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          created_at: string
          id: number
          input_tokens: number
          model: string
          output_tokens: number
          product_id: string | null
          task: string
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd: number
          created_at?: string
          id?: never
          input_tokens: number
          model: string
          output_tokens: number
          product_id?: string | null
          task: string
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: never
          input_tokens?: number
          model?: string
          output_tokens?: number
          product_id?: string | null
          task?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_handle: string | null
          author_hash: string
          collected_at: string
          community: string | null
          delete_after: string
          excerpt: string
          external_id: string
          id: string
          posted_at: string
          source: string
          url: string
        }
        Insert: {
          author_handle?: string | null
          author_hash: string
          collected_at?: string
          community?: string | null
          delete_after?: string
          excerpt: string
          external_id: string
          id?: string
          posted_at: string
          source: string
          url: string
        }
        Update: {
          author_handle?: string | null
          author_hash?: string
          collected_at?: string
          community?: string | null
          delete_after?: string
          excerpt?: string
          external_id?: string
          id?: string
          posted_at?: string
          source?: string
          url?: string
        }
        Relationships: []
      }
      product_posts: {
        Row: {
          category: string
          created_at: string
          id: string
          post_id: string
          product_id: string
          reason: string
          relevance: number
          state: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          post_id: string
          product_id: string
          reason: string
          relevance: number
          state?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          post_id?: string
          product_id?: string
          reason?: string
          relevance?: number
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_posts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          audience: string | null
          confirmed_at: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          one_liner: string | null
          owner_id: string
          relevance_threshold: number
          status: string
          subreddits: string[]
          updated_at: string
          url: string
        }
        Insert: {
          audience?: string | null
          confirmed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          one_liner?: string | null
          owner_id: string
          relevance_threshold?: number
          status?: string
          subreddits?: string[]
          updated_at?: string
          url: string
        }
        Update: {
          audience?: string | null
          confirmed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          one_liner?: string | null
          owner_id?: string
          relevance_threshold?: number
          status?: string
          subreddits?: string[]
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          billing_event_at: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          email_daily: boolean
          email_weekly: boolean
          id: string
          is_admin: boolean
          marketing_opt_in: boolean
          marketing_opt_in_at: string | null
          plan: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          terms_accepted_at: string | null
          trial_end: string | null
          trial_reminder_sent_at: string | null
          updated_at: string
        }
        Insert: {
          billing_event_at?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          email_daily?: boolean
          email_weekly?: boolean
          id: string
          is_admin?: boolean
          marketing_opt_in?: boolean
          marketing_opt_in_at?: string | null
          plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          terms_accepted_at?: string | null
          trial_end?: string | null
          trial_reminder_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_event_at?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          email_daily?: boolean
          email_weekly?: boolean
          id?: string
          is_admin?: boolean
          marketing_opt_in?: boolean
          marketing_opt_in_at?: string | null
          plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          terms_accepted_at?: string | null
          trial_end?: string | null
          trial_reminder_sent_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      removal_requests: {
        Row: {
          contact_email: string
          created_at: string
          due_at: string
          handled_at: string | null
          id: string
          link_or_handle: string
          status: string
          target_at: string
          updated_at: string
        }
        Insert: {
          contact_email: string
          created_at?: string
          due_at?: string
          handled_at?: string | null
          id?: string
          link_or_handle: string
          status?: string
          target_at?: string
          updated_at?: string
        }
        Update: {
          contact_email?: string
          created_at?: string
          due_at?: string
          handled_at?: string | null
          id?: string
          link_or_handle?: string
          status?: string
          target_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      search_terms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          intent: string
          paused: boolean
          product_id: string
          term: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          intent?: string
          paused?: boolean
          product_id: string
          term: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          intent?: string
          paused?: boolean
          product_id?: string
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_terms_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppression: {
        Row: {
          author_hash: string
          created_at: string
          id: string
          reason: string
          source: string
        }
        Insert: {
          author_hash: string
          created_at?: string
          id?: string
          reason: string
          source: string
        }
        Update: {
          author_hash?: string
          created_at?: string
          id?: string
          reason?: string
          source?: string
        }
        Relationships: []
      }
      term_stats: {
        Row: {
          day: string
          fetched: number
          relevant: number
          source: string
          term_id: string
        }
        Insert: {
          day: string
          fetched?: number
          relevant?: number
          source: string
          term_id: string
        }
        Update: {
          day?: string
          fetched?: number
          relevant?: number
          source?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "term_stats_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "search_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      themes: {
        Row: {
          count: number
          created_at: string
          example_post_ids: string[]
          id: string
          product_id: string
          summary: string
          title: string
          trend: string
          week: string
        }
        Insert: {
          count: number
          created_at?: string
          example_post_ids?: string[]
          id?: string
          product_id: string
          summary: string
          title: string
          trend?: string
          week: string
        }
        Update: {
          count?: number
          created_at?: string
          example_post_ids?: string[]
          id?: string
          product_id?: string
          summary?: string
          title?: string
          trend?: string
          week?: string
        }
        Relationships: [
          {
            foreignKeyName: "themes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_ledger: {
        Row: {
          cost_usd: number
          id: string
          product_id: string
          reads: number
          source: string
          usage_date: string
        }
        Insert: {
          cost_usd?: number
          id?: string
          product_id: string
          reads?: number
          source: string
          usage_date?: string
        }
        Update: {
          cost_usd?: number
          id?: string
          product_id?: string
          reads?: number
          source?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_ledger_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_billing_patch: {
        Args: { p_event_at: string; p_patch: Json; p_user_id: string }
        Returns: boolean
      }
      claim_billing_event: {
        Args: { p_event_id: string; p_type: string }
        Returns: string
      }
      claim_jobs: {
        Args: { p_lease_seconds: number; p_limit: number; p_now: string }
        Returns: {
          attempts: number
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          locked_until: string | null
          payload: Json
          product_id: string | null
          run_after: string
          source: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      confirm_product: {
        Args: { p_product_id: string }
        Returns: string
      }
      consume_budget: {
        Args: { p_day: string; p_limit: number; p_product_id: string; p_source: string; p_units: number }
        Returns: boolean
      }
      finish_job: {
        Args: { p_error_class: string; p_id: string; p_payload: Json; p_run_after: string; p_status: string }
        Returns: undefined
      }
      ingest_post: {
        Args: { p_author_hash: string; p_community: string; p_excerpt: string; p_external_id: string; p_now: string; p_posted_at: string; p_source: string; p_url: string }
        Returns: string
      }
      llm_spend_since: {
        Args: { p_product_id?: string; p_since: string }
        Returns: number
      }
      purge_expired: {
        Args: { p_now: string }
        Returns: Json
      }
      save_product_draft: {
        Args: { p_audience: string; p_competitors: Json; p_description: string; p_name: string; p_one_liner: string; p_product_id: string; p_subreddits: string[]; p_terms: Json; p_url: string }
        Returns: undefined
      }
      save_product_profile: {
        Args: { p_competitors: Json; p_product_id: string; p_profile: Json; p_terms: Json }
        Returns: undefined
      }
      settle_budget: {
        Args: { p_actual: number; p_cost_usd: number; p_day: string; p_product_id: string; p_reserved: number; p_source: string }
        Returns: undefined
      }
      text_items_ok: {
        Args: { items: string[]; max_len: number }
        Returns: boolean
      }
      vendor_usage: {
        Args: { p_month_start: string; p_source: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
