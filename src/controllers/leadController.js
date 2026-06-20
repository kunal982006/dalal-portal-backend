const xlsx = require('xlsx');
const db = require('../config/database');
const { addToQueue } = require('../queueManager');

const uploadLeads = async (req, res) => {
  try {
    if (!req.file) {
      console.log('⚠️ No file provided. Empty hands!');
      return res.status(400).json({ error: 'Please upload an Excel file.' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'User email is required.' });
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

    // Parse Excel file
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      return res.status(400).json({ error: 'The uploaded file is empty.' });
    }

    // Generate unique batch ID
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const batchId = `Batch_${day}${month}${year}_${hours}${minutes}`;

    console.log(`📈 Processing ${data.length} potential murgas for user: ${email} in batch: ${batchId}...`);

    let addedCount = 0;
    const leadsToQueue = [];

    for (const row of data) {
      const customerName = row['Customer Name'] || row['Name'] || row['customer_name'] || row['client_name'];
      const phoneNumber = row['Phone Number'] || row['Phone'] || row['phone_number'];

      if (customerName && phoneNumber) {
        const cleanPhone = String(phoneNumber).trim();
        try {
          // 1. Pehle murga tahkhane mein lock karo (PENDING status ke sath)
          await db.query(
            "INSERT INTO leads (email, customer_name, phone_number, status, batch_id) VALUES ($1, $2, $3, 'PENDING', $4)",
            [email, customerName, cleanPhone, batchId]
          );
          
          leadsToQueue.push({ customerName, phoneNumber: cleanPhone, email });
          addedCount++;

        } catch (err) {
          console.error(`❌ Failed to insert lead ${customerName} into Tahkhana:`, err.message);
        }
      }
    }

    console.log(`✅ Success! ${addedCount} murgas locked. Pushing to queue...`);
    addToQueue(leadsToQueue);
    
    res.status(200).json({ message: `Successfully queued ${addedCount} leads for calling.` });

  } catch (error) {
    console.error('🔥 CRITICAL: Failed to process leads upload:', error);
    res.status(500).json({ error: 'Internal server error processing the file.' });
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

    await db.query(
      "INSERT INTO leads (email, customer_name, phone_number, status, batch_id) VALUES ($1, $2, $3, 'PENDING', $4)",
      [email, customerName, cleanPhone, batchId]
    );

    addToQueue([{ customerName, phoneNumber: cleanPhone, email }]);

    res.status(200).json({ message: "Target added to queue!" });
  } catch (error) {
    console.error('🔥 CRITICAL: Failed to process single dial:', error);
    res.status(500).json({ error: 'Internal server error processing single dial.' });
  }
};

const getLeads = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, customer_name, phone_number, status, batch_id, recording_url, transcript_summary, created_at FROM leads ORDER BY created_at DESC'
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
    const result = await db.query(
      'SELECT wallet_balance FROM clients WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
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