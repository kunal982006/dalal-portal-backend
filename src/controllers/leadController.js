const db = require('../config/database');
const { addToQueue } = require('../queueManager');

const uploadLeads = async (req, res) => {
  try {
    const { email, leads } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'User email is required.' });
    }

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'No leads data provided.' });
    }

    // ============================================================
    // WALLET BALANCE CHECK - Block uploads if insufficient balance
    // ============================================================
    const clientResult = await db.query(
      'SELECT wallet_balance FROM clients WHERE email = $1',
      [email]
    );

    if (clientResult.rows.length === 0) {
      console.log(`⚠️ User "${email}" not found in clients table.`);
      return res.status(400).json({ error: 'Account not found. Please contact admin to set up your account.' });
    }

    const currentBalance = parseFloat(clientResult.rows[0].wallet_balance);
    if (currentBalance < 11.00) {
      console.log(`🚫 BLOCKED: User "${email}" has ₹${currentBalance.toFixed(2)} — insufficient for calls (min ₹11.00 required).`);
      return res.status(400).json({ error: 'Insufficient wallet balance. Please recharge.' });
    }

    console.log(`✅ WALLET CHECK PASSED: User "${email}" has ₹${currentBalance.toFixed(2)} — proceeding with upload.`);

    // Generate unique batch ID
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const batchId = `Batch_${day}${month}${year}_${hours}${minutes}`;

    console.log(`📈 Processing ${leads.length} leads for user: ${email} in batch: ${batchId}...`);

    let addedCount = 0;
    const leadsToQueue = [];

    for (const lead of leads) {
      const { customerName, phoneNumber, customData } = lead;

      if (customerName && phoneNumber) {
        const cleanPhone = String(phoneNumber).trim();
        const customDataJson = customData && Object.keys(customData).length > 0 ? JSON.stringify(customData) : null;

        try {
          const insertResult = await db.query(
            "INSERT INTO leads (email, customer_name, phone_number, status, batch_id, custom_data) VALUES ($1, $2, $3, 'PENDING', $4, $5) RETURNING id",
            [email, customerName, cleanPhone, batchId, customDataJson]
          );
          
          const newId = insertResult.rows[0].id;
          leadsToQueue.push({ id: newId, customerName, phoneNumber: cleanPhone, email, customData: customData || {} });
          addedCount++;

        } catch (err) {
          console.error(`❌ Failed to insert lead ${customerName}:`, err.message);
        }
      }
    }

    console.log(`✅ Success! ${addedCount} leads inserted. Pushing to queue...`);
    addToQueue(leadsToQueue);
    
    res.status(200).json({ message: `Successfully queued ${addedCount} leads for calling.` });

  } catch (error) {
    console.error('🔥 CRITICAL: Failed to process leads upload:', error);
    res.status(500).json({ error: 'Internal server error processing the leads.' });
  }
};

const singleDial = async (req, res) => {
  try {
    const { email, customerName, phoneNumber } = req.body;
    if (!email || !customerName || !phoneNumber) {
      return res.status(400).json({ error: 'Missing required fields: email, customerName, phoneNumber' });
    }

    const cleanPhone = String(phoneNumber).trim();
    const batchId = 'Single_Dial';

    const insertResult = await db.query(
      "INSERT INTO leads (email, customer_name, phone_number, status, batch_id) VALUES ($1, $2, $3, 'PENDING', $4) RETURNING id",
      [email, customerName, cleanPhone, batchId]
    );

    const newId = insertResult.rows[0].id;
    addToQueue([{ id: newId, customerName, phoneNumber: cleanPhone, email }]);

    res.status(200).json({ message: "Target added to queue!" });
  } catch (error) {
    console.error('🔥 CRITICAL: Failed to process single dial:', error);
    res.status(500).json({ error: 'Internal server error processing single dial.' });
  }
};

const getLeads = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, customer_name, phone_number, status, batch_id, recording_url, transcript_summary, custom_data, created_at FROM leads ORDER BY created_at DESC'
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('🔥 CRITICAL: Failed to fetch leads:', error);
    res.status(500).json({ error: 'Internal server error fetching leads.' });
  }
};

const getClientBalance = async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    let result = await db.query(
      'SELECT wallet_balance FROM clients WHERE email = $1',
      [email]
    );
    
    // Auto-register new users with 0 balance
    if (result.rows.length === 0) {
      console.log(`🆕 New user detected (${email}), auto-registering in clients table.`);
      const insertResult = await db.query(
        'INSERT INTO clients (email, wallet_balance) VALUES ($1, 0.00) RETURNING wallet_balance',
        [email]
      );
      result = insertResult;
    }
    
    res.status(200).json({ wallet_balance: parseFloat(result.rows[0].wallet_balance) });
  } catch (error) {
    console.error('🔥 Failed to fetch client balance:', error);
    res.status(500).json({ error: 'Internal server error fetching balance.' });
  }
};

module.exports = {
  uploadLeads,
  getLeads,
  getClientBalance,
  singleDial,
};