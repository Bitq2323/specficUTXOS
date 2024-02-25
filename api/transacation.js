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
        
        let sendToValue = sendToAmount;
        const feeValue = networkFee;
        let changeValue = totalInputValue - sendToValue - feeValue;
        
        // Add output to recipient
        psbt.addOutput({
            address: sendToAddress,
            value: sendToValue,
        });
        
        // Add change output if needed
        if (changeValue > 0) {
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
