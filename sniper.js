/**
 * 🚀 SHEINVERSE SNIPER - FINAL OPTIMIZED
 * - Men's products only
 * - Multi-page fetching
 * - Fast Telegram sending (max speed)
 * - Summary at end
 */

const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8367734034:AAETSFcPiMTyTvzyP3slc75-ndfGMenXK5U";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-1003320038050";
const PROXY_URL = process.env.PROXY_URL || null;

const SEEN_FILE = 'seen_products.json';
const COOKIES_FILE = 'cookies.json';

const API_URL = 'https://www.sheinindia.in/api/category/sverse-5939-37961';
const CATEGORY_PAGE = 'https://www.sheinindia.in/c/sverse-5939-37961';

// Configuration
const MAX_PAGES_TO_FETCH = 3; // Fetch first 3 pages (120 products)
const PAGE_SIZE = 40; // Products per page
const TELEGRAM_DELAY_MS = 100; // 100ms = 10 messages/second (Telegram's limit is 30/sec for groups)

const API_PARAMS = {
    fields: 'SITE',
    pageSize: PAGE_SIZE.toString(),
    format: 'json',
    query: ':relevance:genderfilter:Men',
    gridColumns: '2',
    segmentIds: '23,17,18,9',
    customerType: 'Existing',
    includeUnratedProducts: 'false',
    advfilter: 'true',
    platform: 'Desktop',
    showAdsOnNextPage: 'false',
    is_ads_enable_plp: 'true',
    displayRatings: 'true',
    store: 'shein'
};

function loadSeenProducts() {
    try {
        if (fs.existsSync(SEEN_FILE)) {
            return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('⚠️ Error loading seen products:', e.message);
    }
    return {};
}

function saveSeenProducts(seen) {
    try {
        fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
        console.log(`✅ Saved ${Object.keys(seen).length} products`);
    } catch (e) {
        console.log('❌ Error saving:', e.message);
    }
}

function loadCookies() {
    try {
        if (fs.existsSync(COOKIES_FILE)) {
            const data = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
            if (Date.now() - data.timestamp < 30 * 60 * 1000) {
                console.log('✅ Using cached cookies (age: ' + Math.round((Date.now() - data.timestamp) / 60000) + ' min)');
                return data.cookies;
            } else {
                console.log('⏰ Cached cookies expired');
            }
        }
    } catch (e) {
        console.log('⚠️ No valid cached cookies');
    }
    return null;
}

function saveCookies(cookies) {
    try {
        fs.writeFileSync(COOKIES_FILE, JSON.stringify({
            cookies: cookies,
            timestamp: Date.now()
        }, null, 2));
        console.log('💾 Cookies cached for 30 minutes');
    } catch (e) {
        console.log('⚠️ Error saving cookies:', e.message);
    }
}

function parseProxyUrl(proxyUrl) {
    if (!proxyUrl) return null;
    
    try {
        const url = new URL(proxyUrl);
        return {
            host: url.hostname,
            port: url.port,
            username: url.username,
            password: url.password,
            fullUrl: proxyUrl
        };
    } catch (e) {
        console.error('❌ Invalid proxy URL format:', e.message);
        return null;
    }
}

async function getFreshCookies() {
    console.log('🍪 Getting fresh cookies with Puppeteer...');
    
    const proxyInfo = parseProxyUrl(PROXY_URL);
    
    if (proxyInfo) {
        console.log(`🔒 Using proxy: ${proxyInfo.host}:${proxyInfo.port}`);
    } else {
        console.log('⚠️ WARNING: No proxy - API will likely be blocked');
    }
    
    let browser;
    try {
        const launchOptions = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        };
        
        if (proxyInfo) {
            launchOptions.args.push(`--proxy-server=${proxyInfo.host}:${proxyInfo.port}`);
        }
        
        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        
        if (proxyInfo && proxyInfo.username && proxyInfo.password) {
            await page.authenticate({
                username: proxyInfo.username,
                password: proxyInfo.password
            });
            console.log('✅ Proxy authenticated');
        }
        
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; sdk_gphone64_x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36');
        await page.setViewport({ width: 412, height: 915, isMobile: true });
        
        console.log('📄 Loading category page...');
        
        await page.goto(CATEGORY_PAGE, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        console.log('⏳ Waiting for Akamai cookies to generate...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        const cookies = await page.cookies();
        
        await browser.close();
        
        if (cookies.length === 0) {
            console.log('❌ No cookies received');
            return null;
        }
        
        const cookieString = cookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
        
        const importantCookies = ['_abck', 'ak_bmsc', 'bm_sz', 'bm_sv', 'bm_s', 'bm_so', 'bm_mi'];
        const foundCookies = importantCookies.filter(name => 
            cookies.some(c => c.name === name)
        );
        
        console.log(`✅ Got ${cookies.length} cookies`);
        console.log(`🔑 Key cookies found: ${foundCookies.join(', ')}`);
        
        saveCookies(cookieString);
        return cookieString;
        
    } catch (error) {
        console.error('❌ Failed to get cookies:', error.message);
        if (browser) {
            await browser.close();
        }
        return null;
    }
}

async function sendTelegramAlert(product) {
    try {
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('photo', product.imageUrl);
        formData.append('caption', `👔 <b>${product.name}</b>\n💰 ${product.price} 🔥\n🔗 <a href="${product.url}">VIEW</a>`);
        formData.append('parse_mode', 'HTML');
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            body: formData
        });
        
        return { success: true, product };
    } catch (error) {
        console.error(`   ❌ Failed: ${product.name.substring(0, 30)}... - ${error.message}`);
        return { success: false, product, error: error.message };
    }
}

async function sendTelegramSummary(newProducts, successCount, failCount) {
    try {
        // Create summary text
        const summary = `
📊 <b>NEW DROPS SUMMARY</b>

🆕 Total new products: ${newProducts.length}
✅ Alerts sent: ${successCount}
${failCount > 0 ? `❌ Failed: ${failCount}\n` : ''}
🕐 ${new Date().toLocaleTimeString()}

📦 <b>Products:</b>
${newProducts.slice(0, 10).map((p, i) => `${i + 1}. ${p.name.substring(0, 40)}... - ${p.price}`).join('\n')}
${newProducts.length > 10 ? `\n... and ${newProducts.length - 10} more!` : ''}
`;

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: summary,
                parse_mode: 'HTML'
            })
        });
        
        console.log('📤 Summary sent to Telegram');
    } catch (error) {
        console.error('❌ Failed to send summary:', error.message);
    }
}

async function fetchPageProducts(pageNumber, cookies) {
    try {
        const url = new URL(API_URL);
        const params = { ...API_PARAMS, currentPage: pageNumber.toString() };
        
        Object.keys(params).forEach(key => {
            url.searchParams.append(key, params[key]);
        });
        
        const headers = {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Host': 'www.sheinindia.in',
            'Referer': 'https://www.sheinindia.in/c/sverse-5939-37961',
            'sec-ch-ua': '"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; sdk_gphone64_x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36',
            'X-TENANT-ID': 'SHEIN',
            'Cookie': cookies
        };
        
        const fetchOptions = {
            method: 'GET',
            headers: headers
        };
        
        if (PROXY_URL) {
            fetchOptions.agent = new HttpsProxyAgent(PROXY_URL);
        }
        
        const response = await fetch(url.toString(), fetchOptions);
        
        if (!response.ok) {
            console.log(`❌ Page ${pageNumber} failed: ${response.status}`);
            return { products: [], pagination: null };
        }
        
        const data = await response.json();
        
        if (!data.products || !Array.isArray(data.products)) {
            console.log(`⚠️ Page ${pageNumber}: Unexpected response structure`);
            return { products: [], pagination: null };
        }
        
        const products = data.products.map(p => ({
            id: p.code,
            name: (p.name || '').replace(/Shein\s*/i, '').trim(),
            price: p.offerPrice?.displayformattedValue || p.price?.displayformattedValue || 'N/A',
            url: 'https://www.sheinindia.in' + p.url,
            imageUrl: p.images?.[0]?.url || ''
        }));
        
        return { products, pagination: data.pagination };
        
    } catch (error) {
        console.error(`❌ Page ${pageNumber} error:`, error.message);
        return { products: [], pagination: null };
    }
}

async function fetchAllProducts(cookies) {
    console.log('🔍 Fetching Men\'s products from Shein API...');
    
    let allProducts = [];
    let totalResults = 0;
    
    const firstPageResult = await fetchPageProducts(1, cookies);
    
    if (firstPageResult.products.length === 0) {
        console.log('❌ Failed to fetch first page');
        return [];
    }
    
    allProducts = firstPageResult.products;
    
    if (firstPageResult.pagination) {
        totalResults = firstPageResult.pagination.totalResults;
        const totalPages = firstPageResult.pagination.totalPages;
        
        console.log(`📊 Total Men's products: ${totalResults}`);
        console.log(`📄 Total pages: ${totalPages}`);
        console.log(`✅ Page 1/${totalPages}: ${firstPageResult.products.length} products`);
        
        const pagesToFetch = Math.min(MAX_PAGES_TO_FETCH, totalPages);
        
        for (let page = 2; page <= pagesToFetch; page++) {
            console.log(`🔄 Fetching page ${page}/${pagesToFetch}...`);
            
            const pageResult = await fetchPageProducts(page, cookies);
            
            if (pageResult.products.length > 0) {
                allProducts = allProducts.concat(pageResult.products);
                console.log(`✅ Page ${page}/${pagesToFetch}: ${pageResult.products.length} products`);
            } else {
                console.log(`⚠️ Page ${page}/${pagesToFetch}: No products`);
            }
            
            await new Promise(r => setTimeout(r, 1000));
        }
    } else {
        console.log(`✅ Got ${firstPageResult.products.length} products`);
    }
    
    console.log(`\n📦 Fetched: ${allProducts.length}/${totalResults}\n`);
    return allProducts;
}

async function runSniper() {
    console.log('\n🚀 ========================================');
    console.log('   SHEINVERSE SNIPER - MEN\'S ONLY');
    console.log('   ========================================\n');
    console.log(`📅 ${new Date().toLocaleString()}\n`);
    
    if (!PROXY_URL) {
        console.log('❌ ERROR: PROXY_URL not set!');
        console.log('🛑 Stopping\n');
        return;
    }
    
    const proxyInfo = parseProxyUrl(PROXY_URL);
    if (proxyInfo) {
        console.log(`🔒 Proxy: ${proxyInfo.username}:***@${proxyInfo.host}:${proxyInfo.port}\n`);
    }
    
    let cookies = loadCookies();
    if (!cookies) {
        cookies = await getFreshCookies();
        if (!cookies) {
            console.log('❌ Failed to get cookies');
            return;
        }
    }
    
    let allProducts = await fetchAllProducts(cookies);
    
    if (allProducts.length === 0) {
        console.log('🔄 Retrying with fresh cookies...\n');
        cookies = await getFreshCookies();
        if (cookies) {
            allProducts = await fetchAllProducts(cookies);
        }
    }
    
    if (allProducts.length === 0) {
        console.log('❌ No products found\n');
        return;
    }
    
    const seen = loadSeenProducts();
    console.log(`📂 Previously seen: ${Object.keys(seen).length}`);
    
    const newProducts = allProducts.filter(p => p.id && !seen[p.id]);
    console.log(`🆕 NEW products: ${newProducts.length}\n`);
    
    if (newProducts.length > 0) {
        console.log(`📢 Sending ${newProducts.length} alerts at max speed...\n`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < newProducts.length; i++) {
            const product = newProducts[i];
            
            const result = await sendTelegramAlert(product);
            
            if (result.success) {
                successCount++;
                console.log(`✅ ${i + 1}/${newProducts.length} - ${product.name.substring(0, 40)}...`);
            } else {
                failCount++;
            }
            
            seen[product.id] = Date.now();
            
            // Telegram rate limit: 30 msg/sec for groups, we use 10/sec to be safe
            await new Promise(r => setTimeout(r, TELEGRAM_DELAY_MS));
        }
        
        saveSeenProducts(seen);
        
        console.log(`\n✅ Alerts sent: ${successCount}/${newProducts.length}`);
        if (failCount > 0) {
            console.log(`❌ Failed: ${failCount}`);
        }
        
        // Send summary to Telegram
        console.log('\n📊 Sending summary...');
        await sendTelegramSummary(newProducts, successCount, failCount);
        
        console.log('\n' + '='.repeat(50));
        console.log('📋 NEW PRODUCTS SUMMARY');
        console.log('='.repeat(50));
        newProducts.forEach((p, i) => {
            console.log(`${i + 1}. ${p.name} - ${p.price}`);
        });
        console.log('='.repeat(50));
        
    } else {
        allProducts.forEach(p => {
            if (!seen[p.id]) seen[p.id] = Date.now();
        });
        saveSeenProducts(seen);
        console.log('😴 No new products this round');
    }
    
    console.log('\n✅ Run complete!');
    console.log('========================================\n');
}

runSniper().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
