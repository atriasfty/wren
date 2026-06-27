import 'dotenv/config';
import { query } from './src/db/pool.js';
import { loadConfig } from './src/config.js';

loadConfig();

async function migrate() {
  console.log('Starting role system migration...');
  
  try {
    // 1. Rename security_role_id to leadership_role_id
    console.log('Renaming security_role_id to leadership_role_id...');
    try {
      await query(`ALTER TABLE tenants RENAME COLUMN security_role_id TO leadership_role_id;`);
    } catch(e) {
      if (e.code !== '42703') console.log('Notice:', e.message); // 42703 is undefined_column
    }
    
    // 2. Map existing staff_role_id to admin_role_id if admin is null
    console.log('Migrating staff_role_id to admin_role_id...');
    try {
      await query(`UPDATE tenants SET admin_role_id = staff_role_id WHERE admin_role_id IS NULL AND staff_role_id IS NOT NULL;`);
    } catch(e) {
      if (e.code !== '42703') console.log('Notice:', e.message);
    }
    
    // 3. Rename staff_role_id to mod_role_id
    console.log('Renaming staff_role_id to mod_role_id...');
    try {
      await query(`ALTER TABLE tenants RENAME COLUMN staff_role_id TO mod_role_id;`);
    } catch(e) {
      if (e.code !== '42703') console.log('Notice:', e.message);
    }

    // 4. Update tenant_role_policy min_role values
    console.log('Updating tenant_role_policy min_role values...');
    // We update policies that required 'staff' to now require 'admin'
    await query(`UPDATE tenant_role_policy SET min_role = 'admin' WHERE min_role = 'staff';`);
    // 'security' policies were likely mapped to something else, but there was no min_role for 'security'.

    // 5. Update the check constraint on tenant_role_policy
    console.log('Updating tenant_role_policy constraint...');
    await query(`ALTER TABLE tenant_role_policy DROP CONSTRAINT IF EXISTS tenant_role_policy_min_role_check;`);
    await query(`ALTER TABLE tenant_role_policy ADD CONSTRAINT tenant_role_policy_min_role_check CHECK (min_role IN ('owner','leadership','admin','mod','user'));`);

    console.log('Migration complete!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
