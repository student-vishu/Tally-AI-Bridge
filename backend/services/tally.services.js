const axios = require('axios');

exports.callTally = async (xml) => {
    try {
        const res = await axios.post(process.env.TALLY_URL, xml, {
            headers: { 'Content-Type': 'text/xml' }
        });

        if (res.data.includes('<LINEERROR>')) {
            throw new Error('No company open in Tally');
        }

        return res.data;

    } catch (err) {
        throw new Error('Tally not reachable');
    }
};