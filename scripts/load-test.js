// k6 load test for PudimFinance
// Run with: k6 run scripts/load-test.js
// Requires the backend to be running (e.g., via docker compose up -d)

import http from 'k6/http';
import { check, sleep } from 'k6';

// Optional auth: set K6_API_KEY env var if auth is enabled
const API_KEY = __ENV.K6_API_KEY || '';
const BASE = __ENV.BASE_URL || 'http://localhost:3000';

const HEADERS = API_KEY
  ? { 'Content-Type': 'application/json', 'X-API-Key': API_KEY }
  : { 'Content-Type': 'application/json' };

export const options = {
  scenarios: {
    // Smoke test: quick sanity check
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '10s',
      exec: 'smoke',
    },
    // Load test: sustained moderate load
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 }, // ramp up
        { duration: '1m', target: 10 },  // sustain
        { duration: '15s', target: 0 },  // ramp down
      ],
      exec: 'apiTraffic',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

export function smoke() {
  const readChecks = [
    ['GET /health', http.get(`${BASE}/health`, { headers: HEADERS })],
    ['GET /api/categories', http.get(`${BASE}/api/categories`, { headers: HEADERS })],
    ['GET /api/transactions', http.get(`${BASE}/api/transactions`, { headers: HEADERS })],
    ['GET /api/summary', http.get(`${BASE}/api/summary`, { headers: HEADERS })],
    ['GET /api/budgets', http.get(`${BASE}/api/budgets`, { headers: HEADERS })],
    ['GET /api/reports/monthly', http.get(`${BASE}/api/reports/monthly`, { headers: HEADERS })],
    ['GET /api/reports/category-breakdown', http.get(`${BASE}/api/reports/category-breakdown`, { headers: HEADERS })],
    ['GET /api/reports/trends', http.get(`${BASE}/api/reports/trends`, { headers: HEADERS })],
    ['GET /api/accounts', http.get(`${BASE}/api/accounts`, { headers: HEADERS })],
    ['GET /metrics', http.get(`${BASE}/metrics`, { headers: HEADERS })],
  ];

  for (const [name, res] of readChecks) {
    check(res, { [`${name} status 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  }
}

export function apiTraffic() {
  const reads = [
    () => http.get(`${BASE}/api/transactions`, { headers: HEADERS }),
    () => http.get(`${BASE}/api/summary`, { headers: HEADERS }),
    () => http.get(`${BASE}/api/categories`, { headers: HEADERS }),
    () => http.get(`${BASE}/api/reports/trends`, { headers: HEADERS }),
    () => http.get(`${BASE}/api/reports/monthly`, { headers: HEADERS }),
    () => http.get(`${BASE}/api/accounts`, { headers: HEADERS }),
  ];
  const readRes = reads[Math.floor(Math.random() * reads.length)]();
  check(readRes, { 'read status 2xx': (r) => r.status >= 200 && r.status < 300 });

  sleep(0.1);

  if (Math.random() < 0.1) {
    const payload = {
      description: 'Load test expense',
      amount: '25.00',
      type: 'expense',
      category_id: null,
      date: new Date().toISOString().slice(0, 10),
      notes: 'k6 load test',
    };
    const writeRes = http.post(`${BASE}/api/transactions`, JSON.stringify(payload), { headers: HEADERS });
    check(writeRes, { 'write status 2xx': (r) => r.status >= 200 && r.status < 300 });
  }

  sleep(0.5);
}