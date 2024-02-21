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
}

// New parseCustomUtxoString function
function parseCustomUtxoString(utxoString) {
    const utxos = [];
    const utxoParts = utxoString.split('], [').map(part => part.replace(/\[|\]/g, ''));
    utxoParts.forEach(part => {
        const keyValuePairs = part.split(', ').map(kv => {
            let [key, value] = kv.split(': ');
            key = key.trim();
            value = value.replace(/"/g, '').trim();
            return { key, value };
        });
        const utxo = keyValuePairs.reduce((obj, { key, value }) => {
            obj[key] = value;
            return obj;
        }, {});
        utxos.push({
            txid: utxo.txid,
            vout: parseInt(utxo.vout, 10),
            value: utxo.value
        });
    });
    return utxos;
}
// New: broadcastTransaction function
async function broadcastTransaction(transactionHex) {
    const url = 'https://mempool.space/api/tx';
    try {
        const response = await axios.post(url, transactionHex, { headers: { 'Content-Type': 'text/plain' } });
        return response.data;
    } catch (error) {
        console.error('Error broadcasting transaction:', error);
        throw new Error('Failed to broadcast transaction');
    }
}

// New: isValidAddress function
function isValidAddress(address, network) {
    try {
        bitcoin.address.toOutputScript(address, network);
        return true;
    } catch (error) {
        console.error('Invalid address:', address, '; Error:', error);
        return false;
    }
}

// Exporting both functions
module.exports = {
    fetchTransactionHex,
    parseCustomUtxoString,
    broadcastTransaction,
    isValidAddress,
};
