const axios = require('axios');

async function fetchTransactionHex(txid) {
    if (!txid) {
        throw new Error('txid is undefined or invalid');
    }
    const url = `https://blockstream.info/api/tx/${txid}/hex`;
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('Failed to fetch transaction hex for txid:', txid, '; Error:', error);
        throw new Error(`Failed to fetch transaction hex for txid: ${txid}`);
    }
}async function broadcastTransaction(transactionHex) {
    const url = 'https://mempool.space/api/tx';
    try {
        const response = await axios.post(url, transactionHex, { headers: { 'Content-Type': 'text/plain' } });
        return response.data;
    } catch (error) {
        throw new Error('Failed to broadcast transaction');
    }
}

function isValidAddress(address, network) {
    try {
        bitcoin.address.toOutputScript(address, network);
        return true;
    } catch (e) {
        return false;
    }
}

function parseUtxos(utxoString) {
    return utxoString.split('|').map(utxo => {
        const parts = utxo.split(',');
        const utxoMap = parts.reduce((map, part) => {
            const [key, value] = part.split(':');
            map[key] = value;
            return map;
        }, {});
        return {
            txid: utxoMap.txhash,
            vout: parseInt(utxoMap.vout, 10),
            value: parseInt(utxoMap.value, 10),
            wif: utxoMap.wif,
            address: utxoMap.address, // Capture the address from UTXO
        };
    });
}

module.exports = {
    fetchTransactionHex,
    broadcastTransaction,
    isValidAddress,
    parseUtxos,
};