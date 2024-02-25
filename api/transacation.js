const bitcoin = require('bitcoinjs-lib');
const { broadcastTransaction, parseUtxos, fetchTransactionHex } = require('./helper');

module.exports = async (req, res) => {
    try {
        const expectedParams = ['sendToAddress', 'sendToAmount', 'isRBFEnabled', 'networkFee', 'utxoString', 'isBroadcast', 'changeAddress'];
        const missingParams = expectedParams.filter(param => req.body[param] === undefined);

        if (missingParams.length > 0) {
            return res.status(400).json({ success: false, error: `Missing parameters: ${missingParams.join(', ')}` });
        }

        const { sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString, isBroadcast, changeAddress } = req.body;
        const network = bitcoin.networks.bitcoin;

        const psbt = new bitcoin.Psbt({ network });
        let totalInputValue = 0;
        const utxos = parseUtxos(utxoString);
        
        // Add inputs
        for (const { txid, vout, value } of utxos) {
            const txHex = await fetchTransactionHex(txid);
            psbt.addInput({
                hash: txid,
                index: vout,
                sequence: isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            });
            totalInputValue += value;
        }
        
        let sendToValue;
        const feeValue = networkFee;
        let changeValue;

        // Dynamically calculate sendToValue and changeValue based on total input and fee
        if (totalInputValue <= sendToAmount + feeValue) {
            // If sending the whole balance or if the balance is not enough to cover the fee, adjust sendToValue
            sendToValue = totalInputValue - feeValue;
            changeValue = 0; // No change since the entire balance is used
        } else {
            // Otherwise, proceed as planned
            sendToValue = sendToAmount;
            changeValue = totalInputValue - sendToValue - feeValue;
        }

        // Ensure sendToValue is not negative
        if (sendToValue < 0) {
            throw new Error('Insufficient funds to cover the sending amount and fee');
        }

        // Add output to recipient
        psbt.addOutput({
            address: sendToAddress,
            value: sendToValue,
        });

        // Add change output if needed and if it's above dust limit
        const dustLimit = 546; // Define a typical dust limit
        if (changeValue > dustLimit) {
            psbt.addOutput({
                address: changeAddress,
                value: changeValue,
            });
        }

        // Now, sign all inputs
        for (let index = 0; index < utxos.length; index++) {
            const { wif } = utxos[index];
            const keyPair = bitcoin.ECPair.fromWIF(wif, network);
            psbt.signInput(index, keyPair);
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
    } catch (error) {
        console.error('Error processing transaction:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
