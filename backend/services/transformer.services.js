exports.transformCompanyCashFlowFromReport = (parsed) => {
    const infos = [].concat(parsed?.ENVELOPE?.DSPACCINFO || []);
    let moneyIn = 0;
    let moneyOut = 0;
    infos.forEach(info => {
        const dr = parseFloat(info?.DSPDRAMT?.DSPDRAMTA || 0);
        const cr = parseFloat(info?.DSPCRAMT?.DSPCRAMTA || 0);
        moneyIn += Math.abs(dr);   // DSPDRAMTA (negative) = Inflow in Tally Cash Flow
        moneyOut += cr;             // DSPCRAMTA (positive) = Outflow in Tally Cash Flow
    });
    return { moneyIn, moneyOut };
};

exports.transformFromCostCategorySummary = (parsed, costCategories = []) => {
    const names = [].concat(parsed?.ENVELOPE?.DSPACCNAME || []);
    const infos = [].concat(parsed?.ENVELOPE?.DSPACCINFO || []);

    const projects = [];
    let currentCategory = '';
    for (let i = 0; i < names.length; i++) {
        const name = names[i]?.DSPDISPNAME;
        if (!name) continue;

        if (costCategories.includes(name)) {
            currentCategory = name;
            continue;
        }

        const drAmt = parseFloat(infos[i]?.DSPDRAMT?.DSPDRAMTA || 0);
        const crAmt = parseFloat(infos[i]?.DSPCRAMT?.DSPCRAMTA || 0);

        projects.push({
            project: name,
            category: currentCategory,
            feesReceived: crAmt > 0 ? crAmt : 0,
            expensesDone: drAmt < 0 ? Math.abs(drAmt) : 0
        });
    }
    return projects;
};

exports.transformCompanyCashFlow = (data) => {
    let moneyIn = 0;
    let moneyOut = 0;

    const messages = [].concat(
        data?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE || []
    );

    messages.forEach(msg => {
        const voucher = msg.VOUCHER;
        if (!voucher) return;

        const voucherType = voucher["@_VCHTYPE"]; // reliable in your data
        const entries = [].concat(voucher["ALLLEDGERENTRIES.LIST"] || []);

        entries.forEach(entry => {
            const amount = Math.abs(parseFloat(entry.AMOUNT || 0));

            // 🔥 FINAL LOGIC
            if (voucherType === "Payment" && entry.ISDEEMEDPOSITIVE === "Yes") {
                moneyOut += amount;
            }
            else if (voucherType === "Receipt" && entry.ISDEEMEDPOSITIVE === "No") {
                moneyIn += amount;
            }
            else if (voucherType === "Purchase" && entry.ISDEEMEDPOSITIVE === "No") {
                moneyOut += amount;
            }
            else if (voucherType === "Sales" && entry.ISDEEMEDPOSITIVE === "Yes") {
                moneyIn += amount;
            }
        });
    });

    return { moneyIn, moneyOut };
};

// exports.transformProjectCashFlow = (data) => {
//     const projectMap = {};

//     const messages = [].concat(
//         data?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE || []
//     );

//     messages.forEach(msg => {
//         const voucher = msg.VOUCHER;
//         if (!voucher) return;

//         const voucherType = voucher["@_VCHTYPE"];
//         const entries = [].concat(voucher["ALLLEDGERENTRIES.LIST"] || []);

//         entries.forEach(entry => {
//             const amount = Math.abs(parseFloat(entry.AMOUNT || 0));
//             // console.log("amount:", amount);

//             // 🔥 FIX: go inside CATEGORYALLOCATIONS
//             const categories = [].concat(entry["CATEGORYALLOCATIONS.LIST"] || []);

//             categories.forEach(cat => {
//                 const costCenters = [].concat(cat["COSTCENTREALLOCATIONS.LIST"] || []);
//                 // console.log("entry:", JSON.stringify(entry, null, 2));

//                 costCenters.forEach(cc => {
//                     const projectName = cc.NAME;

//                     if (!projectName) return;

//                     if (!projectMap[projectName]) {
//                         projectMap[projectName] = {
//                             project: projectName,
//                             feesReceived: 0,
//                             expensesDone: 0
//                         };
//                     }
//                     // console.log('cat:', Object.keys(cat))
//                     // 🔥 SAME LOGIC
//                     if (voucherType === "Receipt" && entry.ISDEEMEDPOSITIVE === "No") {
//                         projectMap[projectName].feesReceived += amount;
//                     }
//                     else if (voucherType === "Payment" && entry.ISDEEMEDPOSITIVE === "Yes") {
//                         projectMap[projectName].expensesDone += amount;
//                     }
//                 });
//             });
//         });
//     });

//     return Object.values(projectMap);
// };

exports.transformProjectCashFlow = (data) => {
    const projectMap = {};

    const messages = [].concat(
        data?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE || []
    );

    messages.forEach(msg => {
        const voucher = msg.VOUCHER;
        if (!voucher) return;

        const entries = [].concat(voucher["ALLLEDGERENTRIES.LIST"] || []);

        entries.forEach(entry => {
            let costCenters = [];

            // Path 1: Named categories (Establishment, Projects, etc.)
            if (entry["CATEGORYALLOCATIONS.LIST"]) {
                [].concat(entry["CATEGORYALLOCATIONS.LIST"]).forEach(cat => {
                    costCenters.push(...[].concat(cat["COSTCENTREALLOCATIONS.LIST"] || []));
                });
            }

            // Path 2: Primary Cost Category (sits directly on entry, no category wrapper)
            // Only use if Path 1 found nothing — prevents double-counting
            if (costCenters.length === 0 && entry["COSTCENTREALLOCATIONS.LIST"]) {
                costCenters = [].concat(entry["COSTCENTREALLOCATIONS.LIST"]);
            }

            if (costCenters.length === 0) return;

            costCenters.forEach(cc => {
                const projectName = cc.NAME;
                const amount = parseFloat(cc.AMOUNT || 0);

                if (!projectName || amount === 0) return;

                if (!projectMap[projectName]) {
                    projectMap[projectName] = {
                        project: projectName,
                        feesReceived: 0,
                        expensesDone: 0
                    };
                }

                // Tally XML: positive cc.AMOUNT = Credit (fee received), negative = Debit (expense out)
                if (amount > 0) {
                    projectMap[projectName].feesReceived += amount;
                } else {
                    projectMap[projectName].expensesDone += Math.abs(amount);
                }
            });
        });
    });

    return Object.values(projectMap);
};

