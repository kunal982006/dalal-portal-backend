const express = require('express');
const { uploadLeads, getLeads, getClientBalance, singleDial } = require('../controllers/leadController');

const router = express.Router();

router.get('/', getLeads);
router.get('/balance/:email', getClientBalance);
router.post('/upload', uploadLeads);
router.post('/single-dial', singleDial);

module.exports = router;
