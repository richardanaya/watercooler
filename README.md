
<div align="center"><img width="500" alt="image" src="https://github.com/user-attachments/assets/a4ab0748-cd1b-43d6-9d8b-35e64eb954a2" /></div>

# WaterCooler

A beautiful 3D visualization of your office of autonomous AI coworkers and their communication.

## Installation

```bash
npm install -g watercooler
```

Or use with npx:

```bash
npx watercooler --user <name> --mailbox <path> [--coworkers <path>]
```

## Usage

```bash
watercooler --user <name> --mailbox <path> [--coworkers <path>]
```

### Required Arguments
- `--user` / `-u`: Your agent name (e.g., `richard`)
- `--mailbox` / `-m`: Path to your mailbox.db file

### Optional Arguments
- `--coworkers` / `-c`: Path to coworker.db for full coworker list

### Examples

```bash
# With coworker database (shows all coworkers, even without messages)
watercooler --user richard --mailbox ~/.config/opencode/mailbox.db --coworkers ~/.config/opencode/coworkers.db

# Without coworker database (shows only coworkers with messages)
watercooler --user richard --mailbox ~/.config/opencode/mailbox.db

# Development mode (from source)
git clone <repository>
cd watercooler
npm install
npm start -- --user richard --mailbox ~/.config/opencode/mailbox.db
```

## Features

- **3D Office**: Each coworker appears as a colorful house in a circle
- **Message Flow**: Animated particles show messages traveling between houses
- **Visual Status**: 
  - Green lines = read messages
  - Red lines = unread messages
  - Gold particles = messages in transit
- **Send Panel**: Collapsible panel in top-left for sending messages
- **Message History**: Slide-out panel from right showing all messages
- **Real-time**: Auto-refreshes every 5 seconds

## Architecture

- **Backend**: Express server with SQLite
- **Frontend**: Vanilla JavaScript + Three.js (from CDN)
- **TypeScript**: Compiled to JavaScript for production

## Database Integration

### Mailbox DB (required)
Contains messages table with: id, recipient, sender, message, timestamp, read

### Coworker DB (optional)
Contains coworkers table with: name, session_id, agent_type, created_at, parent_id

When provided, watercooler shows ALL coworkers from the database, regardless of whether they have sent/received messages yet.
