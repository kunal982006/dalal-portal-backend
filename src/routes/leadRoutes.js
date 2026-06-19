const express = require('express');
const multer = require('multer');
const { uploadLeads, getLeads } = require('../controllers/leadController');

const router = express.Router();

// Using memory storage for multer since we just need the buffer to parse via xlsx
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', getLeads);
router.post('/upload', upload.single('file'), uploadLeads);

module.exports = router;
