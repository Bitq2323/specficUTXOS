const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const network = bitcoin.networks.bitcoin; // or bitcoin.networks.testnet for testnet

// Custom function to parse the UTXO string format
function parseUtxoString(utxoString) {
    const utxos = [];
    const utxoParts = utxoString.split('], [');
    utxoParts.forEach(part => {
        const cleanedPart = part.replace('[', '').replace(']', '').trim();
        const elements = cleanedPart.split(', ');
        const utxo = {};
        elements.forEach(element => {
            const [key, value] = element.split(': ');
            utxo[key.trim()] = value.replace(/"/g, '').trim();
        });
        utxos.push({
            txid: utxo.txid,
            vout: parseInt(utxo.vout, 10),
            value: utxo.value
        });
    });
    console.log('Parsed UTXOs:', utxos);
    return utxos;
}

module.exports = async (req, res) => {
    try {
        console.log('Received request:', req.body);
        const { sendFromWIF, sendFromAddress, sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString } = req.body;

        if (!sendFromWIF || !sendFromAddress || !sendToAddress || !sendToAmount || !utxoString) {
            console.log('Missing required fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const sendFromUTXOs = parseUtxoString(utxoString);
        const keyPair = bitcoin.ECPair.fromWIF(sendFromWIF, network);
        const psbt = new bitcoin.Psbt({ network });

        async function fetchTransactionHex(txid) {
            try {
                const url = `https://blockstream.info/api/tx/${txid}/hex`;
                const response = await axios.get(url);
                return response.data;
            } catch (error) {
                console.error('Error fetching transaction hex:', error);
                throw new Error('Failed to fetch transaction hex');
            }
        }

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

        // Directly use the sender's address as the change address
        if (changeValue > 0) {
            psbt.addOutput({
                address: sendFromAddress, // Use sender's address for change
                value: changeValue,
            });
        } else {
            throw new Error('Insufficient input value for transaction outputs and fees');
        }

        sendFromUTXOs.forEach((_, index) => {
            psbt.signInput(index, keyPair);
        });

        psbt.finalizeAllInputs();
        const transaction = psbt.extractTransaction();
        console.log(`Transaction HEX: ${transaction.toHex()}`);

        res.status(200).json({ success: true, transactionHex: transaction.toHex() });
    } catch (error) {
        console.error('Error processing transaction:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
