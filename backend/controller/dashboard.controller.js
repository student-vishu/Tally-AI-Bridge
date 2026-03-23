const { callTally } = require('../services/tally.services');
const { buildDayBookXML } = require('../templates/daybook.xml');
const { parseXML } = require('../services/parser.services');
const { transformCompanyCashFlow } = require('../services/transformer.services');

exports.getCompanyCashFlow = async (req, res, next) => {
    try {
        const fromDate = process.env.FY_FROM_DATE;
        const toDate = process.env.FY_TO_DATE;

        const xml = buildDayBookXML(fromDate, toDate);
        // console.log("xml:", xml)
        const raw = await callTally(xml);
        // console.log("raw:", raw);

        const parsed = parseXML(raw);
        console.log("parsed:", JSON.stringify(parsed, null, 2));

        const result = transformCompanyCashFlow(parsed);

        res.json({ success: true, data: result });

    } catch (err) {
        next(err);
    }
};