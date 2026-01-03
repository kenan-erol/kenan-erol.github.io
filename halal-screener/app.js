// Hanafi Halal Stock Screener - App Logic

// Constants - Using Alpha Vantage (free tier: 25 requests/day, 5 per minute)
const AV_BASE_URL = 'https://www.alphavantage.co/query';

// Helper function for delays
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// DOM Elements
const apiKeyInput = document.getElementById('apiKey');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const keySavedMsg = document.getElementById('keySavedMsg');
const tickerInput = document.getElementById('ticker');
const analyzeBtn = document.getElementById('analyzeBtn');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const resultsDiv = document.getElementById('results');

// Load saved API key on page load
document.addEventListener('DOMContentLoaded', () => {
    const savedKey = localStorage.getItem('fmp_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
        keySavedMsg.classList.remove('hidden');
    }
});

// Save API key to localStorage
saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('fmp_api_key', key);
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

    // Validate inputs
    if (!apiKey) {
        showError('Please enter your Alpha Vantage API key. Get one free at alphavantage.co/support/#api-key');
        return;
    }
    if (!ticker) {
        showError('Please enter a stock ticker (e.g., AAPL, MSFT, TSM)');
        return;
    }

    // Show loading state
    loadingDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    resultsDiv.classList.add('hidden');
    analyzeBtn.disabled = true;

    try {
        // Fetch data sequentially to avoid rate limits (Alpha Vantage limits 5 calls/minute on free tier)
        const balanceSheet = await fetchBalanceSheet(ticker, apiKey);
        
        // Small delay to avoid rate limit
        await delay(1000);
        const quote = await fetchQuote(ticker, apiKey);
        
        await delay(1000);
        const overview = await fetchOverview(ticker, apiKey);

        // Calculate and display results
        displayResults(ticker, balanceSheet, quote, overview);

    } catch (error) {
        showError(error.message);
    } finally {
        loadingDiv.classList.add('hidden');
        analyzeBtn.disabled = false;
    }
}

async function fetchBalanceSheet(ticker, apiKey) {
    const url = `${AV_BASE_URL}?function=BALANCE_SHEET&symbol=${ticker}&apikey=${apiKey}`;
    console.log('Fetching balance sheet from Alpha Vantage...');
    
    try {
        const response = await fetch(url);
        console.log('Balance sheet response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch balance sheet (${response.status}).`);
        }
        
        const data = await response.json();
        console.log('Balance sheet data:', data);
        
        // Check for API error messages
        if (data['Error Message']) {
            throw new Error('Invalid ticker symbol.');
        }
        
        if (data['Note']) {
            throw new Error('API rate limit reached. Free tier allows 25 requests/day. Try again tomorrow or get a premium key.');
        }
        
        if (data['Information']) {
            throw new Error(data['Information']);
        }
        
        if (!data.quarterlyReports || data.quarterlyReports.length === 0) {
            throw new Error(`No balance sheet data for "${ticker}".`);
        }
        
        // Return the most recent quarterly report
        return data.quarterlyReports[0];
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

async function fetchQuote(ticker, apiKey) {
    const url = `${AV_BASE_URL}?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${apiKey}`;
    console.log('Fetching quote from Alpha Vantage...');
    
    try {
        const response = await fetch(url);
        console.log('Quote response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch quote (${response.status}).`);
        }
        
        const data = await response.json();
        console.log('Quote data:', data);
        
        if (data['Error Message']) {
            throw new Error('Invalid ticker symbol.');
        }
        
        if (data['Note']) {
            throw new Error('API rate limit reached (25/day). Try again tomorrow.');
        }
        
        // Check for rate limit message in Information field
        if (data['Information'] && data['Information'].includes('rate limit')) {
            throw new Error('API rate limit reached. Wait 1 minute and try again (free tier: 5 calls/minute).');
        }
        
        if (!data['Global Quote'] || !data['Global Quote']['05. price']) {
            throw new Error(`No quote data for "${ticker}". Wait 1 minute and try again.`);
        }
        
        return data['Global Quote'];
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

async function fetchOverview(ticker, apiKey) {
    const url = `${AV_BASE_URL}?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`;
    console.log('Fetching company overview from Alpha Vantage...');
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch overview (${response.status}).`);
        }
        
        const data = await response.json();
        console.log('Overview data:', data);
        
        if (data['Note']) {
            throw new Error('API rate limit reached (25/day). Try again tomorrow.');
        }
        
        // Check for rate limit message in Information field
        if (data['Information'] && data['Information'].includes('rate limit')) {
            throw new Error('API rate limit reached. Wait 1 minute and try again (free tier: 5 calls/minute).');
        }
        
        return data;
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

function displayResults(ticker, bs, quote, overview) {
    // Alpha Vantage field names are different - extract values from balance sheet
    // Note: Alpha Vantage returns values as strings
    const totalAssets = parseFloat(bs.totalAssets) || 0;
    const cash = parseFloat(bs.cashAndCashEquivalentsAtCarryingValue) || 0;
    const receivables = parseFloat(bs.currentNetReceivables) || 0;
    const totalLiabilities = parseFloat(bs.totalLiabilities) || 0;
    const shortTermDebt = parseFloat(bs.shortTermDebt) || 0;
    const longTermDebt = parseFloat(bs.longTermDebt) || 0;
    const totalDebt = shortTermDebt + longTermDebt;
    
    // Extract values from quote (Alpha Vantage format)
    const price = parseFloat(quote['05. price']) || 0;
    
    // Extract from overview
    const sharesOutstanding = parseFloat(overview.SharesOutstanding) || 1;
    const companyName = overview.Name || ticker;
    
    // Calculate liquid and illiquid assets
    const liquidAssets = cash + receivables;
    const illiquidAssets = totalAssets - liquidAssets;
    
    // Yahoo Finance link for verification
    const yahooLink = `https://finance.yahoo.com/quote/${ticker}/balance-sheet/`;
    
    // --- CHECK 1: Illiquid Asset Ratio (>= 20%) ---
    const illiquidRatio = totalAssets > 0 ? (illiquidAssets / totalAssets) : 0;
    const check1Pass = illiquidRatio >= 0.20;
    
    document.getElementById('check1Status').textContent = check1Pass ? 'PASS' : 'FAIL';
    document.getElementById('check1Status').className = `check-status ${check1Pass ? 'pass' : 'fail'}`;
    document.getElementById('check1Formula').innerHTML = `
        Illiquid Assets = Total Assets - (Cash + Receivables)<br>
        Illiquid Assets = ${formatCurrency(totalAssets)} - (${formatCurrency(cash)} + ${formatCurrency(receivables)})<br>
        Illiquid Assets = ${formatCurrency(illiquidAssets)}<br><br>
        Ratio = ${formatCurrency(illiquidAssets)} / ${formatCurrency(totalAssets)} = <strong>${(illiquidRatio * 100).toFixed(2)}%</strong>
    `;
    document.getElementById('check1Link').href = yahooLink;
    
    // --- CHECK 2: Net Liquid Assets vs Price ---
    const netLiquidAssets = liquidAssets - totalLiabilities;
    const netLiquidPerShare = netLiquidAssets / sharesOutstanding;
    // If net liquid is negative, it automatically passes (you're paying for the business, not just cash)
    const check2Pass = netLiquidPerShare < 0 || price > netLiquidPerShare;
    
    document.getElementById('check2Status').textContent = check2Pass ? 'PASS' : 'FAIL';
    document.getElementById('check2Status').className = `check-status ${check2Pass ? 'pass' : 'fail'}`;
    document.getElementById('check2Formula').innerHTML = `
        Net Liquid Assets = (Cash + Receivables) - Total Liabilities<br>
        Net Liquid Assets = (${formatCurrency(cash)} + ${formatCurrency(receivables)}) - ${formatCurrency(totalLiabilities)}<br>
        Net Liquid Assets = ${formatCurrency(netLiquidAssets)}<br><br>
        Per Share = ${formatCurrency(netLiquidAssets)} / ${formatNumber(sharesOutstanding)} shares = <strong>$${netLiquidPerShare.toFixed(2)}</strong><br>
        Stock Price = <strong>$${price.toFixed(2)}</strong><br><br>
        ${netLiquidPerShare < 0 
            ? '✓ Net liquid is negative, so no risk of buying cash surplus.' 
            : `${price > netLiquidPerShare ? '✓' : '✗'} Price ($${price.toFixed(2)}) ${price > netLiquidPerShare ? '>' : '≤'} Net Liquid/Share ($${netLiquidPerShare.toFixed(2)})`
        }
    `;
    document.getElementById('check2Link').href = yahooLink;
    
    // --- CHECK 3: Debt to Total Assets (< 37%) ---
    const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets) : 0;
    const check3Pass = debtRatio < 0.37;
    
    document.getElementById('check3Status').textContent = check3Pass ? 'PASS' : 'FAIL';
    document.getElementById('check3Status').className = `check-status ${check3Pass ? 'pass' : 'fail'}`;
    document.getElementById('check3Formula').innerHTML = `
        Debt Ratio = Total Debt / Total Assets<br>
        Debt Ratio = ${formatCurrency(totalDebt)} / ${formatCurrency(totalAssets)}<br>
        Debt Ratio = <strong>${(debtRatio * 100).toFixed(2)}%</strong>
    `;
    document.getElementById('check3Link').href = yahooLink;
    
    // --- OVERALL RESULT ---
    const allPass = check1Pass && check2Pass && check3Pass;
    const overallResult = document.getElementById('overallResult');
    overallResult.className = `overall-result ${allPass ? 'overall-pass' : 'overall-fail'}`;
    overallResult.innerHTML = allPass 
        ? '✓ HALAL (Strict Hanafi Compliant)' 
        : '✗ NOT COMPLIANT';
    
    // Update header
    document.getElementById('stockName').textContent = `${ticker} - ${companyName}`;
    document.getElementById('stockPrice').textContent = `$${price.toFixed(2)}`;
    
    // Show results
    resultsDiv.classList.remove('hidden');
}

function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
}

function formatCurrency(num) {
    if (num >= 1e12) {
        return `$${(num / 1e12).toFixed(2)}T`;
    } else if (num >= 1e9) {
        return `$${(num / 1e9).toFixed(2)}B`;
    } else if (num >= 1e6) {
        return `$${(num / 1e6).toFixed(2)}M`;
    } else if (num >= 1e3) {
        return `$${(num / 1e3).toFixed(2)}K`;
    } else if (num < 0) {
        // Handle negative numbers
        const absNum = Math.abs(num);
        if (absNum >= 1e12) {
            return `-$${(absNum / 1e12).toFixed(2)}T`;
        } else if (absNum >= 1e9) {
            return `-$${(absNum / 1e9).toFixed(2)}B`;
        } else if (absNum >= 1e6) {
            return `-$${(absNum / 1e6).toFixed(2)}M`;
        } else if (absNum >= 1e3) {
            return `-$${(absNum / 1e3).toFixed(2)}K`;
        }
        return `-$${absNum.toFixed(2)}`;
    }
    return `$${num.toFixed(2)}`;
}

function formatNumber(num) {
    if (num >= 1e9) {
        return `${(num / 1e9).toFixed(2)}B`;
    } else if (num >= 1e6) {
        return `${(num / 1e6).toFixed(2)}M`;
    }
    return num.toLocaleString();
}
