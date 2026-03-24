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

exports.transformProjectCashFlow = (data) => {
    const projectMap = {};

    const messages = [].concat(
        data?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE || []
    );

    messages.forEach(msg => {
        const voucher = msg.VOUCHER;
        if (!voucher) return;

        const voucherType = voucher["@_VCHTYPE"];
        const entries = [].concat(voucher["ALLLEDGERENTRIES.LIST"] || []);

        entries.forEach(entry => {
            const amount = Math.abs(parseFloat(entry.AMOUNT || 0));

            // 🔥 FIX: go inside CATEGORYALLOCATIONS
            const categories = [].concat(entry["CATEGORYALLOCATIONS.LIST"] || []);

            categories.forEach(cat => {
                const costCenters = [].concat(cat["COSTCENTREALLOCATIONS.LIST"] || []);
                // console.log("entry:", JSON.stringify(entry, null, 2));

                costCenters.forEach(cc => {
                    const projectName = cc.NAME;

                    if (!projectName) return;

                    if (!projectMap[projectName]) {
                        projectMap[projectName] = {
                            project: projectName,
                            feesReceived: 0,
                            expensesDone: 0
                        };
                    }
                    // console.log('cat:', Object.keys(cat))
                    // 🔥 SAME LOGIC
                    if (voucherType === "Receipt" && entry.ISDEEMEDPOSITIVE === "No") {
                        projectMap[projectName].feesReceived += amount;
                    }
                    else if (voucherType === "Payment" && entry.ISDEEMEDPOSITIVE === "Yes") {
                        projectMap[projectName].expensesDone += amount;
                    }
                });
            });
        });
    });

    return Object.values(projectMap);
};