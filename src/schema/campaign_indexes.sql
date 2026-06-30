-- ============================================================
-- CAMPAIGN HISTORY INDEXES - Performance Migration
-- Run this in your Supabase SQL Editor
-- These indexes speed up historical queries, date range filters,
-- and campaign batch lookups.
-- ============================================================

-- Fast date-range queries for historical data browsing
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- Fast batch filtering (campaign-level views)
CREATE INDEX IF NOT EXISTS idx_leads_batch_id ON leads(batch_id);

-- Fast per-client historical queries
CREATE INDEX IF NOT EXISTS idx_leads_email_created ON leads(email, created_at);

-- Fast status filtering
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- Composite index for the most common query pattern:
-- filter by email + date range + status
CREATE INDEX IF NOT EXISTS idx_leads_email_status_created ON leads(email, status, created_at);
