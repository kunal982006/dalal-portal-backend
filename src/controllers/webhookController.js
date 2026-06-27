const db = require('../config/database');

const handleVapiWebhook = async (req, res) => {
  try {
    const payload = req.body;

    // Respond immediately to Vapi to prevent timeouts
    res.status(200).send('Webhook received');

    // ============================================================
    // DEBUG: Log the FULL webhook payload so we can see what Vapi sends
    // ============================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📩 VAPI WEBHOOK RECEIVED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Full Payload:', JSON.stringify(payload, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Extract necessary info from Vapi payload
    // Vapi structure typically puts call details in payload.message
    const message = payload.message || payload;
    const type = message.type;

    console.log(`📋 Webhook type: ${type}`);

    if (type === 'end-of-call-report') {
      const customerPhone = message.call?.customer?.number || message.customer?.number;

      // ============================================================
      // EXTRACT STRUCTURED DATA (from VAPI Analysis → Structured Outputs)
      // This is where call_outcome and call_summary fields live
      // ============================================================
      const structuredData = message.analysis?.structuredData 
        || message.call?.analysis?.structuredData 
        || {};

      const callOutcome = structuredData.call_outcome || '';
      const structuredSummary = structuredData.call_summary || '';

      // Try ALL possible paths where Vapi might put the summary/analysis
      const callSummary = structuredSummary
        || message.analysis?.summary 
        || message.call?.analysis?.summary 
        || message.artifact?.summary
        || message.call?.artifact?.summary
        || message.summary 
        || message.transcript 
        || message.call?.transcript
        || message.artifact?.transcript
        || '';

      const callDuration = message.call?.duration || message.duration || 0;

      // Try ALL possible paths for recording URL
      const recordingUrl = message.recordingUrl 
        || message.call?.recordingUrl 
        || message.artifact?.recordingUrl
        || message.call?.artifact?.recordingUrl
        || null;

      // Log extracted values for debugging
      console.log('🔍 EXTRACTED VALUES:');
      console.log('  Phone:', customerPhone);
      console.log('  Structured Data:', JSON.stringify(structuredData));
      console.log('  call_outcome:', callOutcome || '⚠️ EMPTY');
      console.log('  call_summary:', structuredSummary || '⚠️ EMPTY');
      console.log('  Fallback Summary:', callSummary || '⚠️ EMPTY');
      console.log('  Duration:', callDuration, 'seconds');
      console.log('  Recording URL:', recordingUrl || '⚠️ EMPTY');
      console.log('  Analysis object:', JSON.stringify(message.analysis || message.call?.analysis || 'NOT FOUND'));
      console.log('  Artifact object:', JSON.stringify(message.artifact || message.call?.artifact || 'NOT FOUND'));

      // ============================================================
      // STATUS CLASSIFICATION
      // Priority 1: Use call_outcome from VAPI Structured Outputs
      // Priority 2: Fall back to keyword matching on summary text
      // ============================================================
      let newStatus = 'YELLOW'; // Default: Follow-up / attempted but unsure

      const outcomeLower = callOutcome.toLowerCase().trim();

      if (outcomeLower === 'not_interested' || outcomeLower === 'not interested') {
        newStatus = 'RED';
      } else if (outcomeLower === 'interested') {
        newStatus = 'GREEN';
      } else if (outcomeLower === 'follow_up' || outcomeLower === 'follow up') {
        newStatus = 'YELLOW';
      } else if (outcomeLower === 'no_answer' || outcomeLower === 'no answer') {
        newStatus = 'YELLOW';
      } else if (callSummary) {
        // Fallback: keyword matching on summary text
        // CRITICAL: Check "not interested" BEFORE "interested" because
        // "not interested" contains the substring "interested"!
        const summaryLower = callSummary.toLowerCase();

        if (summaryLower.includes('not interested') 
          || summaryLower.includes('do not call') 
          || summaryLower.includes('don\'t call')
          || summaryLower.includes('not looking')
          || summaryLower.includes('refused')
          || summaryLower.includes('rejected')
          || summaryLower.includes('no interest')
          || summaryLower.includes('not willing')) {
          newStatus = 'RED';
        } else if (summaryLower.includes('interested') 
          || summaryLower.includes('positive') 
          || summaryLower.includes('willing')
          || summaryLower.includes('agreed')
          || summaryLower.includes('wants to proceed')) {
          newStatus = 'GREEN';
        }
      }

      console.log(`🏷️ Status classified as: ${newStatus} (source: ${callOutcome ? 'structured_output' : 'keyword_matching'})`);

      if (customerPhone) {
        // Clean up phone number format if needed to match DB
        const cleanPhone = customerPhone.slice(-10);

        const result = await db.query(
          "UPDATE leads SET status = $1, recording_url = $2, transcript_summary = $3, updated_at = CURRENT_TIMESTAMP WHERE phone_number LIKE '%' || $4 || '%' AND status != 'GREEN'",
          [newStatus, recordingUrl, callSummary || null, cleanPhone]
        );

        if (result.rowCount > 0) {
          console.log(`🎯 Boom! Lead with phone ending in ${cleanPhone} → ${newStatus}.`);
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
      } else {
        console.log('⚠️ No customer phone found in webhook payload!');
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
