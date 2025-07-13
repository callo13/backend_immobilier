require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());

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
  res.redirect(url);
});

// 2. Callback Google OAuth2
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Code manquant');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Tokens = tokens;
    oauth2Client.setCredentials(tokens);
    res.send('Authentification réussie ! Vous pouvez fermer cette fenêtre.');
  } catch (err) {
    res.status(500).send('Erreur lors de la récupération du token');
  }
});

// 3. Récupération des événements du calendrier
app.get('/api/events', async (req, res) => {
  if (!oauth2Tokens) {
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
    res.json(events.data.items);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération des événements' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
}); 