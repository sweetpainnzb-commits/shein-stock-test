/**
 * 🚀 SHEINVERSE STOCK SNIPER - Only alerts for in-stock items
 * Based on intercepted API data - uses SELLINGFAST, BESTSELLER, WISHLISTCOUNT signals
 */

const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Telegram Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY_URL = process.env.PROXY_URL;

// Files for persistence
const SEEN_FILE = 'seen_products.json';
const COOKIES_FILE = 'cookies.json';
const STATS_FILE = 'stats.json';

// API Endpoints (from your intercepted data)
const API_URL = 'https://www.sheinindia.in/api/category/sverse-5939-37961';
const CART_API = 'https://www.sheinindia.in/api/cart/microcart';
const CATEGORY_PAGE = 'https://www.sheinindia.in/c/sverse-5939-37961';

// API Parameters
const API_PARAMS = {
    fields: 'SITE',
    currentPage: '1',
    pageSize: '100', // Get more products
    format: 'json',
    query: ':relevance',
    gridColumns: '2',
    advfilter: 'true',
    platform: 'Desktop',
    showAdsOnNextPage: 'false',
    is_ads_enable_plp: 'true',
    displayRatings: 'true',
    segmentIds: '',
    store: 'shein'
};

// Stock signals from your intercepted data
const STOCK_SIGNALS = {
    SELLINGFAST: '🔥 LOW STOCK - Selling Fast!',
    BESTSELLER: '⭐ BESTSELLER - Popular Item',
    WISHLISTCOUNT: '📋 High Wishlist Count',
    NEW: '🆕 New Arrival'
};

// Load previously seen products
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

// Save seen products
function saveSeenProducts(seen) {
    try {
        fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
        console.log(`✅ Saved ${Object.keys(seen).length} products`);
    } catch (e) {
        console.log('❌ Error saving:', e.message);
    }
}

// Load stats
function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('⚠️ Error loading stats:', e.message);
    }
    return {
        totalAlerts: 0,
        lowStockAlerts: 0,
        bestsellerAlerts: 0,
        lastRun: null,
        productsSeen: 0
    };
}

// Save stats
function saveStats(stats) {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (e) {
        console.log('⚠️ Error saving stats:', e.message);
    }
}

// Load cached cookies
function loadCookies() {
    try {
        if (fs.existsSync(COOKIES_FILE)) {
            const data = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
            if (Date.now() - data.timestamp < 30 * 60 * 1000) { // 30 minutes
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

// Save cookies
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

// Parse proxy URL
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

// Get fresh cookies using Puppeteer
async function getFreshCookies() {
    console.log('🍪 Getting fresh cookies with Puppeteer...');
    
    const proxyInfo = parseProxyUrl(PROXY_URL);
    
    if (proxyInfo) {
        console.log(`🔒 Using proxy: ${proxyInfo.host}:${proxyInfo.port}`);
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
        
        // Mobile user agent
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; sdk_gphone64_x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36');
        await page.setViewport({ width: 412, height: 915, isMobile: true });
        
        console.log('📄 Loading category page...');
        
        await page.goto(CATEGORY_PAGE, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        console.log('⏳ Waiting for Akamai cookies...');
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
        console.log(`🔑 Key cookies: ${foundCookies.join(', ')}`);
        
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

// Check if product is in stock using signals from intercepted data
function isProductInStock(product) {
    if (!product) return false;
    
    // Default status
    product.stockStatus = '✅ In Stock';
    product.stockPriority = 3; // Lower number = higher priority
    
    // Check tags for stock signals
    if (product.tags?.categoryTags) {
        const tags = product.tags.categoryTags;
        
        // SELLINGFAST = Low stock (HIGHEST PRIORITY)
        const sellingFast = tags.some(t => 
            t.primary?.name === 'SELLINGFAST' || 
            (t.category === 'URGENCY' && t.primary?.name === 'SELLINGFAST')
        );
        
        if (sellingFast) {
            product.stockStatus = STOCK_SIGNALS.SELLINGFAST;
            product.stockPriority = 1;
            return true;
        }
        
        // BESTSELLER = Popular, likely in stock
        const bestseller = tags.some(t => 
            t.primary?.name === 'BESTSELLER'
        );
        
        if (bestseller) {
            product.stockStatus = STOCK_SIGNALS.BESTSELLER;
            product.stockPriority = 2;
            return true;
        }
        
        // NEW tag = New arrival
        const isNew = tags.some(t => 
            t.primary?.name === 'NEW'
        );
        
        if (isNew) {
            product.stockStatus = STOCK_SIGNALS.NEW;
            product.stockPriority = 2;
            return true;
        }
        
        // Check wishlist count (popular items)
        const wishlistTag = tags.find(t => 
            t.category === 'SOCIAL_PROOFING' && t.primary?.name === 'WISHLISTCOUNT'
        );
        
        if (wishlistTag && wishlistTag.primary?.value) {
            try {
                const wishlistData = JSON.parse(wishlistTag.primary.value);
                const count = parseInt(wishlistData.shortText?.replace(/[^0-9]/g, '') || '0');
                if (count > 100) { // More than 100 wishlists = popular
                    product.stockStatus = `📋 ${wishlistData.shortText} wishlists`;
                    product.stockPriority = 2;
                    product.wishlistCount = wishlistData.shortText;
                    return true;
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }
    
    // If product has price and is in API, it's likely in stock
    if (product.price?.value > 0) {
        return true;
    }
    
    return false;
}

// Extract wishlist count
function getWishlistCount(product) {
    if (!product.tags?.categoryTags) return null;
    
    for (const tag of product.tags.categoryTags) {
        if (tag.category === 'SOCIAL_PROOFING' && tag.primary?.name === 'WISHLISTCOUNT' && tag.primary?.value) {
            try {
                const data = JSON.parse(tag.primary.value);
                return data.shortText || null;
            } catch (e) {
                return null;
            }
        }
    }
    return null;
}

// Send Telegram alert with photo
async function sendTelegramAlert(product) {
    // Build caption with stock info
    let caption = `🆕 <b>${product.name}</b>\n`;
    caption += `💰 ${product.price}\n`;
    caption += `${product.stockStatus}\n`;
    
    if (product.wishlistCount) {
        caption += `👥 ${product.wishlistCount} people wishlisted\n`;
    }
    
    if (product.colors) {
        caption += `🎨 ${product.colors} colors\n`;
    }
    
    caption += `\n🔗 <a href="${product.url}">VIEW ON SHEIN</a>`;
    
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
        
        console.log(`   📤 Alert sent: ${product.name.substring(0, 30)}... [${product.stockStatus}]`);
        return true;
    } catch (error) {
        console.error(`   ❌ Telegram failed: ${error.message}`);
        
        // Fallback to text message if photo fails
        try {
            const textCaption = caption.replace(/<[^>]*>/g, ''); // Remove HTML tags
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: textCaption + '\n' + product.url,
                    parse_mode: 'HTML'
                })
            });
            console.log('   📤 Text fallback sent');
            return true;
        } catch (e) {
            return false;
        }
    }
}

// Fetch products from Shein API
async function fetchSheinverseProducts(cookies) {
    console.log('🔍 Calling Shein API...');
    
    try {
        const url = new URL(API_URL);
        Object.keys(API_PARAMS).forEach(key => {
            url.searchParams.append(key, API_PARAMS[key]);
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
        
        console.log(`📡 API response: ${response.status}`);
        
        if (!response.ok) {
            const text = await response.text();
            if (text.includes('<html') || text.includes('<HTML')) {
                console.log('❌ Received HTML - blocked by Akamai');
            }
            throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.products || !Array.isArray(data.products)) {
            console.log('⚠️ Unexpected response structure');
            return [];
        }
        
        console.log(`✅ Got ${data.products.length} products`);
        
        // Process products with stock info
        const products = data.products.map(p => {
            const wishlistCount = getWishlistCount(p);
            const colorGroup = p.fnlColorVariantData?.colorGroup;
            
            return {
                id: p.code,
                name: (p.name || '').replace(/Shein\s*/i, '').trim(),
                price: p.offerPrice?.displayformattedValue || p.price?.displayformattedValue || 'N/A',
                originalPrice: p.wasPriceData?.displayformattedValue,
                url: 'https://www.sheinindia.in' + p.url,
                imageUrl: p.images?.[0]?.url || '',
                colors: colorGroup ? colorGroup.split('_')[1] || 'multiple' : 'multiple',
                wishlistCount: wishlistCount,
                raw: p,
                inStock: isProductInStock(p),
                stockStatus: p.stockStatus || '✅ In Stock',
                stockPriority: p.stockPriority || 3
            };
        });
        
        return products;
        
    } catch (error) {
        console.error('❌ API fetch failed:', error.message);
        return [];
    }
}

// Main function
async function runSniper() {
    console.log('\n🚀 ========================================');
    console.log('   SHEINVERSE STOCK SNIPER v2.0');
    console.log('   ========================================\n');
    console.log(`📅 ${new Date().toLocaleString()}\n`);
    
    // Check configuration
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log('❌ ERROR: Telegram credentials not set!');
        console.log('💡 Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID\n');
        return;
    }
    
    if (!PROXY_URL) {
        console.log('⚠️ WARNING: PROXY_URL not set!');
        console.log('💡 API will likely be blocked without proxy\n');
    }
    
    const proxyInfo = parseProxyUrl(PROXY_URL);
    if (proxyInfo) {
        console.log(`🔒 Proxy: ${proxyInfo.host}:${proxyInfo.port}\n`);
    }
    
    // Load stats
    const stats = loadStats();
    stats.lastRun = new Date().toISOString();
    
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
    let allProducts = await fetchSheinverseProducts(cookies);
    
    // Retry if failed
    if (allProducts.length === 0) {
        console.log('🔄 First attempt failed, refreshing cookies...\n');
        cookies = await getFreshCookies();
        if (cookies) {
            allProducts = await fetchSheinverseProducts(cookies);
        }
    }
    
    if (allProducts.length === 0) {
        console.log('❌ No products found after retry');
        return;
    }
    
    // Filter in-stock products
    const inStockProducts = allProducts.filter(p => p.inStock);
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Total products: ${allProducts.length}`);
    console.log(`   In-stock: ${inStockProducts.length}`);
    
    // Count by type
    const lowStock = inStockProducts.filter(p => p.stockStatus.includes('LOW STOCK')).length;
    const bestsellers = inStockProducts.filter(p => p.stockStatus.includes('BESTSELLER')).length;
    const newArrivals = inStockProducts.filter(p => p.stockStatus.includes('New Arrival')).length;
    const withWishlist = inStockProducts.filter(p => p.wishlistCount).length;
    
    console.log(`   🔥 Low stock: ${lowStock}`);
    console.log(`   ⭐ Bestsellers: ${bestsellers}`);
    console.log(`   🆕 New arrivals: ${newArrivals}`);
    console.log(`   👥 With wishlists: ${withWishlist}`);
    
    // Load seen products
    const seen = loadSeenProducts();
    console.log(`\n📂 Previously seen: ${Object.keys(seen).length}`);
    
    // Find new in-stock products
    const newProducts = inStockProducts.filter(p => p.id && !seen[p.id]);
    console.log(`🆕 NEW in-stock: ${newProducts.length}\n`);
    
    if (newProducts.length > 0) {
        // Sort by priority (low stock first)
        newProducts.sort((a, b) => a.stockPriority - b.stockPriority);
        
        console.log('📢 Sending alerts...\n');
        
        let alertSuccess = 0;
        
        for (let i = 0; i < newProducts.length; i++) {
            const product = newProducts[i];
            console.log(`${i + 1}. ${product.name.substring(0, 40)}... - ${product.price}`);
            console.log(`   Status: ${product.stockStatus}`);
            
            const sent = await sendTelegramAlert(product);
            if (sent) {
                alertSuccess++;
                seen[product.id] = Date.now();
                
                // Update stats
                stats.totalAlerts++;
                if (product.stockStatus.includes('LOW STOCK')) stats.lowStockAlerts++;
                if (product.stockStatus.includes('BESTSELLER')) stats.bestsellerAlerts++;
            }
            
            await new Promise(r => setTimeout(r, 1500)); // Delay between messages
        }
        
        stats.productsSeen = Object.keys(seen).length;
        saveSeenProducts(seen);
        saveStats(stats);
        
        console.log(`\n✅ Successfully alerted ${alertSuccess}/${newProducts.length} products!`);
        
    } else {
        // Still update seen for all products
        allProducts.forEach(p => {
            if (!seen[p.id]) seen[p.id] = Date.now();
        });
        stats.productsSeen = Object.keys(seen).length;
        saveSeenProducts(seen);
        saveStats(stats);
        console.log('😴 No new in-stock products this round');
    }
    
    console.log('\n✅ Run complete!');
    console.log('========================================\n');
}

// Handle errors
process.on('unhandledRejection', (error) => {
    console.error('💥 Unhandled rejection:', error);
});

// Run
runSniper().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
