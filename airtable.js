const Airtable = require('airtable');
require('dotenv').config();

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const USERS_TABLE = 'Users';

const base2 = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY_BIEN }).base(process.env.AIRTABLE_BASE_ID_BIEN);

const AVAILABLE_BIENS_TABLE = 'Biens disponibles'; // Change si ta table a un autre nom
const CONTACT_CLIENT_TABLE = 'Contacts clients';

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

// Récupérer tous les biens avec les noms des contacts (résolution des liens)
async function getAllAvailableBiensWithContacts() {
  try {
    // Récupérer tous les biens
    const biensRecords = await base2(AVAILABLE_BIENS_TABLE).select({
      maxRecords: 100
    }).all();
    
    // Récupérer tous les contacts pour créer un mapping ID -> Nom
    const contactsRecords = await base2(CONTACT_CLIENT_TABLE).select({
      maxRecords: 1000
    }).all();
    
    // Créer un mapping des IDs vers les noms
    const contactsMap = {};
    contactsRecords.forEach(contact => {
      contactsMap[contact.id] = contact.fields["Nom du client"] || contact.fields['Nom complet'] || contact.id;
    });
    
    // Associer les noms aux biens
    const biensWithContacts = biensRecords.map(record => {
      const fields = { ...record.fields };
      
      // Remplacer les IDs des contacts par leurs noms
      if (fields['Contacts clients'] && Array.isArray(fields['Contacts clients'])) {
        fields['Contacts clients'] = fields['Contacts clients'].map(contactId => 
          contactsMap[contactId] || contactId
        );
      }
      
      return {
        id: record.id,
        ...fields
      };
    });
    
    return biensWithContacts;
  } catch (error) {
    console.error('Erreur lors de la récupération des biens avec contacts:', error);
    throw error;
  }
}

// Récupérer les biens selon le paramètre "Contacts clients"
async function getBiensByContactClient(contactClient) {
  try {
    // Récupérer tous les contacts pour créer un mapping Nom -> ID
    const contactsRecords = await base2(CONTACT_CLIENT_TABLE).select({
      maxRecords: 1000
    }).all();
    
    // Créer un mapping des noms vers les IDs
    const contactsMap = {};
    contactsRecords.forEach(contact => {
      const nom = contact.fields.Nom || contact.fields.Name || contact.fields['Nom complet'] || contact.id;
      contactsMap[nom] = contact.id;
    });
    
    // Déterminer si on cherche par ID ou par nom
    let contactId = contactClient;
    if (!contactClient.startsWith('rec')) {
      // Si c'est un nom, chercher l'ID correspondant
      contactId = contactsMap[contactClient];
      if (!contactId) {
        return []; // Contact non trouvé
      }
    }
    
    // Rechercher les biens avec l'ID du contact
    const records = await base2(AVAILABLE_BIENS_TABLE).select({
      filterByFormula: `{Contacts clients} = '${contactId}'`,
      maxRecords: 100
    }).all();
    
    // Récupérer les noms des contacts pour les biens trouvés
    const biensWithContacts = records.map(record => {
      const fields = { ...record.fields };
      
      // Remplacer les IDs des contacts par leurs noms
      if (fields['Contacts clients'] && Array.isArray(fields['Contacts clients'])) {
        fields['Contacts clients'] = fields['Contacts clients'].map(id => {
          const contact = contactsRecords.find(c => c.id === id);
          return contact ? (contact.fields.Nom || contact.fields.Name || contact.fields['Nom complet'] || id) : id;
        });
      }
      
      return {
        id: record.id,
        ...fields
      };
    });
    
    return biensWithContacts;
  } catch (error) {
    console.error('Erreur lors de la récupération des biens par contact client:', error);
    throw error;
  }
}

module.exports = {
  findUserByGoogleId,
  createUser,
  updateUserTokens,
  getAllAvailableBiens,
  getAllAvailableBiensWithContacts,
  getBiensByContactClient
}; 