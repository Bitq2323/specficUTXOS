const bitcoin = require('bitcoinjs-lib');
const { parseUtxoString, fetchTransactionHex } = require('./helper'); // Adjust the path as necessary

// Serverless function handler
module.exports = async (req, res) => {
    try {
        console.log('Request body:', req.body);

        const network = bitcoin.networks.bitcoin; // or use bitcoin.networks.testnet for testnet
        const { sendFromWIF, sendFromAddress, sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString } = req.body;

        if (!sendFromWIF || !sendFromAddress || !sendToAddress || !sendToAmount || !utxoString) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const sendFromUTXOs = parseUtxoString(utxoString);
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

        psbt.finalizeAllInputs();
        const transaction = psbt.extractTransaction();

        console.log(`Transaction HEX: ${transaction.toHex()}`);
        res.status(200).json({ success: true, transactionHex: transaction.toHex() });
    } catch (error) {
        console.error('Error processing transaction:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
