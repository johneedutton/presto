const { google } = require('googleapis');
const { DateTime } = require('luxon');
const axios = require('axios');
const cheerio = require('cheerio'); // For parsing HTML
require('dotenv').config(); // Load environment variables

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const NEWSLETTER_DOMAINS = [
    'substack.com',
    'medium.com',
    'mailchimp.com',
    'campaign-archive.com',
];
const SUBJECT_KEYWORDS = ['Newsletter', 'Update', 'Digest', 'Weekly', 'News'];
const EXCLUDED_DOMAINS = ['google.com', 'cointracker.io'];

async function authenticate() {
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

    if (process.env.GOOGLE_TOKEN) {
        console.log('Using GOOGLE_TOKEN from environment variables.');
        const token = JSON.parse(process.env.GOOGLE_TOKEN);
        oAuth2Client.setCredentials(token);
    } else {
        console.log('GOOGLE_TOKEN not found. Falling back to local token.json...');
        try {
            const token = JSON.parse(fs.readFileSync('token.json', 'utf8'));
            oAuth2Client.setCredentials(token);
            console.log('Successfully loaded token.json locally.');
        } catch (err) {
            console.error('No token found. Manual authentication required.');
            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
            });
            console.log('Authorize this app by visiting this URL:', authUrl);
            throw new Error('Authorization required.');
        }
    }

    return oAuth2Client;
}

async function listMessages() {
    const oAuth2Client = await authenticate();

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const now = DateTime.now();
    const past24Hours = now.minus({ hours: 24 }).toMillis();

    console.log('Fetching emails from the past 24 hours...');
    const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 100,
        q: `after:${Math.floor(past24Hours / 1000)}`,
    });

    const { messages = [] } = response.data;
    if (!messages.length) {
        console.log('No emails found in the past 24 hours.');
        return {};
    }

    const emailsByDay = {};
    for (const message of messages) {
        const emailDetails = await getMessageDetails(oAuth2Client, message.id);
        if (emailDetails) {
            const dayKey = DateTime.fromJSDate(emailDetails.dateSent).toFormat('yyyy-MM-dd');
            if (!emailsByDay[dayKey]) emailsByDay[dayKey] = [];
            emailsByDay[dayKey].push(emailDetails);
        }
    }

    return emailsByDay;
}

async function getMessageDetails(auth, messageId) {
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.messages.get({ userId: 'me', id: messageId });
        const payload = res.data.payload;
        const headers = payload.headers;

        const subject = headers.find((header) => header.name === 'Subject')?.value || '(No Subject)';
        const from = headers.find((header) => header.name === 'From')?.value || '(Unknown Sender)';
        const dateSent = new Date(headers.find((header) => header.name === 'Date')?.value);

        const bodyData = payload.parts?.find((part) => part.mimeType === 'text/plain' || part.mimeType === 'text/html')?.body?.data;
        const decodedBody = bodyData ? Buffer.from(bodyData, 'base64').toString('utf-8') : '';

        const isNewsletter =
            NEWSLETTER_DOMAINS.some((domain) => from.includes(domain)) ||
            SUBJECT_KEYWORDS.some((keyword) => subject.toLowerCase().includes(keyword.toLowerCase()));

        const isExcluded = EXCLUDED_DOMAINS.some((domain) => from.includes(domain));

        if (isNewsletter && !isExcluded) {
            const summary = await generateSummary(decodedBody);
            const links = await extractLinks(decodedBody);

            return { from, subject, dateSent, summary, links };
        }

        return null;
    } catch (error) {
        console.error(`Error fetching message ID ${messageId}:`, error.message);
        return null;
    }
}

async function generateSummary(content) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    const prompt = `
Summarize the following email content with variation, avoiding repetitive language such as "The email discusses" or "The email provides." 
If the content contains multiple ideas or topics, break them into bullet points for clarity and engagement. 
Ensure the summary is concise and highlights key takeaways in an appealing way.

Email content:
${content}
`;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
            },
            {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        let summary = response.data.choices[0].message.content.trim();
        summary = summary.replace(/^- /gm, '• '); // Convert dashes to bullet points
        return summary;
    } catch (error) {
        console.error('Error generating summary:', error.message);
        return '(Unable to summarize)';
    }
}

async function resolveRedirect(url) {
    try {
        const response = await axios.head(url, { maxRedirects: 5 });
        return response.headers.location || url; // Return resolved URL or original
    } catch (error) {
        console.error(`Error resolving redirect for ${url}:`, error.message);
        return url; // Fallback to original URL
    }
}

async function fetchPageTitle(url) {
    try {
        const resolvedUrl = await resolveRedirect(url); // Resolve redirects
        const response = await axios.get(resolvedUrl, { timeout: 5000 }); // Fetch the page
        const $ = cheerio.load(response.data); // Load HTML into Cheerio
        const title = $('title').text().trim(); // Extract the title text
        return title && title.length > 5 ? title : inferLinkText(resolvedUrl); // Use fallback if title is too short
    } catch (error) {
        console.error(`Error fetching title for ${url}:`, error.message);
        return inferLinkText(url); // Fallback for errors
    }
}

function inferLinkText(url) {
    try {
        const parsedUrl = new URL(url);
        const domain = parsedUrl.hostname.replace('www.', '');
        const pathname = parsedUrl.pathname.split('/').filter(Boolean);
        return pathname.length > 0 ? `${domain}/${pathname[0]}` : domain;
    } catch (error) {
        return 'View Link'; // Generic fallback
    }
}

async function extractLinks(content) {
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    const matches = content.match(linkRegex) || [];

    const links = [...new Set(matches)].slice(0, 10);

    const linkObjects = await Promise.all(
        links.map(async (url) => {
            const text = await fetchPageTitle(url);
            return { text, url };
        })
    );

    return linkObjects;
}

module.exports = { listMessages };
