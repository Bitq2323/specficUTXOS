const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const network = bitcoin.networks.bitcoin; // or bitcoin.networks.testnet for testnet

// Serverless function handler
module.exports = async (req, res) => {
    // Configuration
    const network = bitcoin.networks.bitcoin; // or bitcoin.networks.testnet for testnet
    const sendFromWIF = req.body.sendFromWIF || 'default_WIF_here';
    const sendFromAddress = req.body.sendFromAddress || 'default_send_from_address_here';
    const sendToAddress = req.body.sendToAddress || 'default_send_to_address_here';
    const sendToAmount = req.body.sendToAmount || 10000; // Amount in satoshis to send
    const isRBFEnabled = req.body.isRBFEnabled || true;
    const networkFee = req.body.networkFee || 5000; // Network fee in satoshis
    const utxoString = req.body.utxoString || 'default_UTXO_string_here';

    const sendFromUTXOs = JSON.parse(utxoString);
    const keyPair = bitcoin.ECPair.fromWIF(sendFromWIF, network);
    const psbt = new bitcoin.Psbt({ network });

    // Function to fetch transaction hex
    async function fetchTransactionHex(txid) {
        try {
            const url = `https://blockstream.info/api/tx/${txid}/hex`;
            const response = await axios.get(url);
            return response.data; // This is the transaction hex
        } catch (error) {
            console.error('Error fetching transaction:', error);
            throw error;
        }
    }

    // Main function to build and send the transaction
    async function buildTransaction() {
        let totalInputValue = 0;

        for (const utxo of sendFromUTXOs) {
            const txHex = await fetchTransactionHex(utxo.txid);
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                sequence: isRBFEnabled ? 0xfffffffe : undefined,
                nonWitnessUtxo: Buffer.from(txHex, 'hex'),
            });
            totalInputValue += Number(utxo.value);
        }

        const sendToValue = Number(sendToAmount);
        const feeValue = Number(networkFee);
        let changeValue = totalInputValue - sendToValue - feeValue;

        psbt.addOutput({
            address: sendToAddress,
            value: sendToValue,
        });

        if (changeValue > 0) {
            let changeAddress;
            // Logic for determining the change address
            // Same as your original code...

            psbt.addOutput({
                address: changeAddress,
                value: changeValue,
            });
        } else {
            throw new Error('Insufficient input value for the transaction outputs and fees');
        }

    // Ensure changeValue is positive before attempting to add a change output
    if (changeValue > 0) {
        let changeAddress;
        if (sendFromAddress.startsWith('1')) {
            changeAddress = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address;
        } else if (sendFromAddress.startsWith('3')) {
            changeAddress = bitcoin.payments.p2sh({
                redeem: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }),
                network,
            }).address;
        } else if (sendFromAddress.startsWith('bc1')) {
            changeAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address;
        } else {
            throw new Error('Unsupported address type for sendFromAddress');
        }

        psbt.addOutput({
            address: changeAddress,
            value: changeValue,
        });
    } else {
        throw new Error('Insufficient input value for the transaction outputs and fees');
    }

    // Sign all inputs
    sendFromUTXOs.forEach((_, index) => {
        psbt.signInput(index, keyPair);
    });

    psbt.finalizeAllInputs();
    const transaction = psbt.extractTransaction();
    console.log(`Transaction HEX: ${transaction.toHex()}`);
    return transaction.toHex(); // Return the transaction hex
}

// Run the buildTransaction function and send the response
try {
    const transactionHex = await buildTransaction();
    res.status(200).send({ success: true, transactionHex: transactionHex });
} catch (error) {
    res.status(500).send({ success: false, error: error.message });
}
};
