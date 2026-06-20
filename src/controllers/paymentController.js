const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../config/database');

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key_id_for_now',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_key_secret_for_now',
});

// ────────────────────────────────────────────────
// POST /api/payment/create-order
// Creates a Razorpay order for the given amount
// ────────────────────────────────────────────────
const createOrder = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount. Must be greater than 0.' });
    }

    const options = {
      amount: Math.round(amount * 100), // Razorpay expects paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    console.log(`💳 Razorpay Order Created: ${order.id} for ₹${amount}`);

    res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    console.error('🔥 Failed to create Razorpay order:', error);
    res.status(500).json({ error: 'Failed to create payment order.' });
  }
};

// ────────────────────────────────────────────────
// POST /api/payment/verify-payment
// Verifies Razorpay signature and tops up wallet
// ────────────────────────────────────────────────
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, email, amount } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !email || !amount) {
      return res.status(400).json({ error: 'Missing required payment verification fields.' });
    }

    // Step 1: Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      console.error(`🚫 PAYMENT SIGNATURE MISMATCH for ${email}! Possible tamper attempt.`);
      return res.status(400).json({ error: 'Payment verification failed. Invalid signature.' });
    }

    console.log(`✅ Payment signature verified for ${email}. Payment ID: ${razorpay_payment_id}`);

    // Step 2: Top up wallet balance using a transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE clients 
         SET wallet_balance = wallet_balance + $1, updated_at = CURRENT_TIMESTAMP 
         WHERE email = $2 
         RETURNING wallet_balance`,
        [parseFloat(amount).toFixed(2), email]
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        console.error(`⚠️ WALLET TOP-UP FAILED: User "${email}" not found in clients table.`);
        return res.status(404).json({ error: 'User account not found.' });
      }

      await client.query('COMMIT');

      const newBalance = parseFloat(result.rows[0].wallet_balance);
      console.log(`💰 WALLET TOPPED UP: +₹${amount} for "${email}" | New Balance: ₹${newBalance.toFixed(2)}`);

      res.status(200).json({
        success: true,
        message: `₹${amount} added to wallet successfully!`,
        new_balance: newBalance,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error(`🔥 WALLET TOP-UP TRANSACTION FAILED for "${email}":`, txErr.message);
      res.status(500).json({ error: 'Failed to update wallet balance.' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('🔥 Payment verification blew up:', error);
    res.status(500).json({ error: 'Internal server error during payment verification.' });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
};
