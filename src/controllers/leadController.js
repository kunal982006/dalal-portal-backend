const xlsx = require('xlsx');
const db = require('../config/database');

// Jugaad Queue - Simple delay helper to dodge Vapi's 429 rate limit
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Hitman Supari Function - Ye Vapi ko call lagane bolega
const triggerVapiCall = async (customerName, phoneNumber) => {
  try {
    const response = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        // APNI API KEY (Bhai isko kisi ke sath share mat karna aage se)
        'Authorization': `Bearer c7fcdfd4-6b51-4a75-a454-e9e617a4a025`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phoneNumberId: "2443e5bf-1eee-45e3-b332-759cf642a3ce",
        customer: {
          number: `+91${phoneNumber}`,
          name: customerName
        },
        // TERE ASSISTANT KA ID
        assistantId: "eebc18ca-c6e8-444d-aefc-23f1f921d709"
      })
    });

    // Check agar Vapi ne error diya toh
    if (!response.ok) {
      const errData = await response.json();
      console.error(`❌ Vapi API Error for ${customerName}:`, errData);
      return;
    }

    console.log(`📞 Supari Given! Vapi is hunting ${customerName} on ${phoneNumber}...`);
  } catch (err) {
    console.error(`❌ Vapi ko supari dene mein kalesh:`, err);
  }
};

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

    console.log(`📈 Processing ${data.length} potential murgas for user: ${email}...`);

    let addedCount = 0;

    for (const row of data) {
      const customerName = row['Customer Name'] || row['Name'] || row['customer_name'] || row['client_name'];
      const phoneNumber = row['Phone Number'] || row['Phone'] || row['phone_number'];

      if (customerName && phoneNumber) {
        const cleanPhone = String(phoneNumber).trim();
        try {
          // 1. Pehle murga tahkhane mein lock karo (PENDING status ke sath)
          await db.query(
            "INSERT INTO leads (email, customer_name, phone_number, status) VALUES ($1, $2, $3, 'PENDING')",
            [email, customerName, cleanPhone]
          );
          addedCount++;

          // 2. TRIGGER DABAAO! Hitman ko piche lagao
          await triggerVapiCall(customerName, cleanPhone);

          // 3. Jugaad Queue - Thoda ruk jao bhai, Vapi ka free tier hai
          console.log(`⏳ Sleeping for 45s to respect Vapi limits... (${addedCount}/${data.length} done)`);
          await sleep(45000);
          console.log(`⏰ Woke up, moving to the next murga...`);

        } catch (err) {
          console.error(`❌ Failed to insert lead ${customerName} into Tahkhana:`, err.message);
        }
      }
    }

    console.log(`✅ Success! ${addedCount} murgas locked and hitmen dispatched.`);
    res.status(200).json({ message: `Successfully uploaded ${addedCount} leads and started calling.` });

  } catch (error) {
    console.error('🔥 CRITICAL: Failed to process leads upload:', error);
    res.status(500).json({ error: 'Internal server error processing the file.' });
  }
};

const getLeads = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, customer_name, phone_number, status, created_at FROM leads ORDER BY created_at DESC'
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
};