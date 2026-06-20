-- ============================================================
-- WALLET BALANCE SYSTEM - Migration Script
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Create the clients table to track wallet balances
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name VARCHAR(255) UNIQUE NOT NULL,
    wallet_balance NUMERIC(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups by client_name
CREATE INDEX IF NOT EXISTS idx_clients_client_name ON clients(client_name);

-- ============================================================
-- IF the clients table already exists and you just need
-- to add the wallet_balance column, run this instead:
-- ============================================================
-- ALTER TABLE clients
--   ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12, 2) DEFAULT 0.00;
