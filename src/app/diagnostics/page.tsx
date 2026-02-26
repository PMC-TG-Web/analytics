'use client';

import { useState } from 'react';

export default function DiagnosticsPage() {
  const [results, setResults] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);

  const runTests = async () => {
    setIsLoading(true);
    const testResults: any = {};

    // Test 1: Health check
    try {
      console.log('Testing /api/health...');
      const start = Date.now();
      const response = await fetch('/api/health');
      const duration = Date.now() - start;
      testResults.health = {
        status: response.status,
        statusText: response.statusText,
        duration,
        success: response.ok,
        data: await response.json()
      };
      console.log('✓ Health check passed', testResults.health);
    } catch (error) {
      testResults.health = {
        error: (error as Error).message,
        success: false
      };
      console.error('✗ Health check failed', error);
    }

    // Test 2: GET /api/kpi
    try {
      console.log('Testing GET /api/kpi...');
      const start = Date.now();
      const response = await fetch('/api/kpi?year=2026');
      const duration = Date.now() - start;
      testResults.kpiGet = {
        status: response.status,
        statusText: response.statusText,
        duration,
        success: response.ok,
        data: await response.json()
      };
      console.log('✓ GET /api/kpi passed', testResults.kpiGet);
    } catch (error) {
      testResults.kpiGet = {
        error: (error as Error).message,
        success: false
      };
      console.error('✗ GET /api/kpi failed', error);
    }

    // Test 3: POST /api/kpi
    try {
      console.log('Testing POST /api/kpi...');
      const start = Date.now();
      const response = await fetch('/api/kpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: '2026',
          month: 12,
          monthName: 'December',
          bidSubmittedSales: 999999
        })
      });
      const duration = Date.now() - start;
      testResults.kpiPost = {
        status: response.status,
        statusText: response.statusText,
        duration,
        success: response.ok,
        data: await response.json()
      };
      console.log('✓ POST /api/kpi passed', testResults.kpiPost);
    } catch (error) {
      testResults.kpiPost = {
        error: (error as Error).message,
        success: false
      };
      console.error('✗ POST /api/kpi failed', error);
    }

    setResults(testResults);
    setIsLoading(false);
  };

  const testSaveKpi = async () => {
    setIsLoading(true);
    try {
      const year = '2026';
      const month = 1;
      const fieldName = 'bidSubmittedSales';
      const value = 7777777;

      console.log(`[TEST] Saving ${fieldName} for ${year}-${month}: ${value}`);

      const requestBody = {
        year,
        month,
        monthName: 'January',
        [fieldName]: value
      };

      console.log('[TEST] Request body:', requestBody);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log('[TEST] Request timeout - aborting');
        controller.abort();
      }, 10000);

      const response = await fetch('/api/kpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log(`[TEST] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('[TEST] ✓ Save successful:', result);
      alert(`✓ Save successful! Response: ${JSON.stringify(result)}`);
    } catch (error) {
      console.error('[TEST] Error:', error);
      alert(`✗ Save failed: ${(error as Error).message}`);
    }
    setIsLoading(false);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace', maxWidth: '900px' }}>
      <h1>API Diagnostics</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={runTests} 
          disabled={isLoading}
          style={{ padding: '10px 20px', marginRight: '10px', cursor: 'pointer' }}
        >
          {isLoading ? 'Running Tests...' : 'Run All Tests'}
        </button>
        <button 
          onClick={testSaveKpi} 
          disabled={isLoading}
          style={{ padding: '10px 20px', cursor: 'pointer', background: '#4CAF50', color: 'white' }}
        >
          {isLoading ? 'Testing Save...' : 'Test Save KPI'}
        </button>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h2>Browser Info</h2>
        <pre>{JSON.stringify({
          userAgent: navigator.userAgent,
          online: navigator.onLine,
          language: navigator.language,
          currentUrl: typeof window !== 'undefined' ? window.location.href : 'N/A'
        }, null, 2)}</pre>
      </div>

      {Object.keys(results).length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h2>Test Results</h2>
          <pre style={{ 
            background: '#f5f5f5', 
            padding: '10px', 
            borderLeft: '4px solid #4CAF50',
            overflowX: 'auto'
          }}>
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '20px', padding: '10px', background: '#e8f4f8', borderLeft: '4px solid #2196F3' }}>
        <h3>How to use:</h3>
        <ol>
          <li>Click "Run All Tests" to test connectivity to all API endpoints</li>
          <li>Click "Test Save KPI" to simulate saving a KPI field (like from the KPI page)</li>
          <li>Check browser console (F12) for detailed logged messages</li>
          <li>Look for [TEST] prefix in console logs for this diagnostic tool</li>
          <li>Look for [KPI] prefix in console logs from the actual KPI page</li>
        </ol>
      </div>
    </div>
  );
}
