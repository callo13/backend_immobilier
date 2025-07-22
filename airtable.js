const Airtable = require('airtable');
require('dotenv').config();

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const USERS_TABLE = 'Users'; // Change si ta table a un autre nom

// Trouver un utilisateur par google_id
async function findUserByGoogleId(googleId) {
  const records = await base(USERS_TABLE).select({
    filterByFormula: `{google_id} = '${googleId}'`,
    maxRecords: 1
  }).firstPage();
  return records.length ? records[0] : null;
}

// Créer un utilisateur
async function createUser({ google_id, email, name, access_token, refresh_token, scope, expiry_date, created_at }) {
  const created = await base(USERS_TABLE).create([
    {
      fields: {
        google_id,
        email,
        name,
        access_token,
        refresh_token,
        scope,
        expiry_date,
        created_at
      }
    }
  ]);
  return created[0];
}

// Mettre à jour un utilisateur (tokens)
async function updateUserTokens(recordId, { access_token, refresh_token, scope, expiry_date }) {
  return base(USERS_TABLE).update(recordId, {
    access_token,
    refresh_token,
    scope,
    expiry_date
  });
}

module.exports = {
  findUserByGoogleId,
  createUser,
  updateUserTokens
}; 