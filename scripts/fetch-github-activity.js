#!/usr/bin/env node
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GITHUB_USER  = process.env.GITHUB_USER  || 'Bowrna';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const PER_PAGE     = 100;

function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const TARGET_MONTH = (process.env.TARGET_MONTH || '').trim() || previousMonth();
const [year, mon]  = TARGET_MONTH.split('-').map(Number);
const monthStart   = new Date(year, mon - 1, 1);
const monthEnd     = new Date(year, mon, 1); // exclusive

const OUT_DIR = path.join(__dirname, '..', 'static', 'github-activity');
const INDEX   = path.join(OUT_DIR, 'index.json');

function get(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Accept':     'application/vnd.github.v3+json',
      'User-Agent': 'bowrna-blog-archiver'
    };
    if (GITHUB_TOKEN) headers['Authorization'] = 'token ' + GITHUB_TOKEN;

    https.get(url, { headers }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(body));
        else reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
      });
    }).on('error', reject);
  });
}

async function fetchMonthEvents() {
  const events = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/users/${GITHUB_USER}/events/public?per_page=${PER_PAGE}&page=${page}`;
    console.log(`  Fetching page ${page}…`);
    const data = await get(url);
    if (!Array.isArray(data) || !data.length) break;

    for (const ev of data) {
      const d = new Date(ev.created_at);
      if (d >= monthStart && d < monthEnd) events.push(ev);
    }

    // Stop when the oldest event on the page predates the target month
    const oldest = new Date(data[data.length - 1].created_at);
    if (oldest < monthStart || data.length < PER_PAGE) break;
  }
  return events;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Archiving events for ${TARGET_MONTH}…`);
  const events = await fetchMonthEvents();
  console.log(`  Found ${events.length} events.`);

  const outFile = path.join(OUT_DIR, `${TARGET_MONTH}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    month:        TARGET_MONTH,
    generated_at: new Date().toISOString(),
    events
  }, null, 2));
  console.log(`  Wrote ${outFile}`);

  // Update the index
  let index = { months: [] };
  if (fs.existsSync(INDEX)) {
    try { index = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (_) {}
  }
  if (!index.months.includes(TARGET_MONTH)) {
    index.months.push(TARGET_MONTH);
    index.months.sort();
  }
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
  console.log(`  Index months: ${index.months.join(', ')}`);

  // Expose month for GitHub Actions step outputs
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `month=${TARGET_MONTH}\n`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
