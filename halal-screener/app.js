// Hanafi Halal Stock Screener - App Logic
// Using Alpha Vantage API - Free tier with balance sheet access
// Get your free API key at: https://www.alphavantage.co/support/#api-key

const AV_BASE = 'https://www.alphavantage.co/query';

// Alpha Vantage Rate Limits (Free tier)
const REQUESTS_PER_MINUTE = 5;
const REQUESTS_PER_DAY = 25;
const REQUESTS_PER_ANALYSIS = 3; // We make 3 API calls per stock analysis
const COOLDOWN_SECONDS = 15; // Wait time between analyses to avoid rate limit

// Rate limiting state
let lastAnalysisTime = 0;
let cooldownInterval = null;
let dailyRequestCount = parseInt(localStorage.getItem('av_daily_requests') || '0');
let dailyRequestDate = localStorage.getItem('av_daily_date') || '';

// DOM Elements
const apiKeyInput = document.getElementById('apiKey');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const keySavedMsg = document.getElementById('keySavedMsg');
const tickerInput = document.getElementById('ticker');
const analyzeBtn = document.getElementById('analyzeBtn');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const resultsDiv = document.getElementById('results');
const cooldownTimer = document.getElementById('cooldownTimer');
const requestCounter = document.getElementById('requestCounter');

// Check if it's a new day and reset counter
function checkDailyReset() {
    const today = new Date().toDateString();
    if (dailyRequestDate !== today) {
        dailyRequestCount = 0;
        dailyRequestDate = today;
        localStorage.setItem('av_daily_requests', '0');
        localStorage.setItem('av_daily_date', today);
    }
}

// Update the request counter display
function updateRequestCounter() {
    checkDailyReset();
    const analysesRemaining = Math.floor((REQUESTS_PER_DAY - dailyRequestCount) / REQUESTS_PER_ANALYSIS);
    if (requestCounter) {
        requestCounter.textContent = `${analysesRemaining} analyses remaining today (${dailyRequestCount}/${REQUESTS_PER_DAY} API calls used)`;
        requestCounter.className = analysesRemaining <= 2 ? 'request-counter warning' : 'request-counter';
    }
}

// Increment request count
function incrementRequestCount(count = 1) {
    dailyRequestCount += count;
    localStorage.setItem('av_daily_requests', dailyRequestCount.toString());
    updateRequestCounter();
}

// Start cooldown timer
function startCooldown() {
    lastAnalysisTime = Date.now();
    let remaining = COOLDOWN_SECONDS;
    
    if (cooldownTimer) {
        cooldownTimer.classList.remove('hidden');
        cooldownTimer.textContent = `⏳ Cooldown: ${remaining}s (rate limit protection)`;
    }
    analyzeBtn.disabled = true;
    
    cooldownInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(cooldownInterval);
            cooldownInterval = null;
            if (cooldownTimer) {
                cooldownTimer.classList.add('hidden');
            }
            analyzeBtn.disabled = false;
        } else {
            if (cooldownTimer) {
                cooldownTimer.textContent = `⏳ Cooldown: ${remaining}s (rate limit protection)`;
            }
        }
    }, 1000);
}

// Check if we can make a request
function canMakeRequest() {
    checkDailyReset();
    
    // Check daily limit
    if (dailyRequestCount + REQUESTS_PER_ANALYSIS > REQUESTS_PER_DAY) {
        return { allowed: false, reason: `Daily limit reached (${REQUESTS_PER_DAY} requests). Try again tomorrow or upgrade your API plan.` };
    }
    
    // Check cooldown
    const timeSinceLastAnalysis = Date.now() - lastAnalysisTime;
    const cooldownRemaining = Math.ceil((COOLDOWN_SECONDS * 1000 - timeSinceLastAnalysis) / 1000);
    if (cooldownRemaining > 0) {
        return { allowed: false, reason: `Please wait ${cooldownRemaining} seconds before next analysis.` };
    }
    
    return { allowed: true };
}

// Load saved API key on page load
document.addEventListener('DOMContentLoaded', () => {
    const savedKey = localStorage.getItem('alphavantage_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
        keySavedMsg.classList.remove('hidden');
    }
    updateRequestCounter();
});

// Save API key to localStorage
saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('alphavantage_api_key', key);
        keySavedMsg.classList.remove('hidden');
    }
});

// Analyze button click
analyzeBtn.addEventListener('click', analyzeStock);

// Allow Enter key to trigger analysis
tickerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        analyzeStock();
    }
});

async function analyzeStock() {
    const apiKey = apiKeyInput.value.trim();
    const ticker = tickerInput.value.trim().toUpperCase();

    if (!apiKey) {
        showError('Please enter your Alpha Vantage API key. Get one free at alphavantage.co');
        return;
    }
    
    if (!ticker) {
        showError('Please enter a stock ticker (e.g., AAPL, MSFT, GOOGL)');
        return;
    }
    
    // Check rate limits
    const rateCheck = canMakeRequest();
    if (!rateCheck.allowed) {
        showError(rateCheck.reason);
        return;
    }

    // Show loading state
    loadingDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    resultsDiv.classList.add('hidden');
    analyzeBtn.disabled = true;

    try {
        const data = await fetchAlphaVantageData(ticker, apiKey);
        displayResults(ticker, data);
        // Start cooldown after successful analysis
        startCooldown();
    } catch (error) {
        showError(error.message);
        // Still start cooldown to prevent hammering API on errors
        if (!error.message.includes('not found')) {
            startCooldown();
        } else {
            analyzeBtn.disabled = false;
        }
    } finally {
        loadingDiv.classList.add('hidden');
    }
}

async function fetchAlphaVantageData(ticker, apiKey) {
    console.log('Fetching from Alpha Vantage...');
    
    // Helper function to wait between requests (Alpha Vantage requires 1 request per second on free tier)
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    // Update loading message helper
    const updateLoadingMessage = (message) => {
        const loadingP = loadingDiv.querySelector('p');
        if (loadingP) loadingP.textContent = message;
    };
    
    try {
        // Fetch balance sheet, overview (for shares outstanding & price), and quote
        // Note: Free tier requires spacing out requests (1 per second)
        
        // First get the company overview (includes shares outstanding)
        updateLoadingMessage('⏳ Fetching company overview (1/3)...');
        const overviewResponse = await fetch(
            `${AV_BASE}?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`
        );
        const overviewData = await overviewResponse.json();
        console.log('Overview data:', overviewData);
        incrementRequestCount(1);
        
        // Check for API errors or rate limits
        if (overviewData.Note || overviewData.Information) {
            throw new Error('API rate limit reached. Please wait a minute and try again. (Free tier: 1 request/second, 25/day)');
        }
        if (overviewData['Error Message']) {
            throw new Error(overviewData['Error Message']);
        }
        if (!overviewData.Symbol) {
            throw new Error(`Ticker "${ticker}" not found or no data available.`);
        }
        
        // Wait 1.5 seconds before next request to respect rate limit
        updateLoadingMessage('⏳ Waiting for API rate limit (1.5s)...');
        await delay(1500);
        
        // Get balance sheet data
        updateLoadingMessage('⏳ Fetching balance sheet (2/3)...');
        const balanceSheetResponse = await fetch(
            `${AV_BASE}?function=BALANCE_SHEET&symbol=${ticker}&apikey=${apiKey}`
        );
        const balanceSheetData = await balanceSheetResponse.json();
        console.log('Balance sheet data:', balanceSheetData);
        incrementRequestCount(1);
        
        // Check for rate limit message
        if (balanceSheetData.Note || balanceSheetData.Information) {
            throw new Error('API rate limit reached. Please wait a minute and try again.');
        }
        if (!balanceSheetData.annualReports || balanceSheetData.annualReports.length === 0) {
            throw new Error(`Balance sheet not available for "${ticker}". This stock may be too new or delisted.`);
        }
        
        // Wait 1.5 seconds before next request
        updateLoadingMessage('⏳ Waiting for API rate limit (1.5s)...');
        await delay(1500);
        
        // Get current stock quote for price
        updateLoadingMessage('⏳ Fetching stock quote (3/3)...');
        const quoteResponse = await fetch(
            `${AV_BASE}?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${apiKey}`
        );
        const quoteData = await quoteResponse.json();
        console.log('Quote data:', quoteData);
        incrementRequestCount(1);
        
        return {
            overview: overviewData,
            balanceSheet: balanceSheetData.annualReports[0], // Most recent annual report
            quarterlyBalanceSheet: balanceSheetData.quarterlyReports?.[0], // Most recent quarterly if available
            quote: quoteData['Global Quote'] || {}
        };
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

function displayResults(ticker, data) {
    const overview = data.overview;
    const bs = data.quarterlyBalanceSheet || data.balanceSheet; // Prefer quarterly for most recent data
    const quote = data.quote;
    
    // Alpha Vantage Balance Sheet field names
    const totalAssets = parseFloat(bs.totalAssets) || 0;
    const cash = parseFloat(bs.cashAndCashEquivalentsAtCarryingValue) || 0;
    const shortTermInvestments = parseFloat(bs.shortTermInvestments) || 0;
    const receivables = parseFloat(bs.currentNetReceivables) || 0;
    const totalLiabilities = parseFloat(bs.totalLiabilities) || 0;
    const shortTermDebt = parseFloat(bs.shortTermDebt) || parseFloat(bs.currentDebt) || 0;
    const longTermDebt = parseFloat(bs.longTermDebt) || parseFloat(bs.longTermDebtNoncurrent) || 0;
    const totalDebt = shortTermDebt + longTermDebt;
    
    // Get price from quote, fallback to overview
    const currentPrice = parseFloat(quote['05. price']) || parseFloat(overview['50DayMovingAverage']) || 0;
    const sharesOutstanding = parseFloat(overview.SharesOutstanding) || 1;
    const companyName = overview.Name || ticker;
    const reportDate = bs.fiscalDateEnding || 'Latest';
    
    console.log('Extracted values:', {
        totalAssets, cash, shortTermInvestments, receivables,
        totalLiabilities, totalDebt, shortTermDebt, longTermDebt,
        currentPrice, sharesOutstanding, companyName
    });
    
    // Calculate derived values
    const liquidCash = cash + shortTermInvestments;
    const liquidAssets = liquidCash + receivables;
    const illiquidAssets = totalAssets - liquidAssets;
    
    // Yahoo Finance link for verification
    const yahooLink = `https://finance.yahoo.com/quote/${ticker}/balance-sheet/`;
    
    // Update the results UI
    document.getElementById('stockName').textContent = `${ticker} - ${companyName}`;
    document.getElementById('stockPrice').textContent = `$${currentPrice.toFixed(2)}`;
    document.getElementById('reportDate').textContent = `Balance Sheet: ${reportDate}`;
    
    resultsDiv.classList.remove('hidden');
    
    // --- CHECK 1: Illiquid Asset Ratio (>= 20%) ---
    const illiquidRatio = totalAssets > 0 ? (illiquidAssets / totalAssets) : 0;
    const check1Pass = illiquidRatio >= 0.20;
    
    document.getElementById('check1Status').textContent = check1Pass ? 'PASS' : 'FAIL';
    document.getElementById('check1Status').className = `check-status ${check1Pass ? 'pass' : 'fail'}`;
    document.getElementById('check1Formula').innerHTML = `
        <div class="field-mapping">
            <span class="field-label">Total Assets</span> <span class="yahoo-field">(Yahoo: "Total Assets")</span>: <strong>${formatCurrency(totalAssets)}</strong><br>
            <span class="field-label">Cash & Equivalents</span> <span class="yahoo-field">(Yahoo: "Cash And Cash Equivalents")</span>: <strong>${formatCurrency(cash)}</strong><br>
            <span class="field-label">Short-term Investments</span> <span class="yahoo-field">(Yahoo: "Other Short Term Investments")</span>: <strong>${formatCurrency(shortTermInvestments)}</strong><br>
            <span class="field-label">Receivables</span> <span class="yahoo-field">(Yahoo: "Receivables")</span>: <strong>${formatCurrency(receivables)}</strong>
        </div>
        <div class="calculation-box">
            Illiquid Assets = Total Assets - (Cash + Short-term Investments + Receivables)<br>
            Illiquid Assets = ${formatCurrency(totalAssets)} - (${formatCurrency(cash)} + ${formatCurrency(shortTermInvestments)} + ${formatCurrency(receivables)})<br>
            Illiquid Assets = ${formatCurrency(illiquidAssets)}<br><br>
            <strong>Ratio = ${(illiquidRatio * 100).toFixed(2)}%</strong> (must be ≥ 20%)
        </div>
    `;
    document.getElementById('check1Link').href = yahooLink;
    
    // --- CHECK 2: Net Liquid Assets vs Price ---
    const netLiquidAssets = liquidAssets - totalLiabilities;
    const netLiquidPerShare = sharesOutstanding > 0 ? (netLiquidAssets / sharesOutstanding) : 0;
    const check2Pass = netLiquidPerShare < 0 || currentPrice > netLiquidPerShare;
    
    document.getElementById('check2Status').textContent = check2Pass ? 'PASS' : 'FAIL';
    document.getElementById('check2Status').className = `check-status ${check2Pass ? 'pass' : 'fail'}`;
    document.getElementById('check2Formula').innerHTML = `
        <div class="field-mapping">
            <span class="field-label">Cash + Investments</span>: <strong>${formatCurrency(liquidCash)}</strong><br>
            <span class="field-label">Receivables</span> <span class="yahoo-field">(Yahoo: "Receivables")</span>: <strong>${formatCurrency(receivables)}</strong><br>
            <span class="field-label">Total Liabilities</span> <span class="yahoo-field">(Yahoo: "Total Liabilities Net Minority Interest")</span>: <strong>${formatCurrency(totalLiabilities)}</strong><br>
            <span class="field-label">Shares Outstanding</span>: <strong>${formatNumber(sharesOutstanding)}</strong>
        </div>
        <div class="calculation-box">
            Net Liquid Assets = (Cash + Investments + Receivables) - Total Liabilities<br>
            Net Liquid Assets = (${formatCurrency(liquidCash)} + ${formatCurrency(receivables)}) - ${formatCurrency(totalLiabilities)}<br>
            Net Liquid Assets = ${formatCurrency(netLiquidAssets)}<br><br>
            Per Share = ${formatCurrency(netLiquidAssets)} ÷ ${formatNumber(sharesOutstanding)} = <strong>$${netLiquidPerShare.toFixed(2)}</strong><br>
            Stock Price = <strong>$${currentPrice.toFixed(2)}</strong><br><br>
            ${netLiquidPerShare < 0 
                ? '✓ Net liquid is negative, so no risk of buying cash surplus.' 
                : `${currentPrice > netLiquidPerShare ? '✓' : '✗'} Price ($${currentPrice.toFixed(2)}) ${currentPrice > netLiquidPerShare ? '>' : '≤'} Net Liquid/Share ($${netLiquidPerShare.toFixed(2)})`
            }
        </div>
    `;
    document.getElementById('check2Link').href = yahooLink;
    
    // --- CHECK 3: Debt to Total Assets (< 33%) ---
    const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets) : 0;
    const check3Pass = debtRatio < 0.33;
    
    document.getElementById('check3Status').textContent = check3Pass ? 'PASS' : 'FAIL';
    document.getElementById('check3Status').className = `check-status ${check3Pass ? 'pass' : 'fail'}`;
    document.getElementById('check3Formula').innerHTML = `
        <div class="field-mapping">
            <span class="field-label">Short-term Debt</span> <span class="yahoo-field">(Yahoo: "Current Debt")</span>: <strong>${formatCurrency(shortTermDebt)}</strong><br>
            <span class="field-label">Long-term Debt</span> <span class="yahoo-field">(Yahoo: "Long Term Debt")</span>: <strong>${formatCurrency(longTermDebt)}</strong><br>
            <span class="field-label">Total Debt</span>: <strong>${formatCurrency(totalDebt)}</strong><br>
            <span class="field-label">Total Assets</span> <span class="yahoo-field">(Yahoo: "Total Assets")</span>: <strong>${formatCurrency(totalAssets)}</strong>
        </div>
        <div class="calculation-box">
            <strong>Debt Ratio = ${(debtRatio * 100).toFixed(2)}%</strong> (must be < 33%, i.e., less than 1/3)
        </div>
    `;
    document.getElementById('check3Link').href = yahooLink;
    
    // --- OVERALL RESULT ---
    const allPass = check1Pass && check2Pass && check3Pass;
    const overallResult = document.getElementById('overallResult');
    overallResult.className = `overall-result ${allPass ? 'overall-pass' : 'overall-fail'}`;
    overallResult.innerHTML = allPass 
        ? '✓ HALAL' 
        : '✗ NOT COMPLIANT';
}

function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
}

function formatCurrency(num) {
    if (num === undefined || num === null || isNaN(num)) {
        return '$0.00';
    }
    
    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    
    if (absNum >= 1e12) {
        return `${sign}$${(absNum / 1e12).toFixed(2)}T`;
    } else if (absNum >= 1e9) {
        return `${sign}$${(absNum / 1e9).toFixed(2)}B`;
    } else if (absNum >= 1e6) {
        return `${sign}$${(absNum / 1e6).toFixed(2)}M`;
    } else if (absNum >= 1e3) {
        return `${sign}$${(absNum / 1e3).toFixed(2)}K`;
    }
    return `${sign}$${absNum.toFixed(2)}`;
}

function formatNumber(num) {
    if (num === undefined || num === null || isNaN(num)) {
        return '0';
    }
    
    if (num >= 1e9) {
        return `${(num / 1e9).toFixed(2)}B`;
    } else if (num >= 1e6) {
        return `${(num / 1e6).toFixed(2)}M`;
    }
    return num.toLocaleString();
}
