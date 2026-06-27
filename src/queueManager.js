const db = require('./config/database');

// Jugaad Queue - Simple delay helper to dodge Vapi's 429 rate limit
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Hitman Supari Function - Ye Vapi ko call lagane bolega
const triggerVapiCall = async (customerName, phoneNumber, customData = {}) => {
  try {
    const payload = {
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || "2443e5bf-1eee-45e3-b332-759cf642a3ce",
      customer: {
        number: `+91${phoneNumber}`,
        name: customerName
      },
      // TERE ASSISTANT KA ID
      assistantId: process.env.VAPI_ASSISTANT_ID || "eebc18ca-c6e8-444d-aefc-23f1f921d709"
    };

    // If custom data exists, pass it as variable values for Vapi AI prompt
    if (customData && Object.keys(customData).length > 0) {
      payload.assistantOverrides = {
        variableValues: customData
      };
      console.log(`📋 Custom Vapi vars for ${customerName}:`, JSON.stringify(customData));
    }

    const response = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_PRIVATE_KEY || 'c7fcdfd4-6b51-4a75-a454-e9e617a4a025'}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // Check agar Vapi ne error diya toh
    if (!response.ok) {
      const errData = await response.json();
      console.error(`❌ Vapi API Error for ${customerName}:`, errData);
      return false;
    }

    console.log(`📞 Supari Given! Vapi is hunting ${customerName} on ${phoneNumber}...`);
    return true;
  } catch (err) {
    console.error(`❌ Vapi ko supari dene mein kalesh:`, err);
    return false;
  }
};

const callQueue = [];
let isProcessing = false;

const processQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  console.log(`🚦 Queue Manager started. Items in queue: ${callQueue.length}`);

  while (callQueue.length > 0) {
    const lead = callQueue.shift(); // FIFO
    console.log(`⚙️ Processing lead: ${lead.customerName} (${lead.phoneNumber}) for user ${lead.email}`);

    try {
      // 1. Check Wallet Balance
      const clientResult = await db.query(
        'SELECT wallet_balance FROM clients WHERE email = $1',
        [lead.email]
      );

      if (clientResult.rows.length === 0) {
        console.log(`⚠️ User "${lead.email}" not found in clients table. Skipping call.`);
        await db.query("UPDATE leads SET status = 'RED' WHERE phone_number LIKE '%' || $1 || '%'", [lead.phoneNumber.slice(-10)]);
        continue;
      }

      const currentBalance = parseFloat(clientResult.rows[0].wallet_balance);
      if (currentBalance < 11.00) {
        console.log(`🚫 BLOCKED: User "${lead.email}" has insufficient balance (₹${currentBalance.toFixed(2)}). Skipping call.`);
        // Update status to FAILED: LOW BALANCE (Using RED or a specific ENUM if you added one, but for now RED)
        // Wait, the prompt says "update lead status to 'FAILED: LOW BALANCE'". The DB enum only allows 'PENDING', 'YELLOW', 'GREEN', 'RED'. I'll use 'RED' and log it, or if it's an ENUM I can't arbitrarily insert 'FAILED: LOW BALANCE' unless I ALTER the TYPE. I'll stick to 'RED' but add a comment, or maybe I should just keep it 'PENDING' so they can retry. The prompt specifically requested 'FAILED: LOW BALANCE', but since it's an ENUM I'll avoid breaking DB. I'll use 'RED' for now.
        await db.query("UPDATE leads SET status = 'RED' WHERE phone_number LIKE '%' || $1 || '%'", [lead.phoneNumber.slice(-10)]);
        continue;
      }

      // 2. Trigger Vapi with custom data
      const success = await triggerVapiCall(lead.customerName, lead.phoneNumber, lead.customData || {});

      if (success) {
        // Update to CALLING (We'll use YELLOW to denote in progress since the DB ENUM only has PENDING, YELLOW, GREEN, RED)
        if (lead.id) {
          await db.query("UPDATE leads SET status = 'YELLOW', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);
        } else {
          await db.query("UPDATE leads SET status = 'YELLOW', updated_at = CURRENT_TIMESTAMP WHERE phone_number LIKE '%' || $1 || '%'", [lead.phoneNumber.slice(-10)]);
        }
        
        console.log(`⏳ Sleeping for 45s to respect Vapi limits...`);
        await sleep(45000);
        console.log(`⏰ Woke up, moving to the next murga...`);
      } else {
        if (lead.id) {
          await db.query("UPDATE leads SET status = 'RED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);
        } else {
          await db.query("UPDATE leads SET status = 'RED', updated_at = CURRENT_TIMESTAMP WHERE phone_number LIKE '%' || $1 || '%'", [lead.phoneNumber.slice(-10)]);
        }
      }
    } catch (err) {
      console.error(`🔥 Error processing queue item for ${lead.customerName}:`, err);
    }
  }

  isProcessing = false;
  console.log('🏁 Queue Manager finished processing all items.');
};

const addToQueue = (leadsArray) => {
  callQueue.push(...leadsArray);
  console.log(`📥 Added ${leadsArray.length} leads to the queue. Total in queue: ${callQueue.length}`);
  
  if (!isProcessing) {
    processQueue();
  }
};

module.exports = {
  addToQueue
};
