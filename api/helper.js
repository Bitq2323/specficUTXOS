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

module.exports = {
    // parseUtxoString, // Commented out since it's not used anymore
    fetchTransactionHex,
};
