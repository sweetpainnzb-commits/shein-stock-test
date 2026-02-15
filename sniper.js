/**
 * 🚀 SHEINVERSE SNIPER - API ONLY (NO SCRAPING)
 * Enhanced: Stock checking via page HTML to avoid API blocks
 */

const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8367734034:AAETSFcPiMTyTvzyP3slc75-ndfGMenXK5U";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-1003320038050";
const PROXY_URL = process.env.PROXY_URL || null; // Format: http://username:password@host:port

const SEEN_FILE = 'seen_products.json';
const COOKIES_FILE = 'cookies.json';

const API_URL = 'https://www.sheinindia.in/api/category/sverse-5939-37961';
const CATEGORY_PAGE = 'https://www.sheinindia.in/c/sverse-5939-37961';

const API_PARAMS = {
    fields: 'SITE',
    currentPage: '1',
    pageSize: '40',
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
        console.log('💡 Set PROXY_URL environment variable');
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
        
        // Add proxy server WITHOUT authentication (Puppeteer handles auth separately)
        if (proxyInfo) {
            launchOptions.args.push(`--proxy-server=${proxyInfo.host}:${proxyInfo.port}`);
        }
        
        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        
        // Authenticate proxy if credentials exist
        if (proxyInfo && proxyInfo.username && proxyInfo.password) {
            await page.authenticate({
                username: proxyInfo.username,
                password: proxyInfo.password
            });
            console.log('✅ Proxy authenticated');
        }
        
        // Mobile user agent like your phone
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; sdk_gphone64_x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36');
        await page.setViewport({ width: 412, height: 915, isMobile: true });
        
        console.log('📄 Loading category page...');
        
        await page.goto(CATEGORY_PAGE, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        console.log('⏳ Waiting for Akamai cookies to generate...');
        await new Promise(resolve => setTimeout(resolve, 15000)); // 15 seconds
        
        // Get ALL cookies
        const cookies = await page.cookies();
        
        await browser.close();
        
        if (cookies.length === 0) {
            console.log('❌ No cookies received');
            return null;
        }
        
        // Convert to cookie string
        const cookieString = cookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
        
        // Show important cookies
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

/**
 * NEW: Check if a product is in stock by visiting the page with Puppeteer
 * This is more reliable than API calls which get blocked
 * Returns: { inStock: boolean, stockInfo: string }
 */
async function checkProductStockWithBrowser(productUrl, browserInstance, pageInstance) {
    try {
        const fullUrl = productUrl.startsWith('http') 
            ? productUrl 
            : `https://www.sheinindia.in${productUrl}`;
        
        // Navigate to product page
        await pageInstance.goto(fullUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        
        // Wait a bit for dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check for various "out of stock" indicators in the HTML
        const stockInfo = await pageInstance.evaluate(() => {
            // Method 1: Check for "Out of Stock" text
            const bodyText = document.body.innerText.toLowerCase();
            if (bodyText.includes('out of stock') || 
                bodyText.includes('sold out') ||
                bodyText.includes('currently unavailable')) {
                return { inStock: false, reason: 'out of stock text found' };
            }
            
            // Method 2: Check if "Add to Bag" button is disabled
            const addToBagButton = document.querySelector('[class*="add-to-bag"]') ||
                                   document.querySelector('[class*="add-to-cart"]') ||
                                   document.querySelector('button[type="submit"]');
            
            if (addToBagButton) {
                const isDisabled = addToBagButton.disabled || 
                                  addToBagButton.hasAttribute('disabled') ||
                                  addToBagButton.classList.contains('disabled');
                if (isDisabled) {
                    return { inStock: false, reason: 'add button disabled' };
                }
            }
            
            // Method 3: Check for stock status in data attributes or meta tags
            const stockElements = document.querySelectorAll('[data-stock], [data-availability]');
            for (const elem of stockElements) {
                const stockValue = elem.getAttribute('data-stock') || 
                                  elem.getAttribute('data-availability') || 
                                  elem.textContent;
                if (stockValue && (stockValue.toLowerCase().includes('out') || 
                                  stockValue.toLowerCase().includes('unavailable'))) {
                    return { inStock: false, reason: 'stock attribute shows out' };
                }
            }
            
            // Method 4: Check JSON-LD structured data
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                try {
                    const data = JSON.parse(script.textContent);
                    if (data.offers) {
                        const availability = data.offers.availability || 
                                           (data.offers[0] && data.offers[0].availability);
                        if (availability && availability.toLowerCase().includes('outofstock')) {
                            return { inStock: false, reason: 'json-ld shows out of stock' };
                        }
                    }
                } catch (e) {
                    // Skip invalid JSON
                }
            }
            
            // If no out-of-stock indicators found, assume in stock
            return { inStock: true, reason: 'no out-of-stock indicators' };
        });
        
        return stockInfo;
        
    } catch (error) {
        console.log(`   ⚠️ Stock check error: ${error.message}`);
        return { inStock: true, reason: 'check failed - default to in-stock' };
    }
}

async function sendTelegramAlert(product) {
    const caption = `🆕 <b>${product.name}</b>\n💰 ${product.price} 🔥 NEW DROP\n🔗 <a href="${product.url}">VIEW NOW</a>`;
    
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

async function fetchSheinverseProducts(cookies) {
    console.log('🔍 Calling Shein API...');
    if (!PROXY_URL) {
        console.log('⚠️ WARNING: No proxy configured - request will likely be blocked');
    }
    
    try {
        const url = new URL(API_URL);
        Object.keys(API_PARAMS).forEach(key => {
            url.searchParams.append(key, API_PARAMS[key]);
        });
        
        // Using EXACT headers from your successful phone request
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
        
        console.log(`📡 API response: ${response.status} ${response.statusText}`);
        
        const contentType = response.headers.get('content-type');
        console.log(`📋 Content-Type: ${contentType}`);
        
        if (!response.ok) {
            const text = await response.text();
            if (text.includes('<html') || text.includes('<HTML')) {
                console.log('❌ Received HTML instead of JSON - likely blocked');
                console.log('💡 Preview:', text.substring(0, 200));
            }
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.products || !Array.isArray(data.products)) {
            console.log('⚠️ Unexpected response structure');
            console.log('Response keys:', Object.keys(data));
            return [];
        }
        
        console.log(`✅ API SUCCESS! Got ${data.products.length} products`);
        if (data.pagination) {
            console.log(`📊 Total in category: ${data.pagination.totalResults}`);
        }
        
        const products = data.products.map(p => ({
            id: p.code,
            name: (p.name || '').replace(/Shein\s*/i, '').trim(),
            price: p.offerPrice?.displayformattedValue || p.price?.displayformattedValue || 'N/A',
            url: 'https://www.sheinindia.in' + p.url,
            imageUrl: p.images?.[0]?.url || ''
        }));
        
        return products;
        
    } catch (error) {
        console.error('❌ API fetch failed:', error.message);
        return [];
    }
}

async function runSniper() {
    console.log('\n🚀 ========================================');
    console.log('   SHEINVERSE SNIPER - WITH STOCK CHECK');
    console.log('   ========================================\n');
    console.log(`📅 ${new Date().toLocaleString()}\n`);
    
    if (!PROXY_URL) {
        console.log('❌ ERROR: PROXY_URL not set!');
        console.log('💡 The API is blocked from GitHub Actions IPs');
        console.log('💡 You MUST configure a proxy for this to work');
        console.log('💡 Add PROXY_URL to GitHub Secrets');
        console.log('');
        console.log('🛑 Stopping - cannot proceed without proxy\n');
        return;
    }
    
    const proxyInfo = parseProxyUrl(PROXY_URL);
    if (proxyInfo) {
        console.log(`🔒 Proxy: ${proxyInfo.username}:***@${proxyInfo.host}:${proxyInfo.port}\n`);
    }
    
    // Get fresh cookies
    let cookies = loadCookies();
    if (!cookies) {
        cookies = await getFreshCookies();
        if (!cookies) {
            console.log('❌ Failed to get cookies');
            return;
        }
    }
    
    // Try API call
    let allProducts = await fetchSheinverseProducts(cookies);
    
    // If failed, refresh cookies and retry once
    if (allProducts.length === 0) {
        console.log('🔄 First attempt failed, refreshing cookies...\n');
        cookies = await getFreshCookies();
        if (cookies) {
            allProducts = await fetchSheinverseProducts(cookies);
        }
    }
    
    if (allProducts.length === 0) {
        console.log('❌ No products found after retry');
        console.log('');
        console.log('💡 Troubleshooting:');
        console.log('1. Check if proxy is working');
        console.log('2. Try a different proxy from your list');
        console.log('3. Proxy might need to be from India region');
        return;
    }
    
    console.log(`\n📦 Successfully fetched ${allProducts.length} products`);
    
    const seen = loadSeenProducts();
    console.log(`📂 Previously seen: ${Object.keys(seen).length}`);
    
    const newProducts = allProducts.filter(p => p.id && !seen[p.id]);
    console.log(`🆕 NEW products found: ${newProducts.length}`);
    
    if (newProducts.length > 0) {
        console.log('\n🔍 Checking stock status for new products...');
        console.log('🌐 Opening browser for stock checks...\n');
        
        // Launch browser once for all stock checks
        let browser;
        let page;
        
        try {
            const launchOptions = {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled'
                ]
            };
            
            if (proxyInfo) {
                launchOptions.args.push(`--proxy-server=${proxyInfo.host}:${proxyInfo.port}`);
            }
            
            browser = await puppeteer.launch(launchOptions);
            page = await browser.newPage();
            
            if (proxyInfo && proxyInfo.username && proxyInfo.password) {
                await page.authenticate({
                    username: proxyInfo.username,
                    password: proxyInfo.password
                });
            }
            
            await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; sdk_gphone64_x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36');
            await page.setViewport({ width: 412, height: 915, isMobile: true });
            
            let inStockCount = 0;
            let outOfStockCount = 0;
            
            for (let i = 0; i < newProducts.length; i++) {
                const product = newProducts[i];
                console.log(`${i + 1}/${newProducts.length}. Checking: ${product.name.substring(0, 40)}...`);
                
                // Check stock status using browser
                const stockResult = await checkProductStockWithBrowser(product.url, browser, page);
                console.log(`   📊 Stock: ${stockResult.reason}`);
                
                if (stockResult.inStock) {
                    inStockCount++;
                    console.log(`   ✅ IN STOCK - Sending alert...`);
                    await sendTelegramAlert(product);
                    seen[product.id] = Date.now();
                } else {
                    outOfStockCount++;
                    console.log(`   ❌ OUT OF STOCK - Skipping alert`);
                    seen[product.id] = Date.now(); // Still mark as seen
                }
                
                // Rate limiting between requests
                await new Promise(r => setTimeout(r, 2000)); // 2 seconds between products
            }
            
            await browser.close();
            
            saveSeenProducts(seen);
            console.log(`\n📊 Summary:`);
            console.log(`   ✅ In stock alerts sent: ${inStockCount}`);
            console.log(`   ❌ Out of stock (skipped): ${outOfStockCount}`);
            console.log(`   📝 Total new products processed: ${newProducts.length}`);
            
        } catch (error) {
            console.error('❌ Browser stock check failed:', error.message);
            if (browser) {
                await browser.close();
            }
            
            // Fallback: send all alerts without stock check
            console.log('\n⚠️ Falling back to sending all alerts without stock check...\n');
            for (const product of newProducts) {
                await sendTelegramAlert(product);
                seen[product.id] = Date.now();
                await new Promise(r => setTimeout(r, 1000));
            }
            saveSeenProducts(seen);
