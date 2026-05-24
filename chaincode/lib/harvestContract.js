'use strict';

const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');

class HarvestContract extends Contract {

    async CreateHarvestRecord(ctx, id, timestamp, latitude, longitude, fruitType, confidence, imageHash) {
        const existing = await ctx.stub.getState(id);
        if (existing && existing.length > 0) {
            throw new Error(`Harvest record ${id} already exists`);
        }

        const record = {
            docType: 'harvest',
            ID: id,
            Timestamp: timestamp,
            Latitude: Number(latitude),
            Longitude: Number(longitude),
            FruitType: fruitType,
            Confidence: Number(confidence),
            ImageHash: imageHash,
        };

        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(record))));
        return JSON.stringify(record);
    }

    async ReadHarvestRecord(ctx, id) {
        const data = await ctx.stub.getState(id);
        if (!data || data.length === 0) {
            throw new Error(`Harvest record ${id} not found`);
        }
        return data.toString();
    }

    async GetAllRecords(ctx) {
        const results = [];
        const iterator = await ctx.stub.getStateByRange('', '');
        for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
            const value = res.value.value.toString('utf8');
            try {
                results.push(JSON.parse(value));
            } catch (err) {
                results.push(value);
            }
        }
        await iterator.close();
        return JSON.stringify(results);
    }
}

module.exports = HarvestContract;
