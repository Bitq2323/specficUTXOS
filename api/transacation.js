const bitcoin = require('bitcoinjs-lib');
const { broadcastTransaction, parseUtxos, fetchTransactionHex } = require('./helper');

module.exports = async (req, res) => {
    console.log('Request Body:', JSON.stringify(req.body));
    try {
        const expectedParams = ['sendToAddress', 'sendToAmount', 'isRBFEnabled', 'networkFee', 'utxoString', 'isBroadcast', 'changeAddress', 'isSelectedUtxos'];
        const missingParams = expectedParams.filter(param => req.body[param] === undefined);

        if (missingParams.length > 0) {
            return res.status(400).json({ success: false, error: `Missing parameters: ${missingParams.join(', ')}` });
        }

        const { sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString, isBroadcast, changeAddress, isSelectedUtxos } = req.body;
        const network = bitcoin.networks.bitcoin;

        let utxos = parseUtxos(utxoString);
        if (!isSelectedUtxos) {
            utxos.sort((a, b) => b.value - a.value); // Sort UTXOs by value in descending order if isSelectedUtxos is false
        }

        const psbt = new bitcoin.Psbt({ network });
        let totalInputValue = 0;

// Corrected: Ensure async operation inside forEach by using for...of instead
for (const utxo of selectedUtxos) {
    const txHex = await fetchTransactionHex(utxo.txid); // Await needs async function
    const ecpair = bitcoin.ECPair.fromWIF(utxo.wif, network);
    let input = {
        hash: utxo.txid,
        index: utxo.vout,
        sequence: isRBFEnabled ? 0xfffffffe : undefined,
    };

    if (utxo.address.startsWith('3')) {
        const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: ecpair.publicKey, network });
        const p2sh = bitcoin.payments.p2sh({ redeem: p2wpkh, network });
        input.witnessUtxo = {
            script: p2sh.output,
            value: utxo.value,
        };
        input.redeemScript = p2sh.redeem.output;
    } else {
        input.nonWitnessUtxo = Buffer.from(txHex, 'hex');
    }

    psbt.addInput(input);
}

        let sendToValue = Math.min(sendToAmount, totalInputValue - networkFee);
        let changeValue = totalInputValue - sendToValue - networkFee;

        if (sendToValue < 0) throw new Error('Insufficient funds to cover the sending amount and fee');

        psbt.addOutput({ address: sendToAddress, value: sendToValue });

        const dustLimit = 546; // Satoshi, typical dust limit
        if (changeValue > dustLimit) {
            psbt.addOutput({ address: changeAddress, value: changeValue });
        }

        utxos.forEach((utxo, index) => {
            const keyPair = bitcoin.ECPair.fromWIF(utxo.wif, network);
            if (utxo.address.startsWith('3')) {
                const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
                const p2sh = bitcoin.payments.p2sh({ redeem: p2wpkh, network });
                psbt.signInput(index, keyPair, {
                    redeemScript: p2sh.redeem.output,
                    witnessUtxo: input.witnessUtxo,
                });
            } else {
                psbt.signInput(index, keyPair);
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
