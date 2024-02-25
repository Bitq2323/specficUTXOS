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
        let utxos = parseUtxos(utxoString);
        let selectedUtxos = []; // Ensure selectedUtxos is defined in the correct scope

        if (!isSelectedUtxos) {
            // Select only the necessary UTXOs to cover the amount and fee
            let tempTotalInputValue = 0;
            let requiredValue = sendToAmount + networkFee;
            for (const utxo of utxos.sort((a, b) => b.value - a.value)) { // Sort UTXOs by value in descending order
                if (tempTotalInputValue < requiredValue) {
                    selectedUtxos.push(utxo);
                    tempTotalInputValue += utxo.value;
                } else {
                    break; // Stop selecting UTXOs once we have enough value
                }
            }
            totalInputValue = tempTotalInputValue;
        } else {
            // Use all provided UTXOs
            selectedUtxos = utxos;
            selectedUtxos.forEach(utxo => totalInputValue += utxo.value);
        }

        // Add inputs for selected UTXOs
        for (const utxo of selectedUtxos) {
            const txHex = await fetchTransactionHex(utxo.txid);
            const ecpair = bitcoin.ECPair.fromWIF(utxo.wif, network);
            let input = {
                hash: utxo.txid,
                index: utxo.vout,
                sequence: isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            };

            // Special handling for P2SH-P2WPKH (BIP49) addresses
            if (utxo.address.startsWith('3')) {
                const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: ecpair.publicKey, network });
                const p2sh = bitcoin.payments.p2sh({
                    redeem: p2wpkh,
                    network,
                });
                input.witnessUtxo = {
                    script: p2sh.output,
                    value: utxo.value,
                };
                input.redeemScript = p2sh.redeem.output;
            }

            psbt.addInput(input);
        }

        let sendToValue = Math.min(sendToAmount, totalInputValue - networkFee); // Adjust if totalInputValue is not enough
        let changeValue = totalInputValue - sendToValue - networkFee;

        if (sendToValue < 0) {
            throw new Error('Insufficient funds to cover the sending amount and fee');
        }

        psbt.addOutput({ address: sendToAddress, value: sendToValue });

        const dustLimit = 546; // Satoshi, typical dust limit
        if (changeValue > dustLimit) {
            // Add change output if it's above the dust limit
            psbt.addOutput({ address: changeAddress, value: changeValue });
        }

        selectedUtxos.forEach((utxo, index) => {
            const keyPair = bitcoin.ECPair.fromWIF(utxo.wif, network);
            // Determine if the input is P2SH, P2WPKH, etc., and prepare the appropriate signing parameters
            if (utxo.address.startsWith('3')) {
                // Example for P2SH-P2WPKH
                const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
                const p2sh = bitcoin.payments.p2sh({
                    redeem: p2wpkh,
                    network,
                });
        
                psbt.signInput(index, keyPair, {
                    redeemScript: p2sh.redeem.output,
                    witnessUtxo: {
                        script: p2wpkh.output,
                        value: utxo.value,
                    },
                    sighashType: bitcoin.Transaction.SIGHASH_ALL, // Directly passing the sighashType
                });
            } else {
                // For other types, such as P2WPKH or P2PKH, where only the sighashType is needed
                psbt.signInput(index, keyPair, {
                    sighashType: bitcoin.Transaction.SIGHASH_ALL, // Directly passing the sighashType
                });
            }
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
