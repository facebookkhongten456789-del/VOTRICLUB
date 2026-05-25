
async function main() {
    try {
        const apiHost = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:3000';
        const res = await fetch(`${apiHost}/api/smm/services`);
        const data = await res.json();
        if (data.success && data.data) {
            const platforms = [...new Set(data.data.map(s => s.platform))];
            console.log('PLATFORMS:', platforms);
        } else {
            console.log('Failed to fetch from local server. Trying direct API...');
            const apiRes = await fetch('https://smm.bytemart.io.vn/api/v2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    key: '20ae9410b3a588226b7313ab4b8a0bf26a12cbab8397f',
                    action: 'services'
                })
            });
            const apiData = await apiRes.json();
            if (Array.isArray(apiData)) {
                const platforms = [...new Set(apiData.map(s => s.platform))];
                console.log('PLATFORMS:', platforms);
            } else {
                console.log('API returned non-array:', apiData);
            }
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}
main();
