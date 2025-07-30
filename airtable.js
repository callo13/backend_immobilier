const Airtable = require('airtable');
require('dotenv').config();

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const USERS_TABLE = 'Users';

const base2 = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY_BIEN }).base(process.env.AIRTABLE_BASE_ID_BIEN);

const AVAILABLE_BIENS_TABLE = 'Biens disponibles'; // Change si ta table a un autre nom

// Fonction pour vérifier la connexion à la base de données Airtable


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

// Récupérer tous les biens disponibles
async function getAllAvailableBiens() {
  try {
    const records = await base2(AVAILABLE_BIENS_TABLE).select({
      // Récupérer tous les enregistrements
      maxRecords: 100 // Limite par défaut, peut être ajustée
      // Suppression du tri car le champ 'Created' n'existe pas
    }).all();
    
    return records.map(record => ({
      id: record.id,
      ...record.fields
    }));
  } catch (error) {
    console.error('Erreur lors de la récupération des biens:', error);
    throw error;
  }
}

module.exports = {
  findUserByGoogleId,
  createUser,
  updateUserTokens,
  getAllAvailableBiens
}; 