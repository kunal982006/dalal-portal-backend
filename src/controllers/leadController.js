const xlsx = require('xlsx');
const db = require('../config/database');

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

    const { client_name } = req.body;
    if (!client_name) {
      return res.status(400).json({ error: 'Client name is required.' });
    }

    // Parse Excel file
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      return res.status(400).json({ error: 'The uploaded file is empty.' });
    }

    console.log(`📈 Processing ${data.length} potential murgas for client: ${client_name}...`);

    let addedCount = 0;

    for (const row of data) {
      const customerName = row['Customer Name'] || row['Name'] || row['customer_name'] || row['client_name'];
      const phoneNumber = row['Phone Number'] || row['Phone'] || row['phone_number'];

      if (customerName && phoneNumber) {
        const cleanPhone = String(phoneNumber).trim();
        try {
          // 1. Pehle murga tahkhane mein lock karo (PENDING status ke sath)
          await db.query(
            "INSERT INTO leads (client_name, customer_name, phone_number, status) VALUES ($1, $2, $3, 'PENDING')",
            [client_name, customerName, cleanPhone]
          );
          addedCount++;

          // 2. TRIGGER DABAAO! Hitman ko piche lagao
          await triggerVapiCall(customerName, cleanPhone);

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
      'SELECT id, client_name, customer_name, phone_number, status, created_at FROM leads ORDER BY created_at DESC'
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('🔥 CRITICAL: Failed to fetch leads:', error);
    res.status(500).json({ error: 'Internal server error fetching leads.' });
  }
};

module.exports = {
  uploadLeads,
  getLeads,
};