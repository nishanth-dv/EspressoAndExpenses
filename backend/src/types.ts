export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GOOGLE_CLIENT_ID: string;
  ALLOWLIST: string;
  ADMIN: string;
  APP_ORIGIN: string;
  // Advisory Q&A — provider-agnostic, OpenAI-compatible /chat/completions.
  // Set LLM_API_KEY as a secret to switch the feature on; unset = disabled.
  LLM_API_KEY?: string;
  LLM_API_URL?: string; // full chat-completions URL; defaults to OpenAI's
  LLM_MODEL?: string; // model id; defaults to a small, cheap model
}

export interface AuthedUser {
  sub: string;
  email: string;
}

export interface Variables {
  user: AuthedUser;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
