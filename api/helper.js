const axios = require('axios');

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
    // parseUtxoString, // Commented out since it's not used anymore
    fetchTransactionHex,
};
