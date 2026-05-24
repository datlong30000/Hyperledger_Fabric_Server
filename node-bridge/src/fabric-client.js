'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const grpc = require('@grpc/grpc-js');
const { connect, signers } = require('@hyperledger/fabric-gateway');

const config = {
    mspId: process.env.FABRIC_MSP_ID || 'Org1MSP',
    cryptoRoot: process.env.FABRIC_CRYPTO_ROOT ||
        path.resolve(__dirname, '../../fabric-samples/test-network/organizations/peerOrganizations/org1.example.com'),
    peerEndpoint: process.env.FABRIC_PEER_ENDPOINT || 'localhost:7051',
    peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS || 'peer0.org1.example.com',
    channel: process.env.FABRIC_CHANNEL || 'mychannel',
    chaincode: process.env.FABRIC_CHAINCODE || 'harvest-cc',
    contract: process.env.FABRIC_CONTRACT || 'HarvestContract',
};

function loadFirstFile(dir) {
    const files = fs.readdirSync(dir);
    if (files.length === 0) throw new Error(`empty dir: ${dir}`);
    return fs.readFileSync(path.join(dir, files[0]));
}

async function newGrpcClient() {
    const tlsCertPath = path.join(config.cryptoRoot, 'peers/peer0.org1.example.com/tls/ca.crt');
    const tlsCert = fs.readFileSync(tlsCertPath);
    const credentials = grpc.credentials.createSsl(tlsCert);
    return new grpc.Client(config.peerEndpoint, credentials, {
        'grpc.ssl_target_name_override': config.peerHostAlias,
    });
}

function newIdentity() {
    const certPath = path.join(config.cryptoRoot, 'users/Admin@org1.example.com/msp/signcerts');
    const credentials = loadFirstFile(certPath);
    return { mspId: config.mspId, credentials };
}

function newSigner() {
    const keyPath = path.join(config.cryptoRoot, 'users/Admin@org1.example.com/msp/keystore');
    const privateKeyPem = loadFirstFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

let gatewayInstance = null;
let grpcClientInstance = null;
let contractInstance = null;

async function getContract() {
    if (contractInstance) return contractInstance;

    grpcClientInstance = await newGrpcClient();
    gatewayInstance = connect({
        client: grpcClientInstance,
        identity: newIdentity(),
        signer: newSigner(),
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        endorseOptions: () => ({ deadline: Date.now() + 15000 }),
        submitOptions: () => ({ deadline: Date.now() + 5000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });

    const network = gatewayInstance.getNetwork(config.channel);
    contractInstance = network.getContract(config.chaincode, config.contract);
    return contractInstance;
}

async function submitCreateHarvest(record) {
    const contract = await getContract();
    const args = [
        record.ID,
        record.Timestamp,
        String(record.Latitude),
        String(record.Longitude),
        record.FruitType,
        String(record.Confidence),
        record.ImageHash,
    ];
    const result = await contract.submitTransaction('CreateHarvestRecord', ...args);
    return JSON.parse(Buffer.from(result).toString('utf8'));
}

async function evaluateGetAll() {
    const contract = await getContract();
    const result = await contract.evaluateTransaction('GetAllRecords');
    return JSON.parse(Buffer.from(result).toString('utf8'));
}

function close() {
    if (gatewayInstance) gatewayInstance.close();
    if (grpcClientInstance) grpcClientInstance.close();
    contractInstance = null;
    gatewayInstance = null;
    grpcClientInstance = null;
}

module.exports = { config, getContract, submitCreateHarvest, evaluateGetAll, close };
