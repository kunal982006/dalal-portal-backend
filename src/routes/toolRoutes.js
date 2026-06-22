const express = require('express');
const router = express.Router();
const toolController = require('../controllers/toolController');

// Public route for Vapi AI to check personal loan eligibility
router.post('/check-eligibility', toolController.checkEligibility);

module.exports = router;
