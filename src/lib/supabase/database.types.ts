// Generated from the Supabase project schema (generate_typescript_types).
// Regenerate after every migration instead of editing by hand.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18'
  }
  public: {
    Tables: {
      alert_log: Table<
        { alert_key: string; message: string; sent_at: string; user_id: string },
        { alert_key: string; message: string; sent_at?: string; user_id: string }
      >
      buys: Table<
        {
          buy_date: string
          buy_price: number
          created_at: string
          id: string
          note: string | null
          quantity: number
          source: string
          ticker: string
          user_id: string
        },
        {
          buy_date: string
          buy_price: number
          created_at?: string
          id?: string
          note?: string | null
          quantity: number
          source?: string
          ticker: string
          user_id: string
        }
      >
      cash_events: Table<
        {
          amount: number
          created_at: string
          date: string
          id: string
          kind: string
          note: string | null
          ref_id: string | null
          ticker: string | null
          user_id: string
        },
        {
          amount: number
          created_at?: string
          date: string
          id?: string
          kind: string
          note?: string | null
          ref_id?: string | null
          ticker?: string | null
          user_id: string
        }
      >
      daily_analysis: Table<
        {
          change_pct: number | null
          date: string
          id: string
          price: number
          reasoning: string | null
          signal: string
          ticker: string
          updated_at: string
          user_id: string
        },
        {
          change_pct?: number | null
          date: string
          id?: string
          price: number
          reasoning?: string | null
          signal: string
          ticker: string
          updated_at?: string
          user_id: string
        }
      >
      daily_snapshots: Table<
        {
          change_pct: number | null
          date: string
          id: string
          note: string | null
          price: number
          ticker: string
          volume: number | null
        },
        {
          change_pct?: number | null
          date: string
          id?: string
          note?: string | null
          price: number
          ticker: string
          volume?: number | null
        }
      >
      dca_plans: Table<
        {
          active: boolean
          daily_amount_krw: number
          last_synced_date: string | null
          start_date: string
          ticker: string
          updated_at: string
          user_id: string
        },
        {
          active?: boolean
          daily_amount_krw: number
          last_synced_date?: string | null
          start_date: string
          ticker: string
          updated_at?: string
          user_id: string
        }
      >
      holdings: Table<
        {
          avg_cost: number
          first_buy_date: string
          quantity: number
          tags: string[]
          thesis: string | null
          ticker: string
          updated_at: string
          user_id: string
        },
        {
          avg_cost: number
          first_buy_date: string
          quantity: number
          tags?: string[]
          thesis?: string | null
          ticker: string
          updated_at?: string
          user_id: string
        }
      >
      intraday_snapshots: Table<
        {
          change_pct: number | null
          id: string
          price: number
          ticker: string
          ts: string
          volume: number | null
        },
        {
          change_pct?: number | null
          id?: string
          price: number
          ticker: string
          ts?: string
          volume?: number | null
        }
      >
      investment_profiles: Table<
        { content: string; updated_at: string; user_id: string },
        { content?: string; updated_at?: string; user_id: string }
      >
      market_events: Table<
        {
          event_date: string
          id: string
          kind: string
          source: string
          ticker: string
          title: string | null
          updated_at: string
        },
        {
          event_date: string
          id?: string
          kind: string
          source?: string
          ticker: string
          title?: string | null
          updated_at?: string
        }
      >
      mcp_api_keys: Table<
        {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scope: string
          user_id: string
        },
        {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scope?: string
          user_id: string
        }
      >
      mcp_oauth_clients: Table<
        { client_id: string; client_name: string | null; created_at: string; id: string; redirect_uris: string[] },
        { client_id: string; client_name?: string | null; created_at?: string; id?: string; redirect_uris: string[] }
      >
      mcp_oauth_codes: Table<
        {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          redirect_uri: string
          scope: string | null
          used_at: string | null
          user_id: string
        },
        {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          redirect_uri: string
          scope?: string | null
          used_at?: string | null
          user_id: string
        }
      >
      mcp_oauth_tokens: Table<
        {
          access_token_hash: string
          client_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          refresh_token_hash: string | null
          revoked_at: string | null
          scope: string | null
          user_id: string
        },
        {
          access_token_hash: string
          client_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scope?: string | null
          user_id: string
        }
      >
      notification_prefs: Table<
        { email: string | null; email_enabled: boolean; kinds: string[]; updated_at: string; user_id: string },
        { email?: string | null; email_enabled?: boolean; kinds?: string[]; updated_at?: string; user_id: string }
      >
      portfolio_analysis: Table<
        {
          date: string
          id: string
          summary: string
          top_pick: string | null
          top_pick_reason: string | null
          updated_at: string
          user_id: string
        },
        {
          date: string
          id?: string
          summary: string
          top_pick?: string | null
          top_pick_reason?: string | null
          updated_at?: string
          user_id: string
        }
      >
      trades: Table<
        {
          cost_basis: number
          created_at: string
          id: string
          note: string | null
          quantity: number
          realized_pnl: number | null
          sell_date: string
          sell_price: number
          ticker: string
          user_id: string
        },
        {
          cost_basis: number
          created_at?: string
          id?: string
          note?: string | null
          quantity: number
          sell_date: string
          sell_price: number
          ticker: string
          user_id: string
        }
      >
      watchlist: Table<
        {
          added_at: string
          tags: string[]
          target_price: number | null
          thesis: string | null
          ticker: string
          user_id: string
        },
        {
          added_at?: string
          tags?: string[]
          target_price?: number | null
          thesis?: string | null
          ticker: string
          user_id: string
        }
      >
      thesis_checks: Table<
        { claim_id: string; created_at: string; date: string; evidence: string; id: string; ticker: string; user_id: string; verdict: string },
        { claim_id: string; created_at?: string; date: string; evidence: string; id?: string; ticker: string; user_id: string; verdict: string }
      >
      thesis_claims: Table<
        {
          active: boolean
          claim: string
          created_at: string
          id: string
          kill_criteria: string | null
          last_checked: string | null
          last_evidence: string | null
          status: string
          ticker: string
          updated_at: string
          user_id: string
        },
        {
          active?: boolean
          claim: string
          created_at?: string
          id?: string
          kill_criteria?: string | null
          last_checked?: string | null
          last_evidence?: string | null
          status?: string
          ticker: string
          updated_at?: string
          user_id: string
        }
      >
    }
    Views: { [_ in never]: never }
    Functions: {
      delete_cash_event: {
        Args: { p_id: string; p_user_id: string }
        Returns: Json
      }
      record_thesis_check: {
        Args: { p_claim_id: string; p_date: string; p_evidence: string; p_user_id: string; p_verdict: string }
        Returns: Json
      }
      record_cash_event: {
        Args: { p_amount: number; p_date: string; p_kind: string; p_note?: string; p_user_id: string }
        Returns: Json
      }
      set_cash_balance: {
        Args: { p_balance: number; p_date: string; p_note?: string; p_user_id: string }
        Returns: Json
      }
      record_buy: {
        Args: {
          p_affect_cash?: boolean
          p_date: string
          p_note?: string
          p_price: number
          p_quantity: number
          p_source?: string
          p_ticker: string
          p_user_id: string
        }
        Returns: Json
      }
      record_sell: {
        Args: {
          p_affect_cash?: boolean
          p_date: string
          p_note?: string
          p_price: number
          p_quantity: number
          p_ticker: string
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
