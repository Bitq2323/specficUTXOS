const bitcoin = require('bitcoinjs-lib');
const { broadcastTransaction, parseUtxos, fetchTransactionHex } = require('./helper');


function detectAddressType(address) {
    if (address.startsWith('bc1')) {
        return 'p2wpkh';
    } else if (address.startsWith('3')) {
        return 'p2sh-p2wpkh';
    } else if (address.startsWith('1')) {
        return 'p2pkh';
    } else {
        throw new Error('Unsupported address type');
    }
}

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
        for (const utxo of utxos) {
            const txHex = await fetchTransactionHex(utxo.txid);
            const input = {
                hash: utxo.txid,
                index: utxo.vout,
                sequence: req.body.isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            };

            // Handle different address types
            const addressType = detectAddressType(utxo.address);
            if (addressType === 'p2sh-p2wpkh') {
                const { redeemOutput } = bitcoin.payments.p2sh({
                    redeem: bitcoin.payments.p2wpkh({ pubkey: bitcoin.ECPair.fromWIF(utxo.wif, network).publicKey, network }),
                    network,
                });
                input.redeemScript = redeemOutput;
            } else if (addressType !== 'p2wpkh' && addressType !== 'p2pkh') {
                throw new Error(`Unsupported address type: ${addressType}`);
            }

            psbt.addInput(input);
            totalInputValue += utxo.value;
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
