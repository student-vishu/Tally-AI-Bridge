exports.interpretPrompt = (prompt) => {
    if (prompt.includes('project')) {
        return { route: 'project-cashflow' };
    }
    return { route: 'company-cashflow' };
};