require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cookieParser());
app.use(cors({
  origin: 'http://localhost:5173', // l'URL exacte de ton front
  credentials: true
}));

// Stockage temporaire du token (à remplacer par une base de données plus tard)
let oauth2Tokens = null;

// Configuration OAuth2
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// 1. Route pour démarrer l'authentification Google
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
  console.log('[AUTH] /auth/google appelé, redirection vers Google OAuth2');
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
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Tokens = tokens;
    oauth2Client.setCredentials(tokens);

    // Récupérer les infos utilisateur (id, email)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();
    const userId = userinfo.data.id;
    const email = userinfo.data.email;

    // Générer un JWT
    const token = jwt.sign({ userId, email }, process.env.SESSION_SECRET, { expiresIn: '7d' });

    // Placer le JWT dans un cookie sécurisé
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
    });

    // Rediriger vers le frontend
    res.redirect('http://localhost:5173/oauth-success');
    console.log('[CALLBACK] Authentification réussie, cookie envoyé, redirection vers le front. Réponse : 302 Redirect');
  } catch (err) {
    console.log('[CALLBACK] Erreur lors de la récupération du token, réponse : 500 Internal Server Error');
    res.status(500).send('Erreur lors de la récupération du token');
  }
});

// 3. Récupération des événements du calendrier
app.get('/api/events', async (req, res) => {
  if (!oauth2Tokens) {
    console.log('[EVENTS] Non authentifié, réponse : 401 Unauthorized');
    return res.status(401).json({ error: 'Non authentifié' });
  }
  oauth2Client.setCredentials(oauth2Tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

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
    console.log('[EVENTS] Événements récupérés, réponse : 200 OK');
    res.json(events.data.items);
  } catch (err) {
    console.log('[EVENTS] Erreur lors de la récupération des événements, réponse : 500 Internal Server Error');
    res.status(500).json({ error: 'Erreur lors de la récupération des événements' });
  }
});

// Route pour déconnexion : supprime le cookie JWT
app.post('/api/google/logout', (req, res) => {
  res.clearCookie('token');
  oauth2Tokens = null; // Optionnel : réinitialiser le token en mémoire
  console.log('[LOGOUT] Déconnexion, cookie supprimé, réponse : 200 OK');
  res.json({ success: true, message: 'Déconnecté' });
});

// Route pour vérifier l’état de connexion
app.get('/api/google/status', (req, res) => {
  const token = req.cookies.token;
  console.log('[STATUS] Cookie reçu :', token);
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
}); 