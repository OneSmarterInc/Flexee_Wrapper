// Make an existing account an administrator (or remove the role), by sign-in email.
//   npm run admin:set -- someone@example.edu
//   npm run admin:set -- someone@example.edu --remove
// The account must exist: sign up first, then run this. Needed once, for the first admin;
// after that, more admins can be made the same way.
import postgres from "postgres";
const email = (process.argv[2] || "").toLowerCase().trim();
const remove = process.argv.includes("--remove");
if (!email || !email.includes("@")) { console.error("usage: npm run admin:set -- <email> [--remove]"); process.exit(1); }
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 1 });
const rows = await sql`
  update users set system_role = ${remove ? "user" : "admin"}
  where id = (select user_id from identities where provider = 'password' and subject = ${email} limit 1)
  returning display_name`;
await sql.end();
if (!rows.length) { console.error(`No account signs in with ${email}. Sign up first, then run this again.`); process.exit(1); }
console.log(`${rows[0].display_name} (${email}) is ${remove ? "no longer an administrator" : "now an administrator"}.`);
