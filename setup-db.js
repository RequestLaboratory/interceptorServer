/**
 * setup-db.js
 * Creates the required Supabase tables for the interceptor server.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node setup-db.js
 *
 * The script uses the Supabase Management API which requires your
 * service role key. If the API call fails it will print the SQL
 * so you can run it manually in the Supabase SQL Editor.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF         = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const SQL_FILE            = join(__dirname, 'migrations', '001_create_tables.sql');
const DASHBOARD_SQL_URL   = `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;

// ── Validation ────────────────────────────────────────────────────────────────
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing required environment variables.');
  console.error('    Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sql = readFileSync(SQL_FILE, 'utf8');

// ── Helpers ───────────────────────────────────────────────────────────────────
async function checkTablesViaClient() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const tables = ['sessions', 'interceptors', 'logs'];
  const status = {};

  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);
    // error.code 42P01 = relation does not exist
    status[table] = !error || error.code !== '42P01' ? 'exists' : 'missing';
  }
  return status;
}

async function createTablesViaManagementApi() {
  // The Supabase Management API accepts a personal access token OR the
  // service role key depending on version. We try the service role key first.
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

  const response = await axios.post(
    url,
    { query: sql },
    {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    }
  );
  return response.data;
}

function printManualInstructions() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋  Run the SQL below in your Supabase SQL Editor:');
  console.log(`    ${DASHBOARD_SQL_URL}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(sql);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔗  Supabase project: ${PROJECT_REF}`);
  console.log(`📡  URL: ${SUPABASE_URL}\n`);

  // Step 1 — check which tables already exist
  console.log('🔍  Checking existing tables...');
  let tableStatus;
  try {
    tableStatus = await checkTablesViaClient();
    for (const [table, status] of Object.entries(tableStatus)) {
      const icon = status === 'exists' ? '✅' : '❌';
      console.log(`    ${icon}  ${table}: ${status}`);
    }
  } catch (err) {
    console.warn('    ⚠️  Could not check table status:', err.message);
    tableStatus = {};
  }

  const allExist = Object.values(tableStatus).every(s => s === 'exists');
  if (allExist) {
    console.log('\n✅  All tables already exist — nothing to do!\n');
    return;
  }

  // Step 2 — try to create tables via Management API
  console.log('\n🛠   Creating missing tables via Management API...');
  try {
    await createTablesViaManagementApi();
    console.log('✅  Tables created successfully!\n');

    // Verify
    console.log('🔍  Verifying...');
    const final = await checkTablesViaClient();
    for (const [table, status] of Object.entries(final)) {
      const icon = status === 'exists' ? '✅' : '❌';
      console.log(`    ${icon}  ${table}: ${status}`);
    }
    console.log();
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      console.warn('    ⚠️  Management API requires a Personal Access Token (not service role key).');
      console.warn('       Get one at: https://supabase.com/dashboard/account/tokens\n');
    } else {
      console.warn('    ⚠️  Management API call failed:', err.response?.data ?? err.message, '\n');
    }
    printManualInstructions();
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
