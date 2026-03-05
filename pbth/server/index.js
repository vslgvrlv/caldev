import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import db from './db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// --- API ROUTES ---

// Get Init Data (User, Team, Events)
app.get('/api/init', (req, res) => {
  const userId = req.query.userId || 'u1'; // Default for dev

  db.serialize(() => {
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
      db.get("SELECT * FROM team LIMIT 1", (err, team) => {
        db.all("SELECT * FROM users", (err, members) => {
          db.all("SELECT * FROM events", (err, events) => {
            db.all("SELECT * FROM transactions ORDER BY date DESC", (err, transactions) => {
               // Get RSVPs for current user to map status
               db.all("SELECT * FROM rsvps", (err, rsvps) => {
                  
                  // Format events
                  const formattedEvents = events.map(e => {
                     const myRsvp = rsvps.find(r => r.eventId === e.id && r.userId === userId);
                     const attendeesCount = rsvps.filter(r => r.eventId === e.id && r.status === 'CONFIRMED').length;
                     return {
                       ...e,
                       schedule: e.schedule ? JSON.parse(e.schedule) : undefined,
                       rsvpStatus: myRsvp ? myRsvp.status : 'PENDING',
                       attendeesCount
                     };
                  });

                  // Format members stats (mock calculation for now, but from real DB data)
                  const formattedMembers = members.map(m => ({
                      ...m,
                      stats: { attendanceRate: 85, eventsAttended: 10, totalEvents: 12, mvpCount: 0, matchesPlayed: 20 }
                  }));

                  res.json({
                    user,
                    team: { ...team, role: user.role }, // Use user's role for team context
                    members: formattedMembers,
                    events: formattedEvents,
                    transactions
                  });
               });
            });
          });
        });
      });
    });
  });
});

// Create Event
app.post('/api/events', (req, res) => {
  const { id, teamId, type, title, description, startDate, location, cost } = req.body;
  const stmt = db.prepare("INSERT INTO events (id, teamId, type, title, description, startDate, location, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  stmt.run(id, teamId, type, title, description, startDate, location, cost, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    // Auto-RSVP creator
    db.run("INSERT INTO rsvps (eventId, userId, status) VALUES (?, ?, ?)", [id, 'u1', 'CONFIRMED']); 
    res.json({ success: true });
  });
  stmt.finalize();
});

// RSVP
app.post('/api/rsvp', (req, res) => {
  const { eventId, userId, status } = req.body;
  db.run(`INSERT INTO rsvps (eventId, userId, status) VALUES (?, ?, ?) 
          ON CONFLICT(eventId, userId) DO UPDATE SET status = excluded.status`, 
          [eventId, userId, status], (err) => {
     if (err) return res.status(500).json({ error: err.message });
     res.json({ success: true });
  });
});

// Transactions
app.post('/api/transactions', (req, res) => {
  const { id, type, amount, title, date, userId, userName } = req.body;
  const stmt = db.prepare("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?)");
  stmt.run(id, type, amount, title, date, userId, userName, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Update team budget logic would go here
    if (type === 'EXPENSE') {
        db.run("UPDATE team SET budget = budget - ?", [amount]);
    } else if (type === 'DEPOSIT') {
        db.run("UPDATE team SET budget = budget + ?", [amount]);
    } else if (type === 'FEE' && userId) {
        db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, userId]);
    }

    res.json({ success: true });
  });
  stmt.finalize();
});

// Serve Static Files (Production)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, '../dist')));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});