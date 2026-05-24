'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const fabric = require('./fabric-client');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IMAGE_STORE = process.env.IMAGE_STORE || '/data/images';
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const IMAGE_CT = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

function log(level, trace, msg, extra) {
    const ts = new Date().toISOString();
    const tail = extra ? ` ${JSON.stringify(extra)}` : '';
    const line = `${ts} ${level} [bridge] trace=${trace || '-'} ${msg}${tail}`;
    if (level === 'ERROR') console.error(line);
    else console.log(line);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
    req.traceId = req.header('X-Trace-Id') || crypto.randomUUID();
    next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/images/:hash', (req, res) => {
    const hash = String(req.params.hash || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        return res.status(400).json({ error: 'invalid hash format' });
    }
    for (const ext of IMAGE_EXTS) {
        const file = path.join(IMAGE_STORE, `${hash}.${ext}`);
        if (fs.existsSync(file)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
            res.set('Content-Type', IMAGE_CT[ext] || 'application/octet-stream');
            return res.sendFile(file);
        }
    }
    res.status(404).json({ error: 'image not found', hash });
});

app.post('/tx/harvest', async (req, res) => {
    const body = req.body || {};

    if (body.latitude === undefined || body.longitude === undefined ||
        !body.fruitType || body.confidence === undefined || !body.imageHash) {
        log('WARN', req.traceId, 'rejected: missing fields');
        return res.status(400).json({
            error: 'missing fields: latitude, longitude, fruitType, confidence, imageHash required',
            traceId: req.traceId,
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

    log('INFO', req.traceId, 'submit', { id: record.ID, fruit: record.FruitType });

    try {
        const saved = await fabric.submitCreateHarvest(record);
        log('INFO', req.traceId, 'committed', { id: saved.ID });
        res.status(201).json({ status: 'committed', record: saved, traceId: req.traceId });
    } catch (err) {
        log('ERROR', req.traceId, 'submit failed', { error: err.message });
        res.status(500).json({ error: err.message, details: err.details || null, traceId: req.traceId });
    }
});

app.get('/records', async (req, res) => {
    try {
        const records = await fabric.evaluateGetAll();
        log('INFO', req.traceId, 'query', { count: records.length });
        res.json({ count: records.length, records });
    } catch (err) {
        log('ERROR', req.traceId, 'query failed', { error: err.message });
        res.status(500).json({ error: err.message, traceId: req.traceId });
    }
});

const server = app.listen(PORT, () => {
    log('INFO', '-', `listening on :${PORT}`);
    log('INFO', '-', 'config', {
        peer: fabric.config.peerEndpoint,
        channel: fabric.config.channel,
        chaincode: fabric.config.chaincode,
    });
});

function shutdown(signal) {
    log('INFO', '-', `received ${signal}, shutting down`);
    server.close(() => {
        fabric.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
