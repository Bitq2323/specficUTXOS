const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const { fetchTransactionHex } = require('./helper');

// Helper function to broadcast transaction
async function broadcastTransaction(transactionHex) {
    const url = 'https://mempool.space/api/tx';
    try {
        const response = await axios.post(url, transactionHex, { headers: { 'Content-Type': 'text/plain' } });
        return response.data;
    } catch (error) {
        console.error('Error broadcasting transaction:', error);
        throw error;
    }
}

// Serverless function handler
module.exports = async (req, res) => {
    try {
        console.log('Request body:', req.body);
        const { sendFromWIF, sendFromAddress, sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString, isBroadcast } = req.body;
        const network = bitcoin.networks.bitcoin;
        const keyPair = bitcoin.ECPair.fromWIF(sendFromWIF, network);
        const psbt = new bitcoin.Psbt({ network });

        let totalInputValue = 0;
        for (const utxo of utxoString) { // Use for...of for async/await support
            const txHex = await fetchTransactionHex(utxo.txid);
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                sequence: isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            });
            totalInputValue += parseInt(utxo.value, 10);
        }

        let sendToValue = parseInt(sendToAmount, 10);
        const feeValue = parseInt(networkFee || 5000, 10);
        const totalNeeded = sendToValue + feeValue;
        const dustLimit = 546; // Common dust limit for P2PKH and P2WPKH

        if (totalInputValue < totalNeeded) {
            sendToValue = Math.max(totalInputValue - feeValue, 0);
            if (sendToValue < dustLimit) {
                throw new Error('Remaining balance after fees is less than the dust limit.');
            }
        }

        let changeValue = totalInputValue - sendToValue - feeValue;
        if (changeValue > 0 && changeValue < dustLimit) {
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
        console.error('Error processing transaction:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
