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
      // ============================================================
      const structuredData = message.analysis?.structuredData 
        || message.call?.analysis?.structuredData 
        || {};

      const callOutcome = structuredData.call_outcome || '';
      const structuredSummary = structuredData.call_summary || '';

      // ============================================================
      // AI SUMMARY - Only use actual AI-generated summaries, NOT raw transcript!
      // Raw transcript is the full conversation text - that's NOT a summary.
      // ============================================================
      const callSummary = structuredSummary
        || message.analysis?.summary 
        || message.call?.analysis?.summary 
        || message.artifact?.summary
        || message.call?.artifact?.summary
        || message.summary 
        || '';  // DO NOT fall back to transcript — it's not a summary!

      // Raw transcript (kept separate, only for keyword matching fallback)
      const rawTranscript = message.transcript 
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

      // Success evaluation from VAPI (now enabled)
      const successEval = (message.analysis?.successEvaluation 
        || message.call?.analysis?.successEvaluation 
        || '').toLowerCase().trim();

      // Log extracted values for debugging
      console.log('🔍 EXTRACTED VALUES:');
      console.log('  Phone:', customerPhone);
      console.log('  Structured Data:', JSON.stringify(structuredData));
      console.log('  call_outcome:', callOutcome || '⚠️ EMPTY');
      console.log('  call_summary:', structuredSummary || '⚠️ EMPTY');
      console.log('  AI Summary:', callSummary || '⚠️ EMPTY');
      console.log('  Raw Transcript:', rawTranscript ? `(${rawTranscript.length} chars)` : '⚠️ EMPTY');
      console.log('  Success Evaluation:', successEval || '⚠️ EMPTY');
      console.log('  Duration:', callDuration, 'seconds');
      console.log('  Recording URL:', recordingUrl || '⚠️ EMPTY');
      console.log('  Full Analysis:', JSON.stringify(message.analysis || message.call?.analysis || 'NOT FOUND'));

      // ============================================================
      // STATUS CLASSIFICATION
      // Priority 1: Use call_outcome from Structured Outputs
      // Priority 2: Use successEvaluation from VAPI
      // Priority 3: Keyword match on AI summary
      // Priority 4: Keyword match on raw transcript
      // ============================================================
      let newStatus = 'YELLOW'; // Default: Follow-up
      let statusSource = 'default';

      const outcomeLower = callOutcome.toLowerCase().trim();

      // Priority 1: Structured output call_outcome
      if (outcomeLower === 'not_interested' || outcomeLower === 'not interested') {
        newStatus = 'RED';
        statusSource = 'structured_output';
      } else if (outcomeLower === 'interested') {
        newStatus = 'GREEN';
        statusSource = 'structured_output';
      } else if (outcomeLower === 'follow_up' || outcomeLower === 'follow up') {
        newStatus = 'YELLOW';
        statusSource = 'structured_output';
      } else if (outcomeLower === 'no_answer' || outcomeLower === 'no answer') {
        newStatus = 'YELLOW';
        statusSource = 'structured_output';
      } 
      // Priority 2: Success evaluation
      else if (successEval === 'false' || successEval === 'unsuccessful') {
        newStatus = 'RED';
        statusSource = 'success_evaluation';
      } else if (successEval === 'true' || successEval === 'successful') {
        newStatus = 'GREEN';
        statusSource = 'success_evaluation';
      } 
      // Priority 3 & 4: Keyword matching on summary or transcript
      else {
        const textToAnalyze = (callSummary || rawTranscript).toLowerCase();
        if (textToAnalyze) {
          // CRITICAL: Check negative keywords FIRST
          if (textToAnalyze.includes('not interested') 
            || textToAnalyze.includes('do not call') 
            || textToAnalyze.includes("don't call")
            || textToAnalyze.includes('not looking')
            || textToAnalyze.includes('refused')
            || textToAnalyze.includes('rejected')
            || textToAnalyze.includes('no interest')
            || textToAnalyze.includes('not willing')
            || textToAnalyze.includes('nahi chahiye')
            || textToAnalyze.includes('interest nahi')
            || textToAnalyze.includes('mat karo call')
            || textToAnalyze.includes('dobara mat')) {
            newStatus = 'RED';
            statusSource = 'keyword_matching';
          } else if (textToAnalyze.includes('interested') 
            || textToAnalyze.includes('positive') 
            || textToAnalyze.includes('willing')
            || textToAnalyze.includes('agreed')
            || textToAnalyze.includes('wants to proceed')
            || textToAnalyze.includes('haan')
            || textToAnalyze.includes('chahiye')) {
            newStatus = 'GREEN';
            statusSource = 'keyword_matching';
          }
        }
      }

      console.log(`🏷️ Status classified as: ${newStatus} (source: ${statusSource})`);

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
