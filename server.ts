import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Parse CLI args
const args = process.argv.slice(2);
let user: string | null = null;
let mailboxPath: string | null = null;
let coworkerPath: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user' || args[i] === '-u') {
    user = args[++i];
  } else if (args[i] === '--mailbox' || args[i] === '-m') {
    mailboxPath = args[++i];
  } else if (args[i] === '--coworkers' || args[i] === '-c') {
    coworkerPath = args[++i];
  }
}

if (!user || !mailboxPath) {
  console.error('Usage: watercooler --user <name> --mailbox <path> [--coworkers <path>]');
  process.exit(1);
}

console.log(`🚰 Watercooler for ${user}`);
console.log(`   Mailbox: ${mailboxPath}`);
if (coworkerPath) {
  console.log(`   Coworker DB: ${coworkerPath}`);
}
console.log(`   URL: http://localhost:${PORT}`);

// Databases
let db: Database.Database | null = null;
let coworkerDb: Database.Database | null = null;

try {
  db = new Database(mailboxPath);
  console.log('   Mailbox DB: connected');
} catch (err: any) {
  console.error('   Mailbox DB error:', err.message);
  process.exit(1);
}

if (coworkerPath) {
  try {
    coworkerDb = new Database(coworkerPath);
    console.log('   Coworker DB: connected');
  } catch (err: any) {
    console.warn('   Coworker DB error:', err.message);
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: Get inbox (messages TO user)
app.get('/api/messages', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    const stmt = db.prepare(`
      SELECT * FROM messages 
      WHERE recipient = ? 
      ORDER BY timestamp DESC
    `);
    res.json(stmt.all(user!.toLowerCase()));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get sent messages (messages FROM user)
app.get('/api/messages/sent', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    const stmt = db.prepare(`
      SELECT * FROM messages 
      WHERE sender = ? 
      ORDER BY timestamp DESC
    `);
    res.json(stmt.all(user!.toLowerCase()));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get ALL messages involving the user (for house dialogs)
app.get('/api/messages/all', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    const stmt = db.prepare(`
      SELECT * FROM messages 
      WHERE recipient = ? OR sender = ?
      ORDER BY timestamp DESC
    `);
    res.json(stmt.all(user!.toLowerCase(), user!.toLowerCase()));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get all coworkers (from coworker.db + message recipients)
app.get('/api/coworkers', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    const allCoworkers = new Set<string>();
    
    // Add from coworker.db if available
    if (coworkerDb) {
      try {
        const rows = coworkerDb.prepare('SELECT name FROM coworkers').all() as Array<{name: string}>;

        rows.forEach(row => allCoworkers.add(row.name.toLowerCase()));
      } catch (err: any) {
        console.error('Error reading coworker.db:', err.message);
      }
    } else {
      console.log('No coworkerDb connection available');
    }
    
    // Add from message history
    const recipientRows = db.prepare('SELECT DISTINCT recipient FROM messages').all() as Array<{recipient: string}>;
    recipientRows.forEach(row => allCoworkers.add(row.recipient.toLowerCase()));
    
    const senderRows = db.prepare('SELECT DISTINCT sender FROM messages').all() as Array<{sender: string}>;
    senderRows.forEach(row => allCoworkers.add(row.sender.toLowerCase()));
    
    // Remove current user
    allCoworkers.delete(user!.toLowerCase());
    
    const result = Array.from(allCoworkers).sort();
    res.json(result);
  } catch (err: any) {
    console.error('Error in /api/coworkers:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Legacy: Get recipients (for backwards compat)
app.get('/api/recipients', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    const stmt = db.prepare(`SELECT DISTINCT recipient FROM messages`);
    res.json(stmt.all().map((r: any) => r.recipient));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Send message
app.post('/api/send', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    const { to, message } = req.body;
    const stmt = db.prepare(`
      INSERT INTO messages (recipient, sender, message, timestamp, read)
      VALUES (?, ?, ?, ?, 0)
    `);
    stmt.run(to.toLowerCase(), user!.toLowerCase(), message, Date.now());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Mark read
app.post('/api/messages/:id/read', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    db.prepare('UPDATE messages SET read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({ user, mailbox: mailboxPath, coworker: coworkerPath });
});

app.listen(PORT, () => {
  console.log('\n✅ Watercooler running!');
});
