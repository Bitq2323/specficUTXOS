const axios = require('axios');

// Existing fetchTransactionHex function
async function fetchTransactionHex(txid) {
    // Implementation remains the same...
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

// Exporting both functions
module.exports = {
    fetchTransactionHex,
    parseCustomUtxoString,
};
