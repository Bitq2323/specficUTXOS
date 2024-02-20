const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const { fetchTransactionHex } = require('./helper'); // You still need this for fetching transaction hex

// Helper function to broadcast transaction
async function broadcastTransaction(transactionHex) {
    const url = 'https://mempool.space/api/tx'; // Adjust based on actual API endpoint
    try {
        const response = await axios.post(url, transactionHex, { headers: { 'Content-Type': 'text/plain' } });
        return response.data; // Adjust based on API response structure
    } catch (error) {
        console.error('Error broadcasting transaction:', error);
        throw error;
    }
}
// Serverless function handler
module.exports = async (req, res) => {
    try {
        console.log('Request body:', req.body);

        const network = bitcoin.networks.bitcoin; // or use bitcoin.networks.testnet for testnet
        const { sendFromWIF, sendFromAddress, sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString } = req.body;

        // Directly use utxoString as it's already an array of objects, no need to parse
        const sendFromUTXOs = utxoString;

        const keyPair = bitcoin.ECPair.fromWIF(sendFromWIF, network);
        const psbt = new bitcoin.Psbt({ network });

        let totalInputValue = 0;
        for (const utxo of sendFromUTXOs) {
            const txHex = await fetchTransactionHex(utxo.txid);
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                sequence: isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            });
            totalInputValue += parseInt(utxo.value, 10);
        }

        const sendToValue = parseInt(sendToAmount, 10);
        const feeValue = parseInt(networkFee || 5000, 10);
        let changeValue = totalInputValue - sendToValue - feeValue;

        psbt.addOutput({
            address: sendToAddress,
            value: sendToValue,
        });

        if (changeValue > 0) {
            psbt.addOutput({
                address: sendFromAddress,
                value: changeValue,
            });
        } else {
            throw new Error('Insufficient input value for the transaction outputs and fees');
        }

        sendFromUTXOs.forEach((_, index) => {
            psbt.signInput(index, keyPair);
        });

        // Finalize the transaction
        psbt.finalizeAllInputs();
        const transaction = psbt.extractTransaction();
        const transactionHex = transaction.toHex();

        // New: Calculate transaction size and virtual size
        const transactionSize = transaction.byteLength();
        const transactionVSize = transaction.virtualSize();

        if (isBroadcast) {
            // Broadcast the transaction
            const broadcastResult = await broadcastTransaction(transactionHex);
            res.status(200).json({ success: true, broadcastResult });
        } else {
            // Return transaction details without broadcasting
            res.status(200).json({
                success: true,
                transactionHex,
                transactionSize,
                transactionVSize,
            });
        }
    } catch (error) {
        console.error('Error processing transaction:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
