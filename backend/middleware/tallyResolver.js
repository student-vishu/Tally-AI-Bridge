// Resolves the Tally URL for each request based on the client's IP address.
// Every laptop on the LAN runs Tally on the same port, so the Tally URL is
// simply http://<client-ip>:<TALLY_PORT>.
// Sets req.tallyUrl so controllers can pass it directly to services.

const DEFAULT_URL = process.env.TALLY_URL || 'http://localhost:9000';
const TALLY_PORT  = process.env.TALLY_PORT || '9000';

module.exports = function tallyResolver(req, res, next) {
    // X-Real-IP is set by Vite's proxy and contains the actual client IP
    let ip = req.headers['x-real-ip'] || req.ip || '127.0.0.1';

    // Loopback — server machine opening the dashboard
    if (ip === '::1' || ip === '127.0.0.1') {
        req.tallyUrl = DEFAULT_URL;
    } else {
        // Strip IPv4-mapped IPv6 prefix (e.g. "::ffff:192.168.1.13" → "192.168.1.13")
        ip = ip.replace(/^::ffff:/, '');
        req.tallyUrl = `http://${ip}:${TALLY_PORT}`;
    }

    next();
};
