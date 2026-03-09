-- Chat tables (moved from plugin_chat_ui to core)
-- Rename existing plugin tables if they exist, otherwise create fresh

DO $$
BEGIN
  -- Rename tables if they exist from plugin era
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plugin_chat_ui_threads') THEN
    ALTER TABLE plugin_chat_ui_threads RENAME TO chat_threads;
    ALTER TABLE plugin_chat_ui_messages RENAME TO chat_messages;
    -- Rename indexes
    ALTER INDEX IF EXISTS idx_chat_threads_company RENAME TO idx_chat_threads_company_id;
    ALTER INDEX IF EXISTS idx_chat_messages_thread RENAME TO idx_chat_messages_thread_id;
  ELSE
    -- Fresh install — create tables directly
    CREATE TABLE chat_threads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      title TEXT,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_chat_threads_company_id ON chat_threads(company_id);

    CREATE TABLE chat_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_chat_messages_thread_id ON chat_messages(thread_id);
  END IF;
END $$;
