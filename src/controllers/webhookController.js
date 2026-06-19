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
      const callSummary = message.summary || '';

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
          "UPDATE leads SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE phone_number LIKE '%' || $2 || '%' AND status != 'GREEN'",
          [newStatus, cleanPhone]
        );

        if (result.rowCount > 0) {
          console.log(`🎯 Boom! Tahkhana updated. Lead with phone ending in ${cleanPhone} moved to ${newStatus}.`);
        } else {
          console.log(`👻 Ghost lead? Phone ending in ${cleanPhone} not found or already GREEN.`);
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
