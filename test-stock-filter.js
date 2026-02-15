/**
 * 🧪 OUT-OF-STOCK FILTER TEST
 * This script tests the stock filtering logic without sending alerts
 */

const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY_URL = process.env.PROXY_URL || null;
const API_URL = 'https://www.sheinindia.in/api/category/sverse-5939-37961';
const CATEGORY_PAGE = 'https://www.sheinindia.in/c/sverse-5939-37961';

const API_PARAMS = {
    fields: 'SITE',
    currentPage: '1',
    pageSize: '100',  // Fetch more products to increase chance of finding out-of-stock items
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

function parseProxyUrl(proxyUrl) {
    if (!proxyUrl) return null;
    try {
        const url = new URL(proxyUrl);
        return {
            host: url.hostname,
            port: url.port,
            username: url.username,
            password: url.password
        };
    } catch (e) {
        return null;
    }
}

async function getFreshCookies() {
    console.log('🍪 Getting cookies...');
    const proxyInfo = parseProxyUrl(PROXY_URL);
    
    let browser;
    try {
        const launchOptions = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        };
        
        if (proxyInfo) {
            launchOptions.args.push(`--proxy-server=${proxyInfo.host}:${proxyInfo.port}`);
        }
        
        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        
        if (proxyInfo && proxyInfo.username) {
            await page.authenticate({
                username: proxyInfo.username,
                password: proxyInfo.password
            });
        }
        
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36');
        await page.goto(CATEGORY_PAGE, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        const cookies = await page.cookies();
        await browser.close();
        
        return cookies.map(c => `${c.name}=${c.value}`).join('; ');
    } catch (error) {
        console.error('❌ Cookie error:', error.message);
        if (browser) await browser.close();
        return null;
    }
}

function checkStockStatus(product) {
    const checks = [];
    
    // Check 1: stock.stockLevelStatus
    if (product.stock && product.stock.stockLevelStatus) {
        checks.push({
            field: 'stock.stockLevelStatus',
            value: product.stock.stockLevelStatus,
            inStock: ['instock', 'in_stock'].includes(product.stock.stockLevelStatus.toLowerCase())
        });
    }
    
    // Check 2: stock.stockLevel
    if (product.stock && typeof product.stock.stockLevel === 'number') {
        checks.push({
            field: 'stock.stockLevel',
            value: product.stock.stockLevel,
            inStock: product.stock.stockLevel > 0
        });
    }
    
    // Check 3: stockLevelStatus (top-level)
    if (product.stockLevelStatus) {
        checks.push({
            field: 'stockLevelStatus',
            value: product.stockLevelStatus,
            inStock: ['instock', 'in_stock'].includes(product.stockLevelStatus.toLowerCase())
        });
    }
    
    // Check 4: availability
    if (product.availability) {
        checks.push({
            field: 'availability',
            value: product.availability,
            inStock: ['available', 'instock'].includes(product.availability.toLowerCase())
        });
    }
    
    return checks;
}

async function testStockFiltering(cookies) {
    console.log('\n🔍 Fetching products from API...');
    
    try {
        const url = new URL(API_URL);
        Object.keys(API_PARAMS).forEach(key => {
            url.searchParams.append(key, API_PARAMS[key]);
        });
        
        const fetchOptions = {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Mobile Safari/537.36',
                'Cookie': cookies
            }
        };
        
        if (PROXY_URL) {
            fetchOptions.agent = new HttpsProxyAgent(PROXY_URL);
        }
        
        const response = await fetch(url.toString(), fetchOptions);
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.products || !Array.isArray(data.products)) {
            console.log('❌ No products in response');
            return;
        }
        
        console.log(`✅ Fetched ${data.products.length} products\n`);
        console.log('📊 ANALYZING STOCK DATA...\n');
        console.log('='.repeat(80));
        
        let productsWithStockInfo = 0;
        let productsWithoutStockInfo = 0;
        let outOfStockProducts = 0;
        let inStockProducts = 0;
        
        const stockFieldsFound = new Set();
        
        // Analyze first 20 products in detail
        data.products.slice(0, 20).forEach((product, index) => {
            const stockChecks = checkStockStatus(product);
            
            console.log(`\n${index + 1}. ${product.name ? product.name.substring(0, 60) : 'Unknown'}...`);
            console.log(`   Code: ${product.code}`);
            console.log(`   Price: ${product.offerPrice?.displayformattedValue || product.price?.displayformattedValue || 'N/A'}`);
            
            if (stockChecks.length > 0) {
                productsWithStockInfo++;
                console.log(`   📦 Stock Info Found:`);
                stockChecks.forEach(check => {
                    stockFieldsFound.add(check.field);
                    const status = check.inStock ? '✅ IN STOCK' : '❌ OUT OF STOCK';
                    console.log(`      ${check.field}: ${check.value} → ${status}`);
                    
                    if (!check.inStock) outOfStockProducts++;
                    else inStockProducts++;
                });
            } else {
                productsWithoutStockInfo++;
                console.log(`   ⚠️  No stock information found (assuming in stock)`);
            }
        });
        
        console.log('\n' + '='.repeat(80));
        console.log('\n📈 SUMMARY STATISTICS:\n');
        console.log(`Total products analyzed: ${Math.min(20, data.products.length)}`);
        console.log(`Products WITH stock info: ${productsWithStockInfo}`);
        console.log(`Products WITHOUT stock info: ${productsWithoutStockInfo}`);
        console.log(`In stock products: ${inStockProducts}`);
        console.log(`Out of stock products: ${outOfStockProducts}`);
        
        console.log(`\n🔑 Stock fields found in API:`);
        if (stockFieldsFound.size > 0) {
            stockFieldsFound.forEach(field => console.log(`   - ${field}`));
        } else {
            console.log(`   ⚠️  NO STOCK FIELDS FOUND`);
            console.log(`   📝 This means Shein API does not return stock status`);
            console.log(`   💡 Out-of-stock filtering may not work as expected`);
        }
        
        console.log('\n' + '='.repeat(80));
        
        // Sample raw product data
        console.log('\n📄 SAMPLE RAW PRODUCT DATA (first product):\n');
        const sampleProduct = data.products[0];
        const relevantFields = {
            code: sampleProduct.code,
            name: sampleProduct.name,
            price: sampleProduct.price,
            offerPrice: sampleProduct.offerPrice,
            stock: sampleProduct.stock,
            stockLevelStatus: sampleProduct.stockLevelStatus,
            availability: sampleProduct.availability,
            soldOut: sampleProduct.soldOut,
            inStock: sampleProduct.inStock
        };
        console.log(JSON.stringify(relevantFields, null, 2));
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

async function runTest() {
    console.log('\n🧪 ========================================');
    console.log('   OUT-OF-STOCK FILTER TEST');
    console.log('   ========================================\n');
    
    if (!PROXY_URL) {
        console.log('❌ ERROR: PROXY_URL not set!');
        console.log('💡 Export PROXY_URL environment variable');
        console.log('   Example: export PROXY_URL="http://user:pass@host:port"\n');
        return;
    }
    
    console.log(`🔒 Using proxy: ${PROXY_URL.replace(/\/\/.*:.*@/, '//***:***@')}\n`);
    
    const cookies = await getFreshCookies();
    
    if (!cookies) {
        console.log('❌ Failed to get cookies');
        return;
    }
    
    console.log('✅ Got cookies\n');
    
    await testStockFiltering(cookies);
    
    console.log('\n✅ Test complete!');
    console.log('========================================\n');
}

runTest().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
