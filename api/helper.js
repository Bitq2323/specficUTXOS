const axios = require('axios');

// Custom function to parse the UTXO string format
function parseUtxoString(utxoString) {
    const utxoParts = utxoString.split('], [').map(part => 
        `[${part.replace(/^\[/, '').replace(/\]$/, '')}]`
    );

    const utxos = utxoParts.map(part => {
        const keyValuePairs = part.substring(1, part.length - 1).split(', ').map(kv => {
            const [key, value] = kv.split(': ');
            return { key: key.trim(), value: value.replace(/"/g, '').trim() };
        });

        const utxoObj = keyValuePairs.reduce((obj, { key, value }) => {
            obj[key] = value;
            return obj;
        }, {});

        return {
            txid: utxoObj.txid,
            vout: parseInt(utxoObj.vout, 10),
            value: utxoObj.value
        };
    });

    return utxos;
}

// Function to fetch transaction hex
async function fetchTransactionHex(txid) {
    try {
        const url = `https://blockstream.info/api/tx/${txid}/hex`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('Error fetching transaction hex:', error);
        throw error; // Re-throw the error for handling by the caller
    }
}

module.exports = {
    parseUtxoString,
    fetchTransactionHex,
};
