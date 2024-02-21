const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const { fetchTransactionHex, parseCustomUtxoString, broadcastTransaction, isValidAddress } = require('./helper');


module.exports = async (req, res) => {
    console.log('Request body:', req.body);
    
    const expectedParams = ['sendFromWIF', 'sendFromAddress', 'sendToAddress', 'sendToAmount', 'isRBFEnabled', 'networkFee', 'utxoString', 'isBroadcast'];
    const missingParams = expectedParams.filter(param => req.body[param] === undefined || req.body[param] === '');

    if (missingParams.length > 0) {
        return res.status(400).json({ success: false, error: `Missing parameters: ${missingParams.join(', ')}` });
    }

    const { sendFromWIF, sendFromAddress, sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString, isBroadcast } = req.body;
    const network = bitcoin.networks.bitcoin;

    let parsedUtxos;
    try {
        parsedUtxos = parseCustomUtxoString(utxoString);
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }

    const keyPair = bitcoin.ECPair.fromWIF(sendFromWIF, network);
    const psbt = new bitcoin.Psbt({ network });

    let totalInputValue = 0;
    for (const utxo of parsedUtxos) {
        const txHex = await fetchTransactionHex(utxo.txid);
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            sequence: isRBFEnabled ? 0xfffffffe : undefined,
            nonWitnessUtxo: Buffer.from(txHex, 'hex'),
        });
        totalInputValue += parseInt(utxo.value, 10);
    }

    let sendToValue = parseInt(sendToAmount);
    const feeValue = parseInt(networkFee);
    if (totalInputValue < sendToValue + feeValue) {
        sendToValue = Math.max(totalInputValue - feeValue, 0);
        if (sendToValue < 546) {
            throw new Error('Insufficient funds for fee or resulting output is dust');
        }
    }

    let changeValue = totalInputValue - sendToValue - feeValue;
    if (changeValue > 0 && changeValue < 546) {
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
};
