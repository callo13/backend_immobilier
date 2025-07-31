import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { findUserByGoogleId, createUser, updateUserTokens, getAllAvailableBiens, getAllAvailableBiensWithContacts, getBiensByContactClient } from './airtable.js';

dotenv.config();

const app = express();
app.use(cookieParser());

// Configuration CORS dynamique selon l'environnement
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL || 'https://votre-frontend.onrender.com']
    : 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposedHeaders: ['Set-Cookie']
};

app.use(cors(corsOptions));

// Stockage temporaire du token (à remplacer par une base de données plus tard)
let oauth2Tokens = null;

// Configuration OAuth2
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Log de la configuration OAuth2 pour debug
console.log('[OAUTH CONFIG] Configuration OAuth2:', {
  clientId: process.env.GOOGLE_CLIENT_ID ? 'Présent' : 'Manquant',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'Présent' : 'Manquant',
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'Non défini',
  nodeEnv: process.env.NODE_ENV || 'Non défini'
});

// 1. Route pour démarrer l'authentification Google
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ];
  
  // Ajouter des paramètres pour éviter les problèmes de code expiré
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force le consentement à chaque fois
    include_granted_scopes: true
  });
  
  console.log('[AUTH] /auth/google appelé, redirection vers Google OAuth2');
  console.log('[AUTH] URL générée:', url);
  res.redirect(url);
  console.log('[AUTH] Réponse : 302 Redirect');
});

// 2. Callback Google OAuth2
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    console.log('[CALLBACK] Code manquant, réponse : 400 Bad Request');
    return res.status(400).send('Code manquant');
  }
  
  console.log('[CALLBACK] Code reçu, tentative de récupération du token...');
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('[CALLBACK] Tokens récupérés avec succès');
    
    oauth2Client.setCredentials(tokens);
    oauth2Tokens = tokens;

    // Récupérer les infos utilisateur (id, email, name)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();
    const userId = userinfo.data.id;
    const email = userinfo.data.email;
    const name = userinfo.data.name;

    console.log('[CALLBACK] Informations utilisateur récupérées:', {
      userId: userId,
      email: email,
      name: name
    });

    // Stocker ou mettre à jour l'utilisateur dans Airtable
    const expiry_date_iso = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString().split('.')[0] + 'Z' : null;
    const created_at_iso = new Date().toISOString().split('.')[0] + 'Z';
    let user = await findUserByGoogleId(userId);
    if (user) {
      await updateUserTokens(user.id, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        expiry_date: expiry_date_iso
      });
      console.log(`[CALLBACK] Utilisateur ${email} mis à jour dans Airtable.`);
    } else {
      user = await createUser({
        google_id: userId,
        email,
        name,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        expiry_date: expiry_date_iso,
        created_at: created_at_iso
      });
      console.log(`[CALLBACK] Nouvel utilisateur ${email} créé dans Airtable.`);
    }

    // Générer un JWT
    const token = jwt.sign({ userId, email }, process.env.SESSION_SECRET, { expiresIn: '7d' });

    // Placer le JWT dans un cookie sécurisé
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Secure en production
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Important pour CORS en production
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
      domain: process.env.NODE_ENV === 'production' ? undefined : undefined, // Laissez le navigateur gérer le domaine
      path: '/'
    });

    // Rediriger vers le frontend (URL dynamique selon l'environnement)
    const frontendUrl = process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL || 'https://votre-frontend.onrender.com'
      : 'http://localhost:5173';
    
    res.redirect(`${frontendUrl}/oauth-success`);
    console.log('[CALLBACK] Authentification réussie, cookie envoyé, redirection vers le front. Réponse : 302 Redirect');
  } catch (err) {
    console.log('[CALLBACK] Erreur détaillée lors de la récupération du token:', {
      message: err.message,
      code: err.code,
      status: err.status,
      details: err.details,
      stack: err.stack
    });
    
    // Gestion spécifique de l'erreur invalid_grant
    if (err.message && err.message.includes('invalid_grant')) {
      console.log('[CALLBACK] Erreur invalid_grant détectée - le code a expiré ou a déjà été utilisé');
      return res.status(400).send(`
        <h1>Erreur d'authentification</h1>
        <p>Le code d'autorisation a expiré ou a déjà été utilisé.</p>
        <p>Veuillez <a href="/auth/google">réessayer l'authentification</a>.</p>
        <p>Erreur: ${err.message}</p>
      `);
    }
    
    res.status(500).send(`
      <h1>Erreur serveur</h1>
      <p>Une erreur s'est produite lors de l'authentification.</p>
      <p>Erreur: ${err.message}</p>
      <p><a href="/auth/google">Réessayer</a></p>
    `);
  }
});

// 3. Récupération des événements du calendrier
app.get('/api/events', async (req, res) => {
  // 1. Lire et vérifier le JWT
  const token = req.cookies.token;
  if (!token) {
    console.log('[EVENTS] Pas de token, réponse : 401 Unauthorized');
    return res.status(401).json({ error: 'Non authentifié' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.SESSION_SECRET);
  } catch (err) {
    console.log('[EVENTS] Token invalide, réponse : 401 Unauthorized');
    return res.status(401).json({ error: 'Token invalide' });
  }

  // 2. Chercher l'utilisateur en base
  let user;
  try {
    user = await findUserByGoogleId(decoded.userId);
  } catch (err) {
    console.log('[EVENTS] Erreur lors de la recherche utilisateur Airtable :', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
  if (!user) {
    console.log('[EVENTS] Utilisateur non trouvé, réponse : 404 Not Found');
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  // 3. Utiliser les tokens pour Google
  const userFields = user.fields;
  console.log('[EVENTS] Tentative de récupération des événements pour:', userFields.email);
  
  const oauth2ClientUser = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  // Configuration des tokens avec gestion d'erreur
  try {
    oauth2ClientUser.setCredentials({
      access_token: userFields.access_token,
      refresh_token: userFields.refresh_token,
      scope: userFields.scope,
      expiry_date: userFields.expiry_date ? new Date(userFields.expiry_date).getTime() : undefined
    });
  } catch (error) {
    console.log('[EVENTS] Erreur lors de la configuration des tokens:', error);
    return res.status(401).json({ 
      error: 'Tokens invalides',
      message: 'Veuillez vous reconnecter'
    });
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2ClientUser });

  // Récupérer les dates de la requête ou utiliser des valeurs par défaut
  const { start, end } = req.query;
  const timeMin = start ? new Date(start).toISOString() : new Date().toISOString();
  const defaultEnd = new Date();
  defaultEnd.setDate(defaultEnd.getDate() + 7);
  const timeMax = end ? new Date(end).toISOString() : defaultEnd.toISOString();

  try {
    const events = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    });
    console.log('[EVENTS] Événements récupérés pour', userFields.email, ', réponse : 200 OK');
    res.json(events.data.items);
  } catch (err) {
    console.log('[EVENTS] Erreur détaillée lors de la récupération des événements Google:', {
      message: err.message,
      code: err.code,
      status: err.status,
      details: err.details
    });
    
    // Gestion spécifique de l'erreur invalid_grant
    if (err.message && err.message.includes('invalid_grant')) {
      console.log('[EVENTS] Erreur invalid_grant détectée - tokens expirés');
      return res.status(401).json({ 
        error: 'Tokens expirés',
        message: 'Veuillez vous reconnecter pour rafraîchir vos tokens',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    res.status(500).json({ 
      error: 'Erreur lors de la récupération des événements',
      details: err.message
    });
  }
});

// Route pour récupérer tous les biens disponibles
app.get('/api/biens', async (req, res) => {
  try {
    const biens = await getAllAvailableBiens();
    console.log(`[BIENS] ${biens.length} biens récupérés, réponse : 200 OK`);
    res.json({
      success: true,
      count: biens.length,
      data: biens
    });
  } catch (error) {
    console.log('[BIENS] Erreur lors de la récupération des biens:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des biens',
      error: error.message
    });
  }
});

// Route pour récupérer tous les biens avec les noms des contacts
app.get('/api/biens/with-contacts', async (req, res) => {
  try {
    const biens = await getAllAvailableBiensWithContacts();
    console.log(`[BIENS WITH CONTACTS] ${biens.length} biens récupérés avec contacts, réponse : 200 OK`);
    res.json({
      success: true,
      count: biens.length,
      data: biens
    });
  } catch (error) {
    console.log('[BIENS WITH CONTACTS] Erreur lors de la récupération des biens avec contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des biens avec contacts',
      error: error.message
    });
  }
});

// Route pour récupérer les biens par contact client
app.get('/api/biens/contact/:contactClient', async (req, res) => {
  try {
    const { contactClient } = req.params;
    
    if (!contactClient) {
      return res.status(400).json({
        success: false,
        message: 'Le paramètre contactClient est requis'
      });
    }
    
    const biens = await getBiensByContactClient(contactClient);
    console.log(`[BIENS CONTACT] ${biens.length} biens trouvés pour le contact: ${contactClient}, réponse : 200 OK`);
    
    res.json({
      success: true,
      contactClient: contactClient,
      count: biens.length,
      data: biens
    });
  } catch (error) {
    console.log('[BIENS CONTACT] Erreur lors de la récupération des biens par contact:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des biens par contact',
      error: error.message
    });
  }
});

// Route pour déconnexion : supprime le cookie JWT
app.post('/api/google/logout', (req, res) => {
  res.clearCookie('token');
  oauth2Tokens = null; // Optionnel : réinitialiser le token en mémoire
  console.log('[LOGOUT] Déconnexion, cookie supprimé, réponse : 200 OK');
  res.json({ success: true, message: 'Déconnecté' });
});

// Route pour forcer la reconnexion (utile en cas de tokens expirés)
app.post('/api/google/force-reconnect', (req, res) => {
  res.clearCookie('token');
  oauth2Tokens = null;
  console.log('[FORCE RECONNECT] Tokens nettoyés, redirection vers Google OAuth');
  res.json({ 
    success: true, 
    message: 'Redirection vers Google OAuth',
    redirectUrl: '/auth/google'
  });
});

// Route pour vérifier l'état de connexion
app.get('/api/google/status', (req, res) => {
  const token = req.cookies.token;
  console.log('[STATUS] Cookie reçu :', token);
  console.log('[STATUS] Tous les cookies reçus :', req.cookies);
  console.log('[STATUS] Headers reçus :', {
    origin: req.headers.origin,
    referer: req.headers.referer,
    'user-agent': req.headers['user-agent']
  });
  
  if (!token) {
    console.log('[STATUS] Pas de token, utilisateur non connecté, réponse : 200 OK');
    return res.json({ connected: false });
  }
  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    console.log('[STATUS] JWT décodé :', decoded);
    const response = { connected: true, user: { userId: decoded.userId, email: decoded.email } };
    console.log('[STATUS] Réponse envoyée :', response, '200 OK');
    res.json(response);
  } catch (err) {
    console.log('[STATUS] Erreur de décodage JWT :', err.message, 'Réponse : 200 OK');
    res.json({ connected: false });
  }
});

// Route pour tester la configuration des cookies
app.get('/api/test-cookies', (req, res) => {
  // Définir un cookie de test
  res.cookie('test-cookie', 'test-value', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 60 * 1000, // 1 minute
    path: '/'
  });
  
  res.json({
    success: true,
    message: 'Cookie de test défini',
    cookies: req.cookies,
    headers: {
      origin: req.headers.origin,
      referer: req.headers.referer
    },
    env: process.env.NODE_ENV
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
}); 