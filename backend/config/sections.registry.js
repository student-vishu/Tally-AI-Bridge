const SECTIONS_REGISTRY = [
    {
        id: 'company-cashflow',
        label: 'Company Cash Flow',
        description: 'Total company money in, money out, and net cash flow',
        endpoint: '/api/dashboard/company-cashflow'
    },
    {
        id: 'project-cashflow',
        label: 'Project Cash Flow',
        description: 'Per-project fees received, expenses done, and net per project',
        endpoint: '/api/dashboard/project-cashflow'
    }
    // Add new sections here only — frontend and AI routing update automatically
];

module.exports = SECTIONS_REGISTRY;
