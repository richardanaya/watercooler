import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Parse CLI args
const args = process.argv.slice(2);
let user: string | null = null;
let mailboxPath: string | null = null;
let coworkerPath: string | null = null;
let avatarPath: string | null = null;
let port: number = parseInt(process.env.PORT || '3000', 10);
let host: string = process.env.HOST || '0.0.0.0';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user' || args[i] === '-u') {
    user = args[++i];
  } else if (args[i] === '--mailbox' || args[i] === '-m') {
    mailboxPath = args[++i];
  } else if (args[i] === '--coworkers' || args[i] === '-c') {
    coworkerPath = args[++i];
  } else if (args[i] === '--avatars' || args[i] === '-a') {
    avatarPath = args[++i];
  } else if (args[i] === '--port' || args[i] === '-p') {
    const p = parseInt(args[++i], 10);
    if (!isNaN(p)) port = p;
  } else if (args[i] === '--host' || args[i] === '-h') {
    host = args[++i];
  }
}

if (!user || !mailboxPath) {
  console.error('Usage: watercooler --user <name> --mailbox <path> [--coworkers <path>] [--avatars <path>] [--port <number>] [--host <address>]');
  process.exit(1);
}

console.log(`🚰 Watercooler for ${user}`);
console.log(`   Mailbox: ${mailboxPath}`);
if (coworkerPath) {
  console.log(`   Coworker DB: ${coworkerPath}`);
}
if (avatarPath) {
  console.log(`   Avatar DB: ${avatarPath}`);
}
console.log(`   URL: http://${host}:${port}`);

// Databases
let db: Database.Database | null = null;
let coworkerDb: Database.Database | null = null;
let avatarDb: Database.Database | null = null;

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

if (avatarPath) {
  try {
    avatarDb = new Database(avatarPath);
    console.log('   Avatar DB: connected');
  } catch (err: any) {
    console.warn('   Avatar DB error:', err.message);
  }
}

// Helper: Check if table exists
function tableExists(database: Database.Database | null, tableName: string): boolean {
  if (!database) return false;
  try {
    const stmt = database.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `);
    return !!stmt.get(tableName);
  } catch {
    return false;
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: Get inbox (messages TO user)
app.get('/api/messages', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    if (!tableExists(db, 'messages')) {
      res.json([]);
      return;
    }
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
    if (!tableExists(db, 'messages')) {
      res.json([]);
      return;
    }
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

// API: Get ALL messages between ALL agents
app.get('/api/messages/all', (req, res) => {
  try {
    if (!db) throw new Error('Database not connected');
    if (!tableExists(db, 'messages')) {
      res.json([]);
      return;
    }
    const stmt = db.prepare(`
      SELECT * FROM messages 
      ORDER BY timestamp DESC
    `);
    res.json(stmt.all());
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
    
    // Note: Messages table is in a different database, not queried here
    
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
    if (!tableExists(db, 'messages')) {
      res.json([]);
      return;
    }
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
    
    // Auto-create messages table if it doesn't exist
    if (!tableExists(db, 'messages')) {
      db.exec(`
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient TEXT NOT NULL,
          sender TEXT NOT NULL,
          message TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          read INTEGER DEFAULT 0
        )
      `);
    }
    
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
    if (!tableExists(db, 'messages')) {
      res.status(404).json({ error: 'Messages table not found' });
      return;
    }
    db.prepare('UPDATE messages SET read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get avatar states (latest tool usage per coworker)
app.get('/api/avatars', (req, res) => {
  try {
    if (!avatarDb) {
      res.json({});
      return;
    }
    
    // Check if latest_tool_usage table exists
    const tableCheck = avatarDb.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='latest_tool_usage'
    `).get();
    
    if (!tableCheck) {
      res.json({});
      return;
    }
    
    // Get latest tool usage per name
    const stmt = avatarDb.prepare(`
      SELECT name, tool_name, timestamp
      FROM latest_tool_usage
      ORDER BY timestamp DESC
    `);
    
    const rows = stmt.all() as Array<{name: string; tool_name: string; timestamp: number}>;
    
    // Build map of name -> latest tool (first occurrence is latest due to ORDER BY)
    const avatarStates: Record<string, {tool_name: string; timestamp: number}> = {};
    for (const row of rows) {
      if (!avatarStates[row.name]) {
        avatarStates[row.name] = {
          tool_name: row.tool_name,
          timestamp: row.timestamp
        };
      }
    }
    
    res.json(avatarStates);
  } catch (err: any) {
    console.error('Error in /api/avatars:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({ user, mailbox: mailboxPath, coworker: coworkerPath, avatar: avatarPath });
});

app.listen(port, host, () => {
  console.log('\n✅ Watercooler running!');
});
