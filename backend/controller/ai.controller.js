const { interpretPrompt } = require('../services/ai.services');

exports.handleAI = (req, res) => {
    const { prompt } = req.body;

    const result = interpretPrompt(prompt);

    res.json({ success: true, data: result });
};