// Hanafi Halal Stock Screener - App Logic
// Using Twelve Data API (800 free requests/day - enough for 100+ stocks)

const TWELVE_DATA_BASE = 'https://api.twelvedata.com';

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
    const savedKey = localStorage.getItem('twelvedata_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
        keySavedMsg.classList.remove('hidden');
    }
});

// Save API key to localStorage
saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('twelvedata_api_key', key);
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
        showError('Please enter your Twelve Data API key. Get one free at twelvedata.com (800 requests/day)');
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
        const data = await fetchTwelveData(ticker, apiKey);
        displayResults(ticker, data);
    } catch (error) {
        showError(error.message);
    } finally {
        loadingDiv.classList.add('hidden');
        analyzeBtn.disabled = false;
    }
}

async function fetchTwelveData(ticker, apiKey) {
    console.log('Fetching from Twelve Data...');
    
    try {
        // Fetch quote (price) and balance sheet in parallel
        const [quoteResponse, balanceSheetResponse, statisticsResponse] = await Promise.all([
            fetch(`${TWELVE_DATA_BASE}/quote?symbol=${ticker}&apikey=${apiKey}`),
            fetch(`${TWELVE_DATA_BASE}/balance_sheet?symbol=${ticker}&apikey=${apiKey}`),
            fetch(`${TWELVE_DATA_BASE}/statistics?symbol=${ticker}&apikey=${apiKey}`)
        ]);
        
        const quoteData = await quoteResponse.json();
        const balanceSheetData = await balanceSheetResponse.json();
        const statisticsData = await statisticsResponse.json();
        
        console.log('Quote data:', quoteData);
        console.log('Balance sheet data:', balanceSheetData);
        console.log('Statistics data:', statisticsData);
        
        // Check for errors
        if (quoteData.code === 400 || quoteData.status === 'error') {
            throw new Error(quoteData.message || `Ticker "${ticker}" not found.`);
        }
        if (balanceSheetData.code === 400 || balanceSheetData.status === 'error') {
            throw new Error(balanceSheetData.message || 'Balance sheet not available.');
        }
        
        // Get the most recent balance sheet
        const latestBS = balanceSheetData.balance_sheet?.[0] || {};
        
        return {
            quote: quoteData,
            balanceSheet: latestBS,
            statistics: statisticsData.statistics || {}
        };
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

function displayResults(ticker, data) {
    const quote = data.quote;
    const bs = data.balanceSheet;
    const stats = data.statistics;
    
    // Extract values from Twelve Data format
    const totalAssets = parseFloat(bs.assets?.total_assets) || 0;
    const cash = parseFloat(bs.assets?.current_assets?.cash_and_cash_equivalents) || 0;
    const shortTermInvestments = parseFloat(bs.assets?.current_assets?.short_term_investments) || 0;
    const receivables = parseFloat(bs.assets?.current_assets?.accounts_receivable) || 0;
    const totalLiabilities = parseFloat(bs.liabilities?.total_liabilities) || 0;
    const shortTermDebt = parseFloat(bs.liabilities?.current_liabilities?.short_term_debt) || 0;
    const longTermDebt = parseFloat(bs.liabilities?.non_current_liabilities?.long_term_debt) || 0;
    const totalDebt = shortTermDebt + longTermDebt;
    
    const currentPrice = parseFloat(quote.close) || parseFloat(quote.price) || 0;
    const sharesOutstanding = parseFloat(stats.shares_outstanding) || parseFloat(stats.statistics?.shares_outstanding) || 1;
    const companyName = quote.name || ticker;
    
    // Include short-term investments in liquid assets
    const liquidCash = cash + shortTermInvestments;
    
    console.log('Extracted values:', {
        totalAssets, cash: liquidCash, receivables, totalLiabilities, totalDebt, 
        currentPrice, sharesOutstanding, companyName
    });
    
    // Calculate liquid and illiquid assets
    const liquidAssets = liquidCash + receivables;
    const illiquidAssets = totalAssets - liquidAssets;
    
    // Yahoo Finance link for verification
    const yahooLink = `https://finance.yahoo.com/quote/${ticker}/balance-sheet/`;
    
    // --- CHECK 1: Illiquid Asset Ratio (>= 20%) ---
    const illiquidRatio = totalAssets > 0 ? (illiquidAssets / totalAssets) : 0;
    const check1Pass = illiquidRatio >= 0.20;
    
    document.getElementById('check1Status').textContent = check1Pass ? 'PASS' : 'FAIL';
    document.getElementById('check1Status').className = `check-status ${check1Pass ? 'pass' : 'fail'}`;
    document.getElementById('check1Formula').innerHTML = `
        Illiquid Assets = Total Assets - (Cash + Short-term Investments + Receivables)<br>
        Illiquid Assets = ${formatCurrency(totalAssets)} - (${formatCurrency(liquidCash)} + ${formatCurrency(receivables)})<br>
        Illiquid Assets = ${formatCurrency(illiquidAssets)}<br><br>
        Ratio = ${formatCurrency(illiquidAssets)} / ${formatCurrency(totalAssets)} = <strong>${(illiquidRatio * 100).toFixed(2)}%</strong>
    `;
    document.getElementById('check1Link').href = yahooLink;
    
    // --- CHECK 2: Net Liquid Assets vs Price ---
    const netLiquidAssets = liquidAssets - totalLiabilities;
    const netLiquidPerShare = sharesOutstanding > 0 ? (netLiquidAssets / sharesOutstanding) : 0;
    // If net liquid is negative, it automatically passes (you're paying for the business, not just cash)
    const check2Pass = netLiquidPerShare < 0 || currentPrice > netLiquidPerShare;
    
    document.getElementById('check2Status').textContent = check2Pass ? 'PASS' : 'FAIL';
    document.getElementById('check2Status').className = `check-status ${check2Pass ? 'pass' : 'fail'}`;
    document.getElementById('check2Formula').innerHTML = `
        Net Liquid Assets = (Cash + Receivables) - Total Liabilities<br>
        Net Liquid Assets = (${formatCurrency(liquidCash)} + ${formatCurrency(receivables)}) - ${formatCurrency(totalLiabilities)}<br>
        Net Liquid Assets = ${formatCurrency(netLiquidAssets)}<br><br>
        Per Share = ${formatCurrency(netLiquidAssets)} / ${formatNumber(sharesOutstanding)} shares = <strong>$${netLiquidPerShare.toFixed(2)}</strong><br>
        Stock Price = <strong>$${currentPrice.toFixed(2)}</strong><br><br>
        ${netLiquidPerShare < 0 
            ? '✓ Net liquid is negative, so no risk of buying cash surplus.' 
            : `${currentPrice > netLiquidPerShare ? '✓' : '✗'} Price ($${currentPrice.toFixed(2)}) ${currentPrice > netLiquidPerShare ? '>' : '≤'} Net Liquid/Share ($${netLiquidPerShare.toFixed(2)})`
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
        Debt Ratio = (${formatCurrency(shortTermDebt)} + ${formatCurrency(longTermDebt)}) / ${formatCurrency(totalAssets)}<br>
        Debt Ratio = ${formatCurrency(totalDebt)} / ${formatCurrency(totalAssets)} = <strong>${(debtRatio * 100).toFixed(2)}%</strong>
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
    document.getElementById('stockPrice').textContent = `$${currentPrice.toFixed(2)}`;
    
    // Show results
    resultsDiv.classList.remove('hidden');
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
