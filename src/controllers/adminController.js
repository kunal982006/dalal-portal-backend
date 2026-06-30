const db = require('../config/database');

// ============================================================
// ADMIN SECRET — God Mode access key
// Hardcoded for now, move to .env in production
// ============================================================
const ADMIN_SECRET = 'astracall-god-mode-2026';

// Middleware: Verify admin token from headers
const verifyAdmin = (req, res, next) => {
  const token = req.headers['x-admin-secret'];
  if (!token || token !== ADMIN_SECRET) {
    console.log('🚫 GOD MODE ACCESS DENIED — Invalid admin token');
    return res.status(403).json({ error: 'Access denied. You are not the God here.' });
  }
  next();
};

// GET /api/admin/clients — Fetch all clients with lead counts
const getClients = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        c.email, 
        c.wallet_balance,
        COUNT(l.id) AS total_leads
      FROM clients c
      LEFT JOIN leads l ON c.email = l.email
      GROUP BY c.email, c.wallet_balance
      ORDER BY c.wallet_balance DESC
    `);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('🔥 Admin getClients failed:', error);
    res.status(500).json({ error: 'Failed to fetch client data.' });
  }
};

// POST /api/admin/recharge — Manually top up a client's wallet
const rechargeClient = async (req, res) => {
  try {
    const { email, amount } = req.body;

    if (!email || !amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Valid email and positive amount are required.' });
    }

    const rechargeAmount = parseFloat(amount);

    // UPSERT: Create client if they don't exist, otherwise update their balance
    const result = await db.query(
      `INSERT INTO clients (email, wallet_balance) 
       VALUES ($2, $1)
       ON CONFLICT (email) 
       DO UPDATE SET 
         wallet_balance = clients.wallet_balance + EXCLUDED.wallet_balance, 
         updated_at = CURRENT_TIMESTAMP
       RETURNING wallet_balance`,
      [rechargeAmount, email]
    );

    const newBalance = parseFloat(result.rows[0].wallet_balance);
    console.log(`💰 GOD MODE RECHARGE: ${email} topped up by ₹${rechargeAmount.toFixed(2)} → New Balance: ₹${newBalance.toFixed(2)}`);

    res.status(200).json({
      message: `Successfully recharged ₹${rechargeAmount.toFixed(2)} for ${email}`,
      new_balance: newBalance
    });
  } catch (error) {
    console.error('🔥 Admin recharge failed:', error);
    res.status(500).json({ error: 'Failed to recharge client.' });
  }
};

module.exports = {
  verifyAdmin,
  getClients,
  rechargeClient
};
