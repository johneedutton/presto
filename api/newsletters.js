const { listMessages } = require('../auth'); // Import the listMessages function from auth.js

module.exports = async (req, res) => {
    try {
        // Call the listMessages function to fetch newsletter data
        const newsletters = await listMessages();

        // Send the data as a JSON response
        res.status(200).json(newsletters);
    } catch (error) {
        // Log and return an error message if something goes wrong
        console.error('Error fetching newsletters:', error.message);
        res.status(500).json({ error: 'Failed to fetch newsletters' });
    }
};
