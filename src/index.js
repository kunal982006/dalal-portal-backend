const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

const leadRoutes = require('./routes/leadRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/leads', leadRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/payment', paymentRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'alive', message: 'Dalal Portal Engine is purring...' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Uncaught Exception:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Dalal Portal Backend ignited on port ${PORT}`);
  console.log(`📍 Ready to stuff the Tahkhana with murgas!`);
});
