const bitcoin = require('bitcoinjs-lib');
const { broadcastTransaction, isValidAddress, parseUtxos, fetchTransactionHex } = require('./helper');

module.exports = async (req, res) => {
    try {
        const expectedParams = ['sendToAddress', 'sendToAmount', 'isRBFEnabled', 'networkFee', 'utxoString', 'isBroadcast', 'changeAddress'];
        const missingParams = expectedParams.filter(param => req.body[param] === undefined);

        if (missingParams.length > 0) {
            return res.status(400).json({ success: false, error: `Missing parameters: ${missingParams.join(', ')}` });
        }

        const { sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString, isBroadcast, changeAddress } = req.body;
        const network = bitcoin.networks.bitcoin;

        if (!isValidAddress(sendToAddress, network) || !isValidAddress(changeAddress, network)) {
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
            psbt.signInput(psbt.inputCount - 1, keyPair);
        }

        let sendToValue = sendToAmount;
        const feeValue = networkFee;
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
                address: changeAddress,
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
            // Calculate the size and virtual size of the transaction for informational purposes
            const transactionSize = transaction.byteLength();
            const transactionVSize = transaction.virtualSize();

            // Respond with the transaction details if not broadcasting
            res.status(200).json({
                success: true,
                transactionHex,
                transactionSize,
                transactionVSize,
            });
        }
    } catch (error) {
        // Log and respond with any errors encountered during the process
        console.error('Error processing transaction:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
