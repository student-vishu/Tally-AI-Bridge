const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['TALLYMESSAGE', 'ALLLEDGERENTRIES.LIST', 'CATEGORYALLOCATIONS.LIST', 'COSTCENTREALLOCATIONS.LIST'].includes(name)
});

const ccSummaryParser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['DSPACCNAME', 'DSPACCINFO'].includes(name)
});

exports.parseXML = (xml) => {
    const result = parser.parse(xml);
    const messages = result?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE;
    console.log("TALLYMESSAGE isArray:", Array.isArray(messages), "| Count:", messages?.length);
    return result;
};

exports.parseCostCategorySummaryXML = (xml) => {
    return ccSummaryParser.parse(xml);
};

const cashFlowParser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['DSPACCINFO'].includes(name)
});

exports.parseCashFlowXML = (xml) => {
    return cashFlowParser.parse(xml);
};