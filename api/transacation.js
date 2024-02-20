const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');

// Custom function to parse the UTXO string format
function parseUtxoString(utxoString) {
    // Initial transformation to make the string look like a JSON array
    let formattedString = utxoString
        .replace(/\[/g, '') // Remove all opening brackets
        .replace(/\]/g, '') // Remove all closing brackets
        .trim();

    // Split the string by "], [" to separate each UTXO, accounting for removals
    const utxoParts = formattedString.split('), (');
    const utxos = utxoParts.map(part => {
        // Split each part by ", " to get key-value pairs
        const keyValuePairs = part.split(', ').map(kv => {
            // Split by ": " to separate keys and values
            let [key, value] = kv.split(': ');
            value = value.replace(/"/g, ''); // Remove quotes from value
            return { key, value };
        });

        // Convert array of key-value pairs to an object
        const utxoObj = keyValuePairs.reduce((obj, { key, value }) => {
            obj[key] = value;
            return obj;
        }, {});

        return {
            txid: utxoObj.txid,
            vout: parseInt(utxoObj.vout, 10),
            value: utxoObj.value // Keeping as string, but convert as needed
        };
    });

    return utxos;
}


// Serverless function handler
module.exports = async (req, res) => {
    try {
        // Log incoming request for debugging
        console.log('Request body:', req.body);

        const network = bitcoin.networks.bitcoin; // or bitcoin.networks.testnet for testnet
        const { sendFromWIF, sendFromAddress, sendToAddress, sendToAmount, isRBFEnabled, networkFee, utxoString } = req.body;

        // Validate required fields
        if (!sendFromWIF || !sendFromAddress || !sendToAddress || !sendToAmount || !utxoString) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const sendFromUTXOs = parseUtxoString(utxoString);
        const keyPair = bitcoin.ECPair.fromWIF(sendFromWIF, network);
        const psbt = new bitcoin.Psbt({ network });

        // Function to fetch transaction hex
        async function fetchTransactionHex(txid) {
            const url = `https://blockstream.info/api/tx/${txid}/hex`;
            const response = await axios.get(url);
            return response.data;
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
            totalInputValue += parseInt(utxo.value, 10);
        }

        const sendToValue = parseInt(sendToAmount, 10);
        const feeValue = parseInt(networkFee || 5000, 10);
        let changeValue = totalInputValue - sendToValue - feeValue;

        // Add recipient output
        psbt.addOutput({
            address: sendToAddress,
            value: sendToValue,
        });

        // Add change output if applicable
        if (changeValue > 0) {
            psbt.addOutput({
                address: sendFromAddress, // Use sender address for change
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
        res.status(200).json({ success: true, transactionHex: transaction.toHex() });
    } catch (error) {
        console.error('Error processing transaction:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
