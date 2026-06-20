const express = require('express');
const { verifyAdmin, getClients, rechargeClient } = require('../controllers/adminController');

const router = express.Router();

// All admin routes are protected by the verifyAdmin middleware
router.get('/clients', verifyAdmin, getClients);
router.post('/recharge', verifyAdmin, rechargeClient);

module.exports = router;
