/**
 * 🚀 SHEINVERSE SNIPER - OPTIMIZED (MEN'S FILTER)
 * - Fetches Men's products only
 * - Multi-page support
 * - No stock checking (fast & reliable)
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
const MAX_PAGES_TO_FETCH = 3; // Fetch first 3 pages (120 products) - adjust as needed
const PAGE_SIZE = 40; // Products per page

const API_PARAMS = {
    fields: 'SITE',
    pageSize: PAGE_SIZE.toString(),
    format: 'json',
    query: ':relevance:genderfilter:Men', // MEN'S FILTER
    gridColumns: '2',
    segmentIds: '23,17,18,9', // Men's segment IDs
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
    const caption = `👔 <b>${product.name}</b>\n💰 ${product.price} 🔥 NEW DROP\n🔗 <a href="${product.url}">VIEW NOW</a>`;
    
    try {
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('photo', product.imageUrl);
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            body: formData
        });
        
        console.log(`   📤 Alert sent: ${product.name.substring(0, 40)}...`);
    } catch (error) {
        console.error(`   ❌ Telegram failed: ${error.message}`);
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
    
    // Fetch first page to get total count
    const firstPageResult = await fetchPageProducts(1, cookies);
    
    if (firstPageResult.products.length === 0) {
        console.log('❌ Failed to fetch first page');
        return [];
    }
    
    allProducts = firstPageResult.products;
    
    if (firstPageResult.pagination) {
        totalResults = firstPageResult.pagination.totalResults;
        const totalPages = firstPageResult.pagination.totalPages;
        
        console.log(`📊 Total Men's products in category: ${totalResults}`);
        console.log(`📄 Total pages available: ${totalPages}`);
        console.log(`✅ Page 1/${totalPages}: Got ${firstPageResult.products.length} products`);
        
        // Fetch additional pages
        const pagesToFetch = Math.min(MAX_PAGES_TO_FETCH, totalPages);
        
        for (let page = 2; page <= pagesToFetch; page++) {
            console.log(`🔄 Fetching page ${page}/${pagesToFetch}...`);
            
            const pageResult = await fetchPageProducts(page, cookies);
            
            if (pageResult.products.length > 0) {
                allProducts = allProducts.concat(pageResult.products);
                console.log(`✅ Page ${page}/${pagesToFetch}: Got ${pageResult.products.length} products`);
            } else {
                console.log(`⚠️ Page ${page}/${pagesToFetch}: No products returned`);
            }
            
            // Small delay between pages to avoid rate limiting
            await new Promise(r => setTimeout(r, 1000));
        }
    } else {
        console.log(`✅ Got ${firstPageResult.products.length} products (single page)`);
    }
    
    console.log(`\n📦 Total Men's products fetched: ${allProducts.length}/${totalResults}`);
    return allProducts;
}

async function runSniper() {
    console.log('\n🚀 ========================================');
    console.log('   SHEINVERSE SNIPER - MEN\'S ONLY');
    console.log('   ========================================\n');
    console.log(`📅 ${new Date().toLocaleString()}\n`);
    
    if (!PROXY_URL) {
        console.log('❌ ERROR: PROXY_URL not set!');
        console.log('💡 You MUST configure a proxy for this to work');
        console.log('🛑 Stopping - cannot proceed without proxy\n');
        return;
    }
    
    const proxyInfo = parseProxyUrl(PROXY_URL);
    if (proxyInfo) {
        console.log(`🔒 Proxy: ${proxyInfo.username}:***@${proxyInfo.host}:${proxyInfo.port}\n`);
    }
    
    // Get cookies
    let cookies = loadCookies();
    if (!cookies) {
        cookies = await getFreshCookies();
        if (!cookies) {
            console.log('❌ Failed to get cookies');
            return;
        }
    }
    
    // Fetch products
    let allProducts = await fetchAllProducts(cookies);
    
    // If failed, refresh cookies and retry once
    if (allProducts.length === 0) {
        console.log('🔄 First attempt failed, refreshing cookies...\n');
        cookies = await getFreshCookies();
        if (cookies) {
            allProducts = await fetchAllProducts(cookies);
        }
    }
    
    if (allProducts.length === 0) {
        console.log('❌ No products found after retry\n');
        return;
    }
    
    const seen = loadSeenProducts();
    console.log(`📂 Previously seen: ${Object.keys(seen).length}`);
    
    const newProducts = allProducts.filter(p => p.id && !seen[p.id]);
    console.log(`🆕 NEW Men's products: ${newProducts.length}\n`);
    
    if (newProducts.length > 0) {
        console.log('📢 Sending alerts...\n');
        
        for (let i = 0; i < newProducts.length; i++) {
            const product = newProducts[i];
            console.log(`${i + 1}/${newProducts.length}. ${product.name.substring(0, 50)}... - ${product.price}`);
            
            await sendTelegramAlert(product);
            seen[product.id] = Date.now();
            
            // Rate limiting: 1 second between alerts
            await new Promise(r => setTimeout(r, 1000));
        }
        
        saveSeenProducts(seen);
        console.log(`\n✅ Successfully alerted ${newProducts.length} new Men's products!`);
        
    } else {
        // Mark all products as seen
        allProducts.forEach(p => {
            if (!seen[p.id]) seen[p.id] = Date.now();
        });
        saveSeenProducts(seen);
        console.log('😴 No new Men\'s products this round');
    }
    
    console.log('\n✅ Run complete!');
    console.log('========================================\n');
}

runSniper().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
