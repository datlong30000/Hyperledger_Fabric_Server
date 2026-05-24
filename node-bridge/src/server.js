'use strict';

const crypto = require('crypto');
const express = require('express');
const fabric = require('./fabric-client');

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/tx/harvest', async (req, res) => {
    const body = req.body || {};

    if (body.latitude === undefined || body.longitude === undefined ||
        !body.fruitType || body.confidence === undefined || !body.imageHash) {
        return res.status(400).json({
            error: 'missing fields: latitude, longitude, fruitType, confidence, imageHash required',
        });
    }

    const record = {
        ID: body.id || `harvest-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        Timestamp: body.timestamp || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        Latitude: Number(body.latitude),
        Longitude: Number(body.longitude),
        FruitType: String(body.fruitType),
        Confidence: Number(body.confidence),
        ImageHash: String(body.imageHash),
    };

    try {
        const saved = await fabric.submitCreateHarvest(record);
        res.status(201).json({ status: 'committed', record: saved });
    } catch (err) {
        console.error('[bridge] submit error:', err.message);
        res.status(500).json({ error: err.message, details: err.details || null });
    }
});

app.get('/records', async (_req, res) => {
    try {
        const records = await fabric.evaluateGetAll();
        res.json({ count: records.length, records });
    } catch (err) {
        console.error('[bridge] query error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const server = app.listen(PORT, () => {
    console.log(`[bridge] listening on :${PORT}`);
    console.log(`[bridge] peer=${fabric.config.peerEndpoint} channel=${fabric.config.channel} cc=${fabric.config.chaincode}`);
});

function shutdown(signal) {
    console.log(`[bridge] received ${signal}, shutting down`);
    server.close(() => {
        fabric.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
