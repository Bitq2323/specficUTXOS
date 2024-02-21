const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const { fetchTransactionHex } = require('./helper');

// Helper function to broadcast transaction
async function broadcastTransaction(transactionHex) {
    const url = 'https://mempool.space/api/tx';
    try {
        const response = await axios.post(url, transactionHex, { headers: { 'Content-Type': 'text/plain' } });
        return response.data; // Assume this returns a meaningful success response
    } catch (error) {
        console.error('Error broadcasting transaction:', error);
        throw new Error('Failed to broadcast transaction');
    }
}

// Function to validate Bitcoin addresses
function isValidAddress(address, network) {
    try {
        bitcoin.address.toOutputScript(address, network);
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = async (req, res) => {
    try {
        console.log('Request body:', req.body);
        const { sendFromWIF, sendFromAddress, sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString, isBroadcast } = req.body;

        // Validate required fields
        if (!sendFromWIF || !sendFromAddress || !sendToAddress || typeof sendToAmount !== 'number' || !utxoString) {
            return res.status(400).json({ success: false, error: 'Missing or invalid fields' });
        }

        // Validate Bitcoin address formats
        const network = bitcoin.networks.bitcoin; // Adjust as necessary for testnet or other networks
        if (!isValidAddress(sendFromAddress, network) || !isValidAddress(sendToAddress, network)) {
            return res.status(400).json({ success: false, error: 'Invalid Bitcoin address' });
        }

        const keyPair = bitcoin.ECPair.fromWIF(sendFromWIF, network);
        const psbt = new bitcoin.Psbt({ network });

        let totalInputValue = 0;
        for (const utxo of utxoString) {
            const txHex = await fetchTransactionHex(utxo.txid);
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                sequence: isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            });
            totalInputValue += parseInt(utxo.value, 10);
        }

        let sendToValue = sendToAmount;
        const feeValue = parseInt(networkFee || 5000, 10);
        if (totalInputValue < sendToValue + feeValue) {
            // Adjust sendToValue to exclude fee if total is insufficient
            sendToValue = Math.max(totalInputValue - feeValue, 0);
            if (sendToValue < 546) { // Dust threshold
                throw new Error('Insufficient funds for fee or resulting output is dust');
            }
        }

        let changeValue = totalInputValue - sendToValue - feeValue;
        if (changeValue > 0 && changeValue < 546) {
            // Add change to sendToValue if it would be dust
            sendToValue += changeValue;
            changeValue = 0;
        }

        psbt.addOutput({
            address: sendToAddress,
            value: sendToValue,
        });

        if (changeValue > 0) {
            psbt.addOutput({
                address: sendFromAddress,
                value: changeValue,
            });
        }

        utxoString.forEach((_, index) => {
            psbt.signInput(index, keyPair);
        });

        psbt.finalizeAllInputs();
        const transaction = psbt.extractTransaction();
        const transactionHex = transaction.toHex();

        if (isBroadcast) {
            const broadcastResult = await broadcastTransaction(transactionHex);
            res.status(200).json({ success: true, broadcastResult });
        } else {
            const transactionSize = transaction.byteLength();
            const transactionVSize = transaction.virtualSize();
            res.status(200).json({
                success: true,
                transactionHex,
                transactionSize,
                transactionVSize,
            });
        }
    } catch (error) {
        console.error('Error processing transaction:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
