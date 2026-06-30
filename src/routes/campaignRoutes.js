const express = require('express');
const db = require('../config/database');
const { getQueueStatus } = require('../queueManager');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// GET /api/campaigns/history
// Paginated historical leads with filters (date range, batch,
// status, search). Supports browsing previous year data.
// ═══════════════════════════════════════════════════════════════
router.get('/history', async (req, res) => {
  try {
    const {
      email,
      startDate,
      endDate,
      batchId,
      status,
      search,
      page = 1,
      limit = 50
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Filter by client email
    if (email) {
      conditions.push(`email = $${paramIndex++}`);
      params.push(email);
    }

    // Date range filter
    if (startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(startDate);
    }
    if (endDate) {
      // Add 1 day to endDate to include the entire end day
      conditions.push(`created_at < ($${paramIndex++}::date + interval '1 day')`);
      params.push(endDate);
    }

    // Batch filter
    if (batchId && batchId !== 'All') {
      conditions.push(`batch_id = $${paramIndex++}`);
      params.push(batchId);
    }

    // Status filter
    if (status && status !== 'ALL') {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    // Search by name or phone
    if (search) {
      conditions.push(`(customer_name ILIKE $${paramIndex} OR phone_number ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM leads ${whereClause}`;
    const countResult = await db.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].total, 10);

    // Get paginated results
    const dataQuery = `
      SELECT id, email, customer_name, phone_number, status, batch_id,
             recording_url, transcript_summary, custom_data, created_at, updated_at
      FROM leads
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(parseInt(limit, 10), offset);

    const dataResult = await db.query(dataQuery, params);

    res.status(200).json({
      leads: dataResult.rows,
      pagination: {
        total: totalCount,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalCount / parseInt(limit, 10))
      }
    });
  } catch (error) {
    console.error('🔥 Failed to fetch campaign history:', error);
    res.status(500).json({ error: 'Failed to fetch campaign history.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/campaigns/batches
// List all batch IDs with their date, lead count, and status
// breakdown. Powers the batch selector dropdown.
// ═══════════════════════════════════════════════════════════════
router.get('/batches', async (req, res) => {
  try {
    const { email } = req.query;

    let whereClause = '';
    const params = [];

    if (email) {
      whereClause = 'WHERE email = $1';
      params.push(email);
    }

    const result = await db.query(`
      SELECT
        batch_id,
        COUNT(*) as total_leads,
        MIN(created_at) as started_at,
        MAX(updated_at) as last_updated,
        COUNT(*) FILTER (WHERE status = 'GREEN') as green_count,
        COUNT(*) FILTER (WHERE status = 'RED') as red_count,
        COUNT(*) FILTER (WHERE status = 'YELLOW') as yellow_count,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending_count
      FROM leads
      ${whereClause}
      GROUP BY batch_id
      ORDER BY MIN(created_at) DESC
    `, params);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('🔥 Failed to fetch batches:', error);
    res.status(500).json({ error: 'Failed to fetch batch list.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/campaigns/stats
// Aggregated statistics for the dashboard — overall and per
// time period.
// ═══════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const { email, startDate, endDate } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (email) {
      conditions.push(`email = $${paramIndex++}`);
      params.push(email);
    }
    if (startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`created_at < ($${paramIndex++}::date + interval '1 day')`);
      params.push(endDate);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const result = await db.query(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE status = 'GREEN') as interested,
        COUNT(*) FILTER (WHERE status = 'RED') as not_interested,
        COUNT(*) FILTER (WHERE status = 'YELLOW') as follow_up,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE recording_url IS NOT NULL) as with_recordings,
        COUNT(DISTINCT batch_id) as total_campaigns
      FROM leads
      ${whereClause}
    `, params);

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('🔥 Failed to fetch campaign stats:', error);
    res.status(500).json({ error: 'Failed to fetch campaign statistics.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/campaigns/queue-status
// Real-time queue status for the frontend
// ═══════════════════════════════════════════════════════════════
router.get('/queue-status', (req, res) => {
  res.status(200).json(getQueueStatus());
});

module.exports = router;
