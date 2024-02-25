const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const { fetchTransactionHex } = require('./helper');

async function broadcastTransaction(transactionHex) {
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
    // Split the UTXO string by the pipe character to get each UTXO entry
    return utxoString.split('|').map(utxo => {
        // Each UTXO's details are separated by commas, so we further split those
        const parts = utxo.split(',');
        // Create a map to easily access the values by key
        const utxoMap = parts.reduce((map, part) => {
            const [key, value] = part.split(':');
            map[key] = value;
            return map;
        }, {});
        // Return the structured UTXO object
        return {
            txid: utxoMap.txhash,
            vout: parseInt(utxoMap.vout, 10),
            value: parseInt(utxoMap.value, 10),
            wif: utxoMap.wif,
        };
    });
}

module.exports = async (req, res) => {
    try {
        const expectedParams = ['sendFromAddress', 'sendToAddress', 'sendToAmount', 'isRBFEnabled', 'networkFee', 'utxoString', 'isBroadcast'];
        const missingParams = expectedParams.filter(param => req.body[param] === undefined);

        if (missingParams.length > 0) {
            return res.status(400).json({ success: false, error: `Missing parameters: ${missingParams.join(', ')}` });
        }

        const { sendFromAddress, sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString, isBroadcast } = req.body;
        const network = bitcoin.networks.bitcoin;

        if (!isValidAddress(sendFromAddress, network) || !isValidAddress(sendToAddress, network)) {
            return res.status(400).json({ success: false, error: 'Invalid Bitcoin address' });
        }

        if (typeof sendToAmount !== 'number' || sendToAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid sendToAmount: Must be a positive number' });
        }

        if (typeof networkFee !== 'number' || networkFee < 0) {
            return res.status(400).json({ success: false, error: 'Invalid networkFee: Must be a non-negative number' });
        }

        const psbt = new bitcoin.Psbt({ network });
        let totalInputValue = 0;
        const utxos = parseUtxos(utxoString);

        for (const { txid, vout, value, wif } of utxos) {
            const txHex = await fetchTransactionHex(txid);
            psbt.addInput({
                hash: txid,
                index: vout,
                sequence: isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            });
            totalInputValue += value;

            const keyPair = bitcoin.ECPair.fromWIF(wif, network);
            psbt.signInput(psbt.inputCount - 1, keyPair); // Sign the input immediately after adding it
        }

        let sendToValue = sendToAmount;
        const feeValue = networkFee;
        if (totalInputValue < sendToValue + feeValue) {
            sendToValue = Math.max(totalInputValue - feeValue, 0);
            if (sendToValue < 546) { // Bitcoin dust limit
                throw new Error('Insufficient funds for fee or resulting output is dust');
            }
        }

        let changeValue = totalInputValue - sendToValue - feeValue;
        if (changeValue > 0 && changeValue < 546) { // Adjust for dust limit
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

        // No need for another signing loop, each input is already signed with its corresponding keyPair
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
