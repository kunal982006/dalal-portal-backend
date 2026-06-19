# Dalal Portal Backend Architecture

This plan outlines the highly robust, production-ready backend architecture for the Dalal Portal, built with Node.js, Express, and PostgreSQL.

## User Review Required
> [!IMPORTANT]
> Please review the database schema and the file structure. I will create these files directly in your `Dalal_portal_backend` workspace once approved.

## Proposed Changes

We will use a modular structure for maintainability and scalability.

### Database Schema

#### [NEW] `src/schema/init.sql`
The PostgreSQL schema for the `leads` table.
```sql
CREATE TYPE lead_status AS ENUM ('PENDING', 'YELLOW', 'GREEN', 'RED');

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    status lead_status DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups during webhooks
CREATE INDEX idx_leads_phone_number ON leads(phone_number);
```

### Configuration

#### [NEW] `.env`
Environment variables for the database and server port.

#### [NEW] `src/config/database.js`
Robust PostgreSQL connection pool using `pg` with error handling.

### Controllers

#### [NEW] `src/controllers/leadController.js`
Handles Excel file uploads using `multer`, parsing with `xlsx`, and bulk inserting into PostgreSQL. Includes strict error handling for empty files or wrong formats.

#### [NEW] `src/controllers/webhookController.js`
Listens for Vapi.ai webhook events. Parses the call status and updates the lead status in the database (e.g., from 'PENDING' to 'GREEN' or 'RED').

### Routes

#### [NEW] `src/routes/leadRoutes.js`
Defines the `POST /api/leads/upload` endpoint.

#### [NEW] `src/routes/webhookRoutes.js`
Defines the `POST /api/webhook/vapi` endpoint.

### Entry Point

#### [NEW] `src/index.js`
The main Express application. Sets up middleware (`cors`, `express.json`), registers routes, and starts the server.

## Verification Plan
1. Create a `.env` file with your PostgreSQL credentials.
2. Run the SQL script to create the table.
3. Start the server using `node src/index.js`.
4. Test the upload endpoint with a sample Excel file.
5. Test the webhook endpoint using a simulated payload.
