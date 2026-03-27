const { interpretPrompt } = require('../services/ai.services');

exports.handleAI = async (req, res, next) => {
    try {
        const { query, sections } = req.body;
        if (!query) return res.status(400).json({ success: false, error: 'query is required' });

        console.log('\n[AI Search] Query     :', query);
        console.log('[AI Search] Sections  :', (sections || []).map(s => s.id).join(', '));

        const matchedSections = await interpretPrompt({ query, sections: sections || [] });

        console.log('[AI Search] Matched   :', matchedSections.length ? matchedSections.join(', ') : 'none');

        res.json({ success: true, data: { sections: matchedSections } });
    } catch (err) {
        next(err);
    }
};
