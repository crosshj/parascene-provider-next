import express from 'express';
import handler from './api/index.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(express.json({ limit: '50mb' }));

app.all('/api', async (req, res) => {
    try {
        await handler(req, res);
    } catch (err) {
        console.error('Server Error:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; 

app.listen(PORT, HOST, () => {
    console.log(`Provider server is running at http://${HOST}:${PORT}/api`);
});