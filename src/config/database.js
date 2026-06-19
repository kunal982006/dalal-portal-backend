const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err, client) => {
  console.error('🚨 Tahkhana Connection Error! The database is acting up:', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
