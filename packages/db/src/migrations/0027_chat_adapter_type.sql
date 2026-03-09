-- Add adapter_type to chat_threads so threads remember which adapter they use
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS adapter_type TEXT NOT NULL DEFAULT 'claude_local';
