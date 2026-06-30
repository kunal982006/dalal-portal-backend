const db = require('./config/database');

// ═══════════════════════════════════════════════════════════════
// BATCH CONCURRENT QUEUE MANAGER
// Fires BATCH_SIZE calls concurrently, waits for ALL to finish
// (via webhook or timeout), then fires the next batch.
// ═══════════════════════════════════════════════════════════════

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 10;
const CALL_TIMEOUT_MS = parseInt(process.env.CALL_TIMEOUT_MS, 10) || 300000; // 5 minutes

// ── Active Call Tracker ─────────────────────────────────────
// Map<cleanPhone, { resolve, timer, leadId, customerName }>
// When a webhook arrives for a phone, we resolve its promise
// so the batch knows that call is done.
const pendingCalls = new Map();

// ── Vapi Call Trigger ───────────────────────────────────────
const triggerVapiCall = async (customerName, phoneNumber, customData = {}) => {
  try {
    const payload = {
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || '2443e5bf-1eee-45e3-b332-759cf642a3ce',
      customer: {
        number: `+91${phoneNumber}`,
        name: customerName
      },
      assistantId: process.env.VAPI_ASSISTANT_ID || 'eebc18ca-c6e8-444d-aefc-23f1f921d709'
    };

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

    if (!response.ok) {
      const errData = await response.json();
      console.error(`❌ Vapi API Error for ${customerName}:`, errData);
      return false;
    }

    console.log(`📞 Call fired for ${customerName} on ${phoneNumber}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to trigger Vapi call for ${customerName}:`, err.message);
    return false;
  }
};

// ── Queue State ─────────────────────────────────────────────
const callQueue = [];
let isProcessing = false;

// ── Resolve a Pending Call (called from webhookController) ──
const resolveCall = (phoneNumber) => {
  const cleanPhone = String(phoneNumber).slice(-10);

  if (pendingCalls.has(cleanPhone)) {
    const entry = pendingCalls.get(cleanPhone);
    clearTimeout(entry.timer);
    pendingCalls.delete(cleanPhone);
    console.log(`✅ Call completed for ${entry.customerName} (${cleanPhone}) — resolved via webhook`);
    entry.resolve('webhook');
    return true;
  }

  return false;
};

// ── Process a Single Lead Within a Batch ────────────────────
const processLead = async (lead) => {
  const cleanPhone = String(lead.phoneNumber).slice(-10);

  try {
    // 1. Check wallet balance
    const clientResult = await db.query(
      'SELECT wallet_balance FROM clients WHERE email = $1',
      [lead.email]
    );

    if (clientResult.rows.length === 0) {
      console.log(`⚠️ User "${lead.email}" not found. Skipping ${lead.customerName}.`);
      await db.query(
        "UPDATE leads SET status = 'RED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [lead.id]
      );
      return { status: 'skipped', reason: 'user_not_found', lead };
    }

    const currentBalance = parseFloat(clientResult.rows[0].wallet_balance);
    if (currentBalance < 11.00) {
      console.log(`🚫 Insufficient balance for "${lead.email}" (₹${currentBalance.toFixed(2)}). Skipping ${lead.customerName}.`);
      await db.query(
        "UPDATE leads SET status = 'RED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [lead.id]
      );
      return { status: 'skipped', reason: 'low_balance', lead };
    }

    // 2. Fire the Vapi call
    const success = await triggerVapiCall(lead.customerName, lead.phoneNumber, lead.customData || {});

    if (!success) {
      await db.query(
        "UPDATE leads SET status = 'RED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [lead.id]
      );
      return { status: 'failed', reason: 'vapi_error', lead };
    }

    // 3. Mark as YELLOW (in-progress) and wait for webhook
    await db.query(
      "UPDATE leads SET status = 'YELLOW', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [lead.id]
    );

    // 4. Create a promise that resolves when webhook arrives or timeout hits
    const completionPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pendingCalls.has(cleanPhone)) {
          pendingCalls.delete(cleanPhone);
          console.log(`⏰ Timeout for ${lead.customerName} (${cleanPhone}) — no webhook received in ${CALL_TIMEOUT_MS / 1000}s`);
          resolve('timeout');
        }
      }, CALL_TIMEOUT_MS);

      pendingCalls.set(cleanPhone, {
        resolve,
        timer,
        leadId: lead.id,
        customerName: lead.customerName
      });
    });

    // Wait for this call to complete
    const result = await completionPromise;
    return { status: 'completed', resolution: result, lead };

  } catch (err) {
    console.error(`🔥 Error processing ${lead.customerName}:`, err.message);
    return { status: 'error', reason: err.message, lead };
  }
};

// ── Process the Queue in Batches ────────────────────────────
const processQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  const totalLeads = callQueue.length;
  const totalBatches = Math.ceil(totalLeads / BATCH_SIZE);

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🚀 BATCH QUEUE STARTED`);
  console.log(`   Total leads: ${totalLeads} | Batch size: ${BATCH_SIZE} | Batches: ${totalBatches}`);
  console.log('═══════════════════════════════════════════════════════');

  let batchNumber = 0;

  while (callQueue.length > 0) {
    batchNumber++;
    const batch = callQueue.splice(0, BATCH_SIZE);

    console.log('');
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📦 BATCH ${batchNumber}/${totalBatches} — Firing ${batch.length} calls concurrently`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Fire ALL calls in this batch concurrently
    const results = await Promise.allSettled(
      batch.map(lead => processLead(lead))
    );

    // Log batch results
    const summary = { completed: 0, skipped: 0, failed: 0, errors: 0 };
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const val = result.value;
        if (val.status === 'completed') summary.completed++;
        else if (val.status === 'skipped') summary.skipped++;
        else if (val.status === 'failed') summary.failed++;
        else summary.errors++;
      } else {
        summary.errors++;
        console.error(`🔥 Unexpected batch error:`, result.reason);
      }
    });

    console.log(`📊 BATCH ${batchNumber} RESULTS: ✅ ${summary.completed} completed | ⏭️ ${summary.skipped} skipped | ❌ ${summary.failed} failed | 🔥 ${summary.errors} errors`);

    if (callQueue.length > 0) {
      console.log(`⏳ Moving to next batch... (${callQueue.length} leads remaining)`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('🏁 ALL BATCHES COMPLETE — Queue is empty');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  isProcessing = false;
};

// ── Public API ──────────────────────────────────────────────
const addToQueue = (leadsArray) => {
  callQueue.push(...leadsArray);
  console.log(`📥 Added ${leadsArray.length} leads to queue. Total pending: ${callQueue.length}`);

  if (!isProcessing) {
    processQueue();
  }
};

const getQueueStatus = () => ({
  queueLength: callQueue.length,
  isProcessing,
  activeCalls: pendingCalls.size,
  batchSize: BATCH_SIZE
});

module.exports = {
  addToQueue,
  resolveCall,
  getQueueStatus,
};
