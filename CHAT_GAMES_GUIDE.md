# Chat Games Guide

DASB can run interactive chat games powered by OpenAI. Players use `!commands` in public chat (say) or via whisper to play trivia, riddles, word scrambles, and more.

---

## Setup

### 1. OpenAI API Key

Create a `.env` file in the project root:

```
OPENAI_API_KEY=sk-proj-your-key-here
```

The bot loads this automatically on startup via `dotenv`. The `.env` file is gitignored.

If no API key is set, games still work using built-in fallback question pools (limited variety).

### 2. Enable Chat Games

Either edit `bot-config.json` directly:

```json
{
  "chatGames": {
    "enabled": true,
    "openaiModel": "gpt-4o-mini",
    "commandPrefix": "!",
    "publicChatEnabled": true,
    "whisperEnabled": true,
    "cooldownSeconds": 10,
    "games": {
      "trivia": true,
      "riddle": true,
      "eightball": true,
      "scramble": true,
      "numberguess": true,
      "fortune": true
    }
  }
}
```

Or use the web panel: navigate to the **Chat Games** tab, check "Enable Chat Games", configure your settings, and click **Save Chat Games Config**.

### 3. Configuration Options

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Master toggle for the entire chat games system |
| `openaiModel` | `gpt-4o-mini` | Which OpenAI model to use (gpt-4o-mini is cheapest) |
| `commandPrefix` | `!` | Prefix character for commands (e.g. `!trivia`) |
| `publicChatEnabled` | `true` | Allow games via public say (players near the bot) |
| `whisperEnabled` | `true` | Allow games via whisper |
| `cooldownSeconds` | `10` | Per-player cooldown between starting new games |
| `games.*` | `true` | Toggle individual games on/off |

---

## Player Commands

### Starting Games

| Command | Description |
|---------|-------------|
| `!trivia` | Bot asks a trivia question (general knowledge, history, science, etc.) |
| `!riddle` | Bot poses a riddle to solve |
| `!8ball <question>` | Ask the mystical 8-ball a yes/no question |
| `!scramble` | Bot gives a scrambled word to unscramble |
| `!guess` | Bot picks a number 1-100, player guesses with higher/lower hints |
| `!fortune` | Bot delivers a cryptic prophecy |

### During a Game

| Command | Description |
|---------|-------------|
| `!answer <text>` | Submit an answer (also works by just typing the answer directly) |
| `!hint` | Get a hint for the current question |
| `!giveup` | Forfeit the current game and reveal the answer |

### Other

| Command | Description |
|---------|-------------|
| `!score` | View your win/loss record |
| `!help` | List all available commands |

---

## How Each Game Works

### Trivia (`!trivia`)
- OpenAI generates a question on a random topic
- Player has **3 attempts** and **60 seconds** to answer
- Answers are fuzzy-matched by OpenAI (typos and synonyms accepted)
- Correct answer earns +1 win on the scoreboard

### Riddles (`!riddle`)
- OpenAI generates a riddle
- Player has **3 attempts** and **90 seconds**
- Same fuzzy answer matching as trivia

### Magic 8-Ball (`!8ball`)
- Stateless: ask a question, get an instant mystical answer
- No scoring, no session — just fun
- Example: `!8ball Will I find a rare drop today?`

### Word Scramble (`!scramble`)
- OpenAI picks a word, bot scrambles the letters
- Player has **3 attempts** and **60 seconds**
- Answer must be an exact match (case-insensitive)
- Use `!hint` for a clue about the word's meaning

### Number Guess (`!guess`)
- Bot picks a random number between 1 and 100
- Player has **10 guesses** and **120 seconds**
- Bot responds "Too high!" or "Too low!" after each guess
- No OpenAI calls — runs entirely locally

### Fortune (`!fortune`)
- Stateless: bot delivers a one-line prophecy
- No scoring, no session

---

## How It Works Internally

### Message Flow

1. Player says `!trivia` near the bot (public) or whispers `!trivia` to the bot
2. `panel.js` receives the chat packet (opcode 0x0D for public, 0x0A for whisper)
3. The existing packet handler parses sender and message text
4. If the message starts with `!`, it's routed to `chat-games.js`
5. `chat-games.js` calls OpenAI to generate the question
6. Bot sends the response back via public say (opcode 0x0E) or whisper (opcode 0x19)

### Whisper Routing

When a whisper arrives, chat-games gets first priority. If the whisper is a game command or an answer to an active game, chat-games handles it. Otherwise, the whisper falls through to the existing AislingExchange verification reply.

### Message Length

Dark Ages limits public say messages to roughly 67 characters. The bot handles this by:
- Instructing OpenAI to keep responses short in its prompts
- Automatically splitting long messages into multiple say packets (800ms apart)
- Whispers support up to ~240 characters and are split at 500ms intervals if needed

### Sessions & State

- Each player can have **one active game** at a time
- Starting a new game cancels any existing game for that player
- Games have timeouts — if a player doesn't answer, the bot reveals the answer and ends the session
- The bot ignores its own messages to prevent loops

### Cooldowns & Rate Limiting

- Players must wait `cooldownSeconds` (default 10) between starting new games
- OpenAI API calls are rate-limited to 1 per second minimum
- The `!help`, `!score`, `!hint`, `!answer`, and `!giveup` commands bypass the cooldown

### Fallback Mode

If the OpenAI API is unavailable (no key, rate limited, API error), the bot falls back to:
- Built-in pools of trivia questions, riddles, and scramble words
- Hardcoded 8-ball and fortune responses
- Number guess runs locally and never needs OpenAI

### Scoring

- Wins and games played are tracked per player in memory
- Use `!score` to check your stats
- Scores reset when the bot restarts (not persisted to disk)

---

## Web Panel

The **Chat Games** tab in the web panel shows:

- **Configuration form** — enable/disable, model selection, prefix, cooldown, channel toggles, per-game toggles
- **API Key Status** — green "detected" or amber warning if no key is set
- **Active Games** — live list of players currently in a game session
- **Activity Log** — real-time feed of game events (started, answered, timed out, errors)

---

## Files

| File | Role |
|------|------|
| `src/chat-games.js` | Core module: OpenAI integration, game logic, sessions, scoring |
| `panel.js` | Wires chat-games into packet handlers and Socket.IO |
| `panel/index.html` | Chat Games panel UI section |
| `panel/panel.js` | Client-side Socket.IO handlers for the panel |
| `panel/panel.css` | Styles for game badges and activity log |
| `.env` | OpenAI API key (gitignored) |

---

## Cost

Using `gpt-4o-mini` (default), each game interaction costs roughly:
- Trivia/riddle question generation: ~$0.0001-0.0003
- Answer judging: ~$0.0001
- 8-ball/fortune: ~$0.0001

At typical play rates this is negligible. You can switch to a cheaper or more capable model by changing `openaiModel` in the config.
