const db = require('../config/database');

const handleVapiWebhook = async (req, res) => {
  try {
    const payload = req.body;

    // Respond immediately to Vapi to prevent timeouts
    res.status(200).send('Webhook received');

    // Extract necessary info from Vapi payload
    // Vapi structure typically puts call details in payload.message
    const message = payload.message || payload;
    const type = message.type;

    if (type === 'end-of-call-report') {
      const customerPhone = message.call?.customer?.number || message.customer?.number;
      const callSummary = message.analysis?.summary || message.summary || '';
      const callDuration = message.duration || message.call?.duration || 0; // in seconds
      const recordingUrl = message.recordingUrl || null;

      // Basic logic to classify lead based on summary text or tags
      let newStatus = 'YELLOW'; // Default: Attempted but unsure

      if (callSummary.toLowerCase().includes('interested') || callSummary.toLowerCase().includes('positive')) {
        newStatus = 'GREEN';
      } else if (callSummary.toLowerCase().includes('not interested') || callSummary.toLowerCase().includes('do not call')) {
        newStatus = 'RED';
      }

      if (customerPhone) {
        // Clean up phone number format if needed to match DB
        const cleanPhone = customerPhone.slice(-10);

        const result = await db.query(
          "UPDATE leads SET status = $1, recording_url = $2, transcript_summary = $3, updated_at = CURRENT_TIMESTAMP WHERE phone_number LIKE '%' || $4 || '%' AND status != 'GREEN'",
          [newStatus, recordingUrl, callSummary, cleanPhone]
        );

        if (result.rowCount > 0) {
          console.log(`🎯 Boom! Tahkhana updated. Lead with phone ending in ${cleanPhone} moved to ${newStatus}.`);
        } else {
          console.log(`👻 Ghost lead? Phone ending in ${cleanPhone} not found or already GREEN.`);
        }

        // ============================================================
        // WALLET BALANCE DEDUCTION
        // ============================================================
        // Calculate cost: ₹11 per minute (pro-rated by seconds)
        const callCost = (callDuration / 60) * 11;

        if (callCost > 0) {
          // Find the email associated with this lead
          const leadResult = await db.query(
            "SELECT email FROM leads WHERE phone_number LIKE '%' || $1 || '%' LIMIT 1",
            [cleanPhone]
          );

          if (leadResult.rows.length > 0) {
            const userEmail = leadResult.rows[0].email;

            // Use a transaction for atomic balance deduction
            const client = await db.pool.connect();
            try {
              await client.query('BEGIN');

              // Deduct cost from wallet (using FOR UPDATE to lock the row)
              const deductResult = await client.query(
                `UPDATE clients 
                 SET wallet_balance = wallet_balance - $1, updated_at = CURRENT_TIMESTAMP 
                 WHERE email = $2 
                 RETURNING wallet_balance`,
                [callCost.toFixed(2), userEmail]
              );

              if (deductResult.rowCount > 0) {
                await client.query('COMMIT');
                const remainingBalance = deductResult.rows[0].wallet_balance;
                console.log(`💰 WALLET DEDUCTED: ₹${callCost.toFixed(2)} from "${userEmail}" | Duration: ${callDuration}s | Remaining Balance: ₹${remainingBalance}`);
              } else {
                await client.query('ROLLBACK');
                console.error(`⚠️ WALLET ERROR: User "${userEmail}" not found in clients table. No deduction made.`);
              }
            } catch (txErr) {
              await client.query('ROLLBACK');
              console.error(`🔥 WALLET TRANSACTION FAILED for "${userEmail}":`, txErr.message);
            } finally {
              client.release();
            }
          } else {
            console.log(`⚠️ Could not find lead with phone ${cleanPhone} for wallet deduction.`);
          }
        }
      }
    } else {
      console.log(`ℹ️ Ignored Vapi webhook type: ${type}`);
    }

  } catch (error) {
    console.error('🔥 CRITICAL: Webhook processing blew up:', error);
  }
};

module.exports = {
  handleVapiWebhook,
};
