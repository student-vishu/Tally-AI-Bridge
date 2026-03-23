
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