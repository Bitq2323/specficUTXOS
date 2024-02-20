// Custom function to parse the UTXO string format
function parseUtxoString(utxoString) {
    // Initial transformation to make the string look like a JSON array
    let formattedString = utxoString
        .replace(/\[/g, '') // Remove all opening brackets
        .replace(/\]/g, '') // Remove all closing brackets
        .trim();

// Split the string by "], [" to separate each UTXO, as originally intended
const utxoParts = formattedString.split('], [');
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

module.exports = {
    parseUtxoString,
};