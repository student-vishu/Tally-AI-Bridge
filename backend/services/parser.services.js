const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
    ignoreAttributes: false
});

exports.parseXML = (xml) => {
    return parser.parse(xml);
};