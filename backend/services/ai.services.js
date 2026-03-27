const { spawnSync } = require('child_process');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

exports.interpretPrompt = async ({ query, sections }) => {
    const list = sections.map(s => `- "${s.id}": ${s.description}`).join('\n');

    const systemPrompt = `You are a routing assistant for a financial dashboard.
Available sections:
${list}

The user asked: ${query}

Return a JSON object: { "sections": ["id1", "id2"] }
Include only section IDs relevant to the query.
If nothing matches, return { "sections": [] }.
Return ONLY valid JSON, no explanation.`;

    let text;
    const provider = process.env.AI_PROVIDER || 'claude-code';
    console.log('[AI Service] Provider :', provider);
    console.log('[AI Service] Prompt   :\n' + systemPrompt);

    if (provider === 'claude-code') {
        // Strip ANTHROPIC_API_KEY so claude CLI uses session auth, not API key
        const env = { ...process.env };
        delete env.ANTHROPIC_API_KEY;

        const result = spawnSync('claude', ['--print'], {
            input: systemPrompt,
            encoding: 'utf8',
            timeout: 30000,
            shell: true,
            env
        });
        if (result.error) throw new Error('claude CLI not found: ' + result.error.message);
        if (result.status !== 0) throw new Error('claude CLI error: ' + result.stderr);
        text = result.stdout.trim();
        console.log('[AI Service] Raw response:', text);
    } else if (provider === 'openai') {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: systemPrompt }]
        });
        text = completion.choices[0].message.content;
    } else {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{ role: 'user', content: systemPrompt }]
        });
        text = message.content[0].text;
    }

    // Extract JSON from response (claude CLI may include extra text)
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
        console.log('[AI Service] No JSON found in response');
        return [];
    }
    const parsed = JSON.parse(match[0]);
    const result = parsed.sections || [];
    console.log('[AI Service] Parsed sections:', result);
    return result;
};
