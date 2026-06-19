const express = require('express');
const { handleVapiWebhook } = require('../controllers/webhookController');

const router = express.Router();

router.post('/vapi', handleVapiWebhook);

module.exports = router;
