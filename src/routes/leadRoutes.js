const express = require('express');
const multer = require('multer');
const { uploadLeads, getLeads, getClientBalance, singleDial } = require('../controllers/leadController');

const router = express.Router();

// Using memory storage for multer since we just need the buffer to parse via xlsx
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', getLeads);
router.get('/balance/:email', getClientBalance);
router.post('/upload', upload.single('file'), uploadLeads);
router.post('/single-dial', singleDial);

module.exports = router;
