const express = require('express');
const path = require('path');
const { listMessages } = require('./auth'); // Import your function
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
const TOKEN_PATH = 'token.json';

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to fetch newsletters
app.get('/api/newsletters', async (req, res) => {
    try {
        const newsletters = await listMessages();
        res.json(newsletters);
    } catch (error) {
        console.error('Error fetching newsletters:', error.message);
        res.status(500).json({ error: 'Failed to fetch newsletters' });
    }
});

// Route to handle Google OAuth callback
app.get('/oauth2callback', (req, res) => {
    const credentials = {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uris: [process.env.GOOGLE_REDIRECT_URI],
    };
    const oAuth2Client = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        credentials.redirect_uris[0]
    );

    const code = req.query.code; // Authorization code from Google
    if (!code) {
        console.error('No authorization code found in query parameters.');
        return res.status(400).send('Authentication failed. No code provided.');
    }

    console.log('Authorization code received:', code);

    oAuth2Client.getToken(code, (err, token) => {
        if (err) {
            console.error('Error retrieving access token:', err.message);
            return res.status(500).send('Authentication failed while retrieving access token.');
        }

        console.log('Access token retrieved successfully.');
        // Save the token to token.json
        try {
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
            console.log('Token stored to', TOKEN_PATH);
        } catch (fileErr) {
            console.error('Error saving token to file:', fileErr.message);
            return res.status(500).send('Authentication succeeded, but saving the token failed.');
        }

        res.send('Authentication successful! You can now close this tab.');
    });
});

// Check for token.json and generate OAuth URL if necessary
(async () => {
    try {
        const credentials = {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uris: [process.env.GOOGLE_REDIRECT_URI],
        };

        const oAuth2Client = new google.auth.OAuth2(
            credentials.client_id,
            credentials.client_secret,
            credentials.redirect_uris[0]
        );

        // If token.json does not exist, generate an OAuth URL
        if (!fs.existsSync(TOKEN_PATH)) {
            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: ['https://www.googleapis.com/auth/gmail.readonly'],
            });
            console.log('Authorize this app by visiting this URL:', authUrl);
        } else {
            console.log('Token already exists. Skipping OAuth URL generation.');
        }
    } catch (error) {
        console.error('Error during startup check for token.json:', error.message);
    }
})();

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
