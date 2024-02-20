const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const network = bitcoin.networks.bitcoin; // or bitcoin.networks.testnet for testnet

const sendFromWIF = 'KwyoKatW9Rg8gjnWc7PeC2gQY51MPs6jRpy9SUV9YrxKk91YRcr3';
const sendFromAddress = 'bc1qnrza67a7cy5gnhjwhrun9e37gfkgrm78h4tf9j';
const sendToAddress = '35tUsKG1MV69YUZML22LEio6ERFJ3qcrNh';
const sendToAmount = 10000; // Amount in satoshis to send
const isRBFEnabled = true; // Set to true to enable RBF, false otherwise
const networkFee = 5000; // Network fee in satoshis, provided by you
const utxoString = '[{"txid": "616e12cf827ccb527f2aa6de34973124a8937c0d0078e0feabc587420bf44d6d", "vout": 1, "value": "9585"}, {"txid": "f8dcbb5d280b7dd22c8fe706217e0d2ec7d9cc3499c95eed36c11bcc43904563", "vout": 0, "value": "140116"}]';

const sendFromUTXOs = JSON.parse(utxoString);
const keyPair = bitcoin.ECPair.fromWIF(sendFromWIF, network);
const psbt = new bitcoin.Psbt({ network });

async function fetchTransactionHex(txid) {
    try {
        const url = `https://blockstream.info/api/tx/${txid}/hex`;
        const response = await axios.get(url);
        return response.data; // This is the transaction hex
    } catch (error) {
        console.error('Error fetching transaction:', error);
        throw error; // Rethrow or handle as appropriate for your application
    }
}

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
        // Ensure the UTXO value is treated as a number for accurate summation
        totalInputValue += Number(utxo.value);
    }

    const sendToValue = Number(sendToAmount); // Ensure sendToAmount is treated as a number
    const feeValue = Number(networkFee); // Ensure networkFee is treated as a number
    let changeValue = totalInputValue - sendToValue - feeValue;

    psbt.addOutput({
        address: sendToAddress,
        value: sendToValue,
    });

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
}

buildTransaction().catch(console.error);
