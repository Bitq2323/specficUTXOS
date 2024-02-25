const bitcoin = require('bitcoinjs-lib');
const { broadcastTransaction, parseUtxos, fetchTransactionHex } = require('./helper');

module.exports = async (req, res) => {
    console.log('Request Body:', req.body);
    try {
        const expectedParams = ['sendToAddress', 'sendToAmount', 'isRBFEnabled', 'networkFee', 'utxoString', 'isBroadcast', 'changeAddress', 'isSelectedUtxos'];
        const missingParams = expectedParams.filter(param => req.body[param] === undefined);

        if (missingParams.length > 0) {
            return res.status(400).json({ success: false, error: `Missing parameters: ${missingParams.join(', ')}` });
        }

        const { sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString, isBroadcast, changeAddress, isSelectedUtxos } = req.body;
        const network = bitcoin.networks.bitcoin;

        const psbt = new bitcoin.Psbt({ network });
        let totalInputValue = 0;
        const utxos = parseUtxos(utxoString).sort((a, b) => b.value - a.value); // Sort UTXOs by value in descending order if isSelectedUtxos is false
        
        let requiredValue = sendToAmount + networkFee;
        let selectedUtxos = isSelectedUtxos ? utxos : [];

        if (!isSelectedUtxos) {
            // Only select the necessary UTXOs to cover the amount and fee if isSelectedUtxos is false
            for (const utxo of utxos) {
                if (totalInputValue < requiredValue) {
                    selectedUtxos.push(utxo);
                    totalInputValue += utxo.value;
                } else {
                    break; // Stop selecting UTXOs once we have enough value
                }
            }
        } else {
            // Use all provided UTXOs if isSelectedUtxos is true
            selectedUtxos.forEach(utxo => totalInputValue += utxo.value);
        }

        // Add inputs for selected UTXOs
        for (const { txid, vout, value } of selectedUtxos) {
            const txHex = await fetchTransactionHex(txid);
            psbt.addInput({
                hash: txid,
                index: vout,
                sequence: isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            });
        }
        
        let sendToValue = Math.min(sendToAmount, totalInputValue - networkFee); // Adjust if totalInputValue is not enough
        let changeValue = totalInputValue - sendToValue - networkFee;

        // Ensure sendToValue is not negative
        if (sendToValue < 0) {
            throw new Error('Insufficient funds to cover the sending amount and fee');
        }

        // Add output to recipient
        psbt.addOutput({ address: sendToAddress, value: sendToValue });

        const dustLimit = 546; // Define a typical dust limit
        if (changeValue > dustLimit) {
            // Add change output if above dust limit
            psbt.addOutput({ address: changeAddress, value: changeValue });
        }

        // Sign selected inputs
        selectedUtxos.forEach((utxo, index) => {
            const keyPair = bitcoin.ECPair.fromWIF(utxo.wif, network);
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
            res.status(200).json({ success: true, transactionHex, transactionSize, transactionVSize });
        }
    } catch (error) {
        console.error('Error processing transaction:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
