-- ============================================================
-- WALLET BALANCE SYSTEM - Migration Script
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Drop old table if it exists with wrong schema
-- (Only run this if your clients table has client_name instead of email)
-- DROP TABLE IF EXISTS clients;

-- Create the clients table with email as the primary identifier
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    client_name VARCHAR(255),
    wallet_balance NUMERIC(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups by email (primary query pattern)
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

-- ============================================================
-- IF the clients table already exists with client_name but
-- no email column, run this migration instead:
-- ============================================================
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;
-- CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
